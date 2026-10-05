import type { DbClient } from "@/lib/server/database";
import type { Actor, AppState } from "./types";
import { date, iso, packaging, settings, type Row } from "./common";
import { readRevision } from "./reports";
export async function readState(
  db: DbClient,
  actor: Actor,
  options: { unlimited?: boolean } = {},
): Promise<AppState> {
  const run = (sql: string, args: unknown[] = []) =>
    db.query(options.unlimited ? sql.replace(/ LIMIT \d+/g, "") : sql, args);
  const isOwner = actor.role === "owner";
  const vehicles = (
    await run(
      `SELECT v.*,a.salesman_id FROM sanket.vehicles v LEFT JOIN sanket.assignments a ON a.vehicle_id=v.id AND a.ends_at IS NULL WHERE $1 OR a.salesman_id=$2 ORDER BY v.name`,
      [isOwner, actor.id],
    )
  ).rows;
  const vehicleIds = vehicles.map((v: Row) => v.id),
    warehouseIds = vehicles.map((v: Row) => v.warehouse_id);
  const warehouses = (
    await run(
      "SELECT * FROM sanket.warehouses WHERE $1 OR id=ANY($2::uuid[]) ORDER BY name",
      [isOwner, warehouseIds],
    )
  ).rows;
  const locationIds = warehouses.map((w: Row) => w.location_id);
  const [
    locations,
    assignments,
    users,
    products,
    balances,
    movements,
    docs,
    invoices,
    headers,
    audit,
    samples,
  ] = [
    await run(
      "SELECT * FROM sanket.locations WHERE $1 OR id=ANY($2::uuid[]) ORDER BY name",
      [isOwner, locationIds],
    ),
    await run(
      "SELECT * FROM sanket.assignments WHERE $1 OR salesman_id=$2 ORDER BY starts_at DESC LIMIT 1000",
      [isOwner, actor.id],
    ),
    await run(
      "SELECT id,name,username,email,mobile,role,active FROM sanket.users WHERE $1 OR id=$2 ORDER BY name",
      [isOwner, actor.id],
    ),
    await run(
      "SELECT p.*,pk.id AS pack_id,pk.version,pk.base_unit,pk.levels,pk.reason,pk.created_at AS pack_created_at FROM sanket.products p LEFT JOIN sanket.packaging pk ON pk.id=p.active_packaging_id ORDER BY p.name",
    ),
    await run(
      "SELECT * FROM sanket.stock_balances WHERE $1 OR (location_type='vehicle' AND location_id=ANY($2::uuid[])) ORDER BY location_id,product_id",
      [isOwner, vehicleIds],
    ),
    await run(
      "SELECT m.* FROM sanket.stock_movements m JOIN sanket.stock_documents d ON d.id=m.document_id WHERE $1 OR (m.location_type='vehicle' AND d.salesman_id=$2) ORDER BY m.created_at DESC,m.id LIMIT 500",
      [isOwner, actor.id],
    ),
    await run(
      "SELECT * FROM sanket.stock_documents WHERE ($1 OR salesman_id=$2) AND kind IN ('SALE','TRANSFER') ORDER BY created_at DESC,id LIMIT 500",
      [isOwner, actor.id],
    ),
    isOwner
      ? await run(
          "SELECT i.*,u.name AS approver_name FROM sanket.invoices i LEFT JOIN sanket.users u ON u.id=i.approved_by ORDER BY i.created_at DESC LIMIT 250",
        )
      : { rows: [] },
    await run(
      "SELECT d.id,d.revision FROM sanket.daily_reports d JOIN sanket.report_revisions r ON r.report_id=d.id AND r.revision=d.revision WHERE $1 OR r.snapshot->>'salesmanId'=$2::text ORDER BY d.day DESC LIMIT 250",
      [isOwner, actor.id],
    ),
    isOwner
      ? await run(
          "SELECT * FROM sanket.audit ORDER BY created_at DESC LIMIT 250",
        )
      : { rows: [] },
    await run(
      "SELECT DISTINCT ON(vehicle_id) * FROM sanket.location_samples WHERE $1 OR user_id=$2 ORDER BY vehicle_id,received_at DESC",
      [isOwner, actor.id],
    ),
  ];
  const reports = [];
  for (const header of headers.rows)
    reports.push(await readRevision(db, actor, header.id, header.revision));
  const sales = docs.rows
    .filter((d: Row) => d.kind === "SALE")
    .map((d: Row) => ({
      id: d.id,
      reference: d.reference,
      vehicleId: d.vehicle_id,
      warehouseId: d.warehouse_id,
      salesmanId: d.salesman_id,
      salesmanName: d.salesman_name,
      day: date(d.day),
      status: d.status,
      lines: d.lines,
      notes: d.notes,
      createdAt: iso(d.created_at),
      replacesId: d.replaces_id,
      replacedById: d.replaced_by_id,
    }));
  return {
    pendingStockRequests: Number(
      (
        await run(
          "SELECT count(*) FROM sanket.stock_requests WHERE status='PENDING' AND ($1 OR salesman_id=$2)",
          [isOwner, actor.id],
        )
      ).rows[0].count,
    ),
    user: actor,
    settings: await settings(db),
    locations: locations.rows.map((r: Row) => ({
      id: r.id,
      name: r.name,
      active: r.active,
    })),
    warehouses: warehouses.map((r: Row) => ({
      id: r.id,
      name: r.name,
      locationId: r.location_id,
      active: r.active,
    })),
    vehicles: vehicles.map((r: Row) => ({
      id: r.id,
      name: r.name,
      registration: r.registration,
      warehouseId: r.warehouse_id,
      active: r.active,
      salesmanId: r.salesman_id,
      schedule: r.schedule,
      maintenanceDate: r.maintenance_date,
    })),
    assignments: assignments.rows.map((r: Row) => ({
      id: r.id,
      vehicleId: r.vehicle_id,
      salesmanId: r.salesman_id,
      from: iso(r.starts_at),
      to: r.ends_at ? iso(r.ends_at) : null,
    })),
    users: users.rows,
    products: products.rows.map((p: Row) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      active: p.active,
      ready: !!(
        p.pack_id &&
        (p.price === null || (p.price_unit && p.currency))
      ),
      minStock: Number(p.min_stock),
      price: p.price === null ? null : String(p.price),
      priceUnit: p.price_unit,
      currency: p.currency,
      packaging: p.pack_id
        ? packaging({
            id: p.pack_id,
            version: p.version,
            base_unit: p.base_unit,
            levels: p.levels,
            reason: p.reason,
            created_at: p.pack_created_at,
          })
        : null,
      rawImport: p.raw_import,
      createdAt: iso(p.created_at),
    })),
    balances: balances.rows.map((r: Row) => ({
      locationId: r.location_id,
      locationType: r.location_type,
      productId: r.product_id,
      quantity: Number(r.quantity),
    })),
    movements: movements.rows.map((r: Row) => ({
      id: r.id,
      productId: r.product_id,
      locationId: r.location_id,
      locationType: r.location_type,
      kind: r.kind,
      quantity: Number(r.quantity),
      reference: r.reference,
      actorName: r.actor_name,
      createdAt: iso(r.created_at),
      note: r.note,
    })),
    sales,
    transfers: docs.rows
      .filter((r: Row) => r.kind === "TRANSFER")
      .map((r: Row) => ({
        id: r.id,
        reference: r.reference,
        warehouseId: r.warehouse_id,
        vehicleId: r.vehicle_id,
        lines: r.lines,
        createdAt: iso(r.created_at),
        actorName: r.actor_name,
      })),
    invoices: invoices.rows.map((r: Row) => ({
      id: r.id,
      revision: r.revision,
      fileId: r.file_id,
      fileName: r.file_name,
      mime: r.mime,
      hash: r.hash,
      supplier: r.supplier,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      warehouseId: r.warehouse_id || "",
      status: r.status,
      extractionStatus: r.extraction_status,
      extractionError: r.extraction_error,
      extractedText: r.extracted_text,
      suggestions: r.suggestions || [],
      extractionWarnings: r.extraction_meta?.warnings || [],
      extractionMeta: r.extraction_meta || {},
      lines: r.lines,
      createdAt: iso(r.created_at),
      approvedAt: r.approved_at ? iso(r.approved_at) : null,
      approvedBy: r.approver_name,
      receiptReference: r.receipt_reference,
      decisionReason: r.decision_reason,
    })),
    reports,
    audit: audit.rows.map((r: Row) => ({
      id: r.id,
      action: r.action,
      entityId: r.entity_id,
      actorName: r.actor_name,
      detail: JSON.stringify(r.detail),
      createdAt: iso(r.created_at),
    })),
    locationSamples: samples.rows.map((r: Row) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      vehicleId: r.vehicle_id,
      latitude: r.latitude,
      longitude: r.longitude,
      accuracy: r.accuracy,
      capturedAt: iso(r.captured_at),
      receivedAt: iso(r.received_at),
    })),
    serverTime: new Date().toISOString(),
  };
}
