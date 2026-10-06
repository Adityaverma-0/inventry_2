import { calculateBreakdownTotal, validateBreakdown } from "./cashDenominations";
import type { DbClient } from "@/lib/server/database";
import type { Actor, DailyReport, ReportLine } from "./types";
import { insist } from "./errors";
import {
  date,
  hash,
  iso,
  one,
  owner,
  today,
  uid,
  vehicleScope,
  type Row,
} from "./common";
import { formatQuantity, integer } from "./units";
import { validDay, uuid } from "./validation";
export async function buildReport(
  db: DbClient,
  actor: Actor,
  day: string,
  vehicleId: string,
): Promise<DailyReport> {
  validDay(day);
  uuid(vehicleId);
  const v = await vehicleScope(db, actor, vehicleId, undefined, false);
  insist(
    day <= (await today(db)),
    "FUTURE_DAY",
    "Reports cannot be generated for a future business date.",
  );
  const grouped = (
    await db.query(
      `SELECT m.product_id, SUM(CASE WHEN m.day<$2::date THEN m.quantity ELSE 0 END)::text AS opening,
    SUM(CASE WHEN m.day=$2::date AND m.kind='LOAD' THEN m.quantity ELSE 0 END)::text AS loaded,
    -SUM(CASE WHEN m.day=$2::date AND m.kind='SALE' THEN m.quantity ELSE 0 END)::text::bigint AS sold,
    SUM(CASE WHEN m.day=$2::date AND m.kind='SALE_REVERSAL' THEN m.quantity ELSE 0 END)::text AS reversed,
    SUM(CASE WHEN m.day=$2::date AND m.kind NOT IN ('LOAD','SALE','SALE_REVERSAL') THEN m.quantity ELSE 0 END)::text AS adjustments,
    SUM(m.quantity)::text AS closing, md5(string_agg(m.id::text,',' ORDER BY m.created_at,m.id)) AS source
    FROM sanket.stock_movements m WHERE m.location_type='vehicle' AND m.location_id=$1 AND m.day<=$2 GROUP BY m.product_id ORDER BY m.product_id`,
      [vehicleId, day],
    )
  ).rows;
  const ids = grouped.map((r: Row) => r.product_id);
  const products = new Map<string, Row>(
    (
      await db.query(
        "SELECT p.id,p.name,pk.id AS packaging_id,pk.base_unit,pk.levels FROM sanket.products p LEFT JOIN sanket.packaging pk ON pk.id=p.active_packaging_id WHERE p.id=ANY($1::uuid[])",
        [ids],
      )
    ).rows.map((r: Row) => [r.id, r]),
  );
  const lines: ReportLine[] = grouped.map((g: Row) => {
    const p = products.get(g.product_id)!;
    const closing = integer(Number(g.closing));
    insist(
      Number.isSafeInteger(Number(g.adjustments)),
      "QUANTITY_OVERFLOW",
      "Report quantities exceed the supported integer range.",
    );
    return {
      productId: g.product_id,
      productName: p.name,
      packagingId: p.packaging_id,
      levels: p.levels || [],
      baseUnit: p.base_unit || "base",
      opening: integer(Number(g.opening)),
      loaded: integer(Number(g.loaded)),
      sold: integer(Number(g.sold)),
      reversed: integer(Number(g.reversed)),
      adjustments: Number(g.adjustments),
      closing,
      formatted: formatQuantity(closing, p.levels || []),
    };
  });
  const historic = await one(
    db,
    `SELECT a.salesman_id,u.name FROM sanket.assignments a JOIN sanket.users u ON u.id=a.salesman_id WHERE a.vehicle_id=$1 AND (a.starts_at AT TIME ZONE (SELECT data->>'timezone' FROM sanket.settings WHERE id=true))::date<=$2 AND (a.ends_at IS NULL OR (a.ends_at AT TIME ZONE (SELECT data->>'timezone' FROM sanket.settings WHERE id=true))::date>=$2) ORDER BY a.starts_at DESC LIMIT 1`,
    [vehicleId, day],
  );
  if (actor.role !== "owner") {
    insist(
      historic?.salesman_id === actor.id,
      "FORBIDDEN",
      "This business date belongs to a different vehicle assignment.",
      403,
    );
    const mixed = await one(
      db,
      "SELECT id FROM sanket.stock_documents WHERE vehicle_id=$1 AND day=$2 AND salesman_id IS NOT NULL AND salesman_id<>$3 LIMIT 1",
      [vehicleId, day, actor.id],
    );
    insist(
      !mixed,
      "OWNER_REPORT_REQUIRED",
      "This vehicle changed salesmen during the day. Ask an owner to review the combined daily report.",
      403,
    );
  }
  const header = await one(
    db,
    "SELECT * FROM sanket.daily_reports WHERE vehicle_id=$1 AND day=$2",
    [vehicleId, day],
  );
  const amendments = (
    await db.query(
      `SELECT d.reference,d.created_at AS "createdAt",d.day,d.notes AS reason,o.reference AS "originalReference" FROM sanket.stock_documents d JOIN sanket.stock_documents o ON o.id=d.replaces_id WHERE o.vehicle_id=$1 AND o.day=$2 AND d.day>o.day ORDER BY d.created_at`,
      [vehicleId, day],
    )
  ).rows;
  const transactionReferences = (
    await db.query(
      "SELECT id,reference,kind,created_at,replaces_id,source_document_id,source_invoice_id,lines FROM sanket.stock_documents WHERE vehicle_id=$1 AND day=$2 ORDER BY created_at,id",
      [vehicleId, day],
    )
  ).rows.map((r: Row) => ({
    id: r.id,
    reference: r.reference,
    kind: r.kind,
    createdAt: iso(r.created_at),
    replacesId: r.replaces_id,
    sourceDocumentId: r.source_document_id,
    sourceInvoiceId: r.source_invoice_id,
    lines: r.lines,
  }));
  const identity = await one(
    db,
    `SELECT w.id AS warehouse_id,w.name AS warehouse_name,l.id AS location_id,l.name AS location_name,
      s.data->>'businessName' AS business_name,s.data->>'timezone' AS timezone
      FROM sanket.warehouses w JOIN sanket.locations l ON l.id=w.location_id
      CROSS JOIN sanket.settings s WHERE w.id=$1 AND s.id=true`,
    [v.warehouse_id],
  );

  const salesStats = await db.query(
    `SELECT
      SUM(CAST(si.snapshot->>'grandTotal' AS numeric)) as total_sales,
      SUM(
        (SELECT COALESCE(SUM(CAST(p->>'amount' AS numeric)), 0)
         FROM jsonb_array_elements(si.snapshot->'payments') p
         WHERE p->>'method' = 'UPI'
        )
      ) as upi_sales,
      SUM(
        (SELECT COALESCE(SUM(CAST(p->>'amount' AS numeric)), 0)
         FROM jsonb_array_elements(si.snapshot->'payments') p
         WHERE p->>'method' = 'Bank Transfer'
        )
      ) as bank_sales
     FROM sanket.sales_invoices si
     JOIN sanket.stock_documents sd ON si.sale_id = sd.id
     WHERE sd.vehicle_id = $1 AND sd.day = $2`,
    [vehicleId, day]
  );
  const stats = salesStats.rows[0];
  const totalSales = Number(stats?.total_sales || 0);
  const upiSales = Number(stats?.upi_sales || 0);
  const bankSales = Number(stats?.bank_sales || 0);
  // Expected cash is whatever wasn't paid via UPI or Bank (assuming it's cash or credit, for now we expect all remaining as Cash)
  const cashExpected = (totalSales - upiSales - bankSales) * 100;

  // These labels belong to this revision, just like its packaging factors.
  return {
    businessName: identity?.business_name,
    timezone: identity?.timezone,
    warehouseId: identity?.warehouse_id,
    warehouseName: identity?.warehouse_name,
    locationId: identity?.location_id,
    locationName: identity?.location_name,
    id: header?.id || "",
    revisionId: "",
    revision: Number(header?.revision || 0) + 1,
    day,
    vehicleId,
    vehicleName: v.name,
    salesmanId: historic?.salesman_id || v.salesman_id || actor.id,
    salesmanName: historic?.name || v.salesman_name || actor.name,
    status: "DRAFT",
    notes: "",
    lines,
    totalSales: totalSales * 100,
    upiExpected: upiSales * 100,
    bankExpected: bankSales * 100,
    cashExpected,
    submittedAt: "",
    decidedAt: null,
    decidedBy: null,
    decisionReason: "",
    sourceHash: hash({
      day,
      vehicleId,
      lines,
      sources: grouped.map((g: Row) => g.source),
      transactionReferences,
    }),
    amendments,
    transactionReferences,
  };
}
export async function readRevision(
  db: DbClient,
  actor: Actor,
  id: string,
  revision?: number,
): Promise<DailyReport> {
  uuid(id);
  if (revision !== undefined)
    insist(
      Number.isSafeInteger(revision) && revision > 0,
      "VALIDATION",
      "Invalid report revision.",
    );
  const row = await one(
    db,
    `SELECT r.*,d.vehicle_id,d.revision AS latest_revision FROM sanket.report_revisions r JOIN sanket.daily_reports d ON d.id=r.report_id WHERE r.report_id=$1 AND r.revision=COALESCE($2,d.revision)`,
    [id, revision ?? null],
  );
  insist(row, "NOT_FOUND", "Report revision was not found.", 404);
  if (actor.role !== "owner")
    insist(
      row.snapshot.salesmanId === actor.id,
      "FORBIDDEN",
      "You can only view your own submitted report revisions.",
      403,
    );
  const events = (
    await db.query(
      "SELECT * FROM sanket.report_decisions WHERE report_id=$1 AND revision=$2 ORDER BY created_at,id",
      [id, row.revision],
    )
  ).rows;
  const last = events[events.length - 1];
  const approved = events.find((e: Row) => e.decision === "APPROVED");
  return {
    ...row.snapshot,
    status: last?.decision || "SUBMITTED",
    decidedAt: last ? iso(last.created_at) : null,
    decidedBy: last?.actor_name || null,
    decisionReason: last?.reason || "",
    decisionHistory: events.map((e: Row) => ({
      decision: e.decision,
      actor: e.actor_name,
      at: iso(e.created_at),
      reason: e.reason,
    })),
    ...(approved
      ? {
          approval: {
            actor: approved.actor_name,
            at: iso(approved.created_at),
          },
        }
      : {}),
  };
}
export async function reportAction(
  db: DbClient,
  actor: Actor,
  action: string,
  data: Row,
): Promise<Row> {
  
  if (action === "report.submit") {
    const p = data as {
      cashBreakdown?: Record<string, number>;
      cashExpected?: number;
      cashActual?: number;
      day: string;
      vehicleId: string;
      notes: string;
      expectedSourceHash: string;
    };
    if (p.cashBreakdown) {
      validateBreakdown(p.cashBreakdown);
      const serverTotal = calculateBreakdownTotal(p.cashBreakdown);
      if (serverTotal !== p.cashActual) {
        throw new Error("Cash total mismatch");
      }
    }

    const preview = await buildReport(db, actor, p.day, p.vehicleId);
    insist(
      preview.sourceHash === p.expectedSourceHash,
      "STALE_REPORT",
      "Report data or packaging changed. Refresh the preview before submission.",
      409,
    );
    insist(
      preview.salesmanId === actor.id || actor.role === "owner",
      "FORBIDDEN",
      "This business date belongs to a different salesman.",
      403,
    );
    let header = await one(
      db,
      "SELECT * FROM sanket.daily_reports WHERE vehicle_id=$1 AND day=$2 FOR UPDATE",
      [p.vehicleId, p.day],
    );
    if (!header) {
      const id = uid();
      await db.query(
        "INSERT INTO sanket.daily_reports(id,vehicle_id,day) VALUES($1,$2,$3)",
        [id, p.vehicleId, p.day],
      );
      header = { id, revision: 0, status: "DRAFT" };
    }
    insist(
      ["DRAFT", "REJECTED", "REOPENED"].includes(header.status),
      "REPORT_SEALED",
      "This revision is already submitted or approved.",
      409,
    );
    const snapshot: DailyReport = {
      ...preview,
      id: header.id,
      revisionId: uid(),
      revision: header.revision + 1,
      status: "SUBMITTED",
      notes: p.notes,
      cashBreakdown: p.cashBreakdown,
      cashExpected: p.cashExpected,
      cashActual: p.cashActual,
      submittedAt: new Date().toISOString(),
    };
    await db.query(
      "INSERT INTO sanket.report_revisions(id,report_id,revision,snapshot,source_hash,submitter_id,cash_breakdown,cash_expected,cash_actual) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        snapshot.revisionId,
        snapshot.id,
        snapshot.revision,
        JSON.stringify(snapshot),
        snapshot.sourceHash,
        actor.id,
        p.cashBreakdown ? JSON.stringify(p.cashBreakdown) : null,
        p.cashExpected || null,
        p.cashActual || null,
      ],
    );
    await db.query(
      "UPDATE sanket.daily_reports SET revision=$2,status='SUBMITTED',sealed=true WHERE id=$1",
      [snapshot.id, snapshot.revision],
    );
    return {
      id: snapshot.id,
      revision: snapshot.revision,
      message: "Daily report submitted for owner approval.",
    };
  }
  owner(actor);
  const header = await one(
    db,
    "SELECT * FROM sanket.daily_reports WHERE id=$1 FOR UPDATE",
    [data.id],
  );
  insist(header, "NOT_FOUND", "Report was not found.", 404);
  insist(
    header.revision === data.revision,
    "STALE_REVISION",
    "A newer report revision exists. Open the latest revision.",
    409,
  );
  const target =
    action === "report.approve"
      ? "APPROVED"
      : action === "report.reject"
        ? "REJECTED"
        : "REOPENED";
  if (header.status === target)
    return {
      id: data.id,
      revision: data.revision,
      message: `Report already ${target.toLowerCase()}.`,
    };
  insist(
    target === "REOPENED"
      ? header.status === "APPROVED"
      : header.status === "SUBMITTED",
    "INVALID_TRANSITION",
    "This report cannot receive that decision in its current state.",
    409,
  );
  if (target === "APPROVED") {
    const saved = await one(
      db,
      "SELECT source_hash FROM sanket.report_revisions WHERE report_id=$1 AND revision=$2",
      [data.id, data.revision],
    );
    const current = await buildReport(
      db,
      actor,
      date(header.day),
      header.vehicle_id,
    );
    insist(
      saved?.source_hash === current.sourceHash,
      "STALE_REPORT",
      "Relevant data or packaging changed. Reject this revision and request a refreshed submission.",
      409,
    );
  }
  await db.query(
    "INSERT INTO sanket.report_decisions(id,report_id,revision,decision,actor_id,actor_name,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [uid(), data.id, data.revision, target, actor.id, actor.name, data.reason],
  );
  const unlock =
    (target === "REJECTED" || target === "REOPENED") &&
    date(header.day) === (await today(db));
  await db.query(
    "UPDATE sanket.daily_reports SET status=$2,sealed=$3 WHERE id=$1",
    [data.id, target, !unlock],
  );
  return {
    id: data.id,
    revision: data.revision,
    message: `Report ${target.toLowerCase()}. Inventory is unchanged.`,
  };
}
