import { transaction, type DbClient } from "@/lib/server/database";
import type { Actor, TransactionLine } from "./types";
import {
  actorCheck,
  createDocument,
  date,
  iso,
  move,
  one,
  owner,
  resolveLines,
  today,
  uid,
  vehicleScope,
  warehouseScope,
  writableDay,
  type Row,
  type StockChange,
} from "./common";
import { insist } from "./errors";
import { integer } from "./units";
import { uuid } from "./validation";
import { inventoryAction } from "./inventory";

export type StockRequest = {
  id: string;
  reference: string;
  kind: "RETURN" | "HOLD" | "ALLOCATION" | "ADJUSTMENT";
  status: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
  vehicleId: string;
  warehouseId: string;
  salesmanId: string;
  salesmanName: string;
  vehicleName: string;
  warehouseName: string;
  day: string;
  lines: TransactionLine[];
  vehicleSnapshot: StockSnapshot[];
  completionStock: StockSnapshot[] | null;
  reason: string;
  createdAt: string;
  decidedAt: string | null;
  decidedName: string | null;
  decisionReason: string;
  documentId: string | null;
};
export type StockSnapshot = { productId: string; quantity: number };
export type WarehouseStockView = {
  day: string;
  rows: {
    warehouseId: string;
    productId: string;
    available: number;
    allocated: number;
    total: number;
    lastUpdate: string | null;
  }[];
  journey: {
    productId: string;
    opening: number;
    loaded: number;
    sold: number;
    returned: number;
    current: number;
  }[];
  requests: StockRequest[];
  total: number;
  page: number;
  hasMore: boolean;
};
function requestRow(r: Row): StockRequest {
  return {
    id: r.id,
    reference: r.reference,
    kind: r.kind,
    status: r.status,
    vehicleId: r.vehicle_id,
    warehouseId: r.warehouse_id,
    salesmanId: r.salesman_id,
    salesmanName: r.salesman_name,
    vehicleName: r.vehicle_name,
    warehouseName: r.warehouse_name,
    day: date(r.day),
    lines: r.lines,
    vehicleSnapshot: r.vehicle_snapshot,
    completionStock: r.completion_stock,
    reason: r.reason,
    createdAt: iso(r.created_at),
    decidedAt: r.decided_at ? iso(r.decided_at) : null,
    decidedName: r.decided_name,
    decisionReason: r.decision_reason,
    documentId: r.document_id,
  };
}
async function vehicleStock(
  db: DbClient,
  vehicleId: string,
): Promise<StockSnapshot[]> {
  return (
    await db.query(
      "SELECT product_id,quantity FROM sanket.stock_balances WHERE location_type='vehicle' AND location_id=$1 ORDER BY product_id",
      [vehicleId],
    )
  ).rows.map((r) => ({
    productId: r.product_id,
    quantity: integer(Number(r.quantity)),
  }));
}
async function checkAvailable(
  db: DbClient,
  type: string,
  locationId: string,
  totals: Map<string, number>,
) {
  const balances = new Map<string, number>(
    (
      await db.query(
        "SELECT product_id,quantity FROM sanket.stock_balances WHERE location_type=$1 AND location_id=$2 FOR UPDATE",
        [type, locationId],
      )
    ).rows.map((r) => [r.product_id, Number(r.quantity)]),
  );
  for (const [id, qty] of totals)
    insist(
      qty <= (balances.get(id) || 0),
      "INSUFFICIENT_STOCK",
      "Requested quantity exceeds current stock. Refresh and review the request.",
      409,
    );
}
export async function stockRequestAction(
  db: DbClient,
  actor: Actor,
  action: string,
  d: Row,
): Promise<Row> {
  if (action === "inventory-request.create") {
    const v = await vehicleScope(db, actor, d.vehicleId, d.assignmentId);
    insist(
      v.assignment_id && v.salesman_name,
      "ASSIGNMENT_REQUIRED",
      "Assign an active salesman first.",
    );
    const w = await warehouseScope(db, v.warehouse_id);
    const day = await writableDay(db, v.id, d.day);
    const snapshot = await vehicleStock(db, v.id);
    let lines: TransactionLine[] = [];
    if (d.kind === "HOLD") {
      insist(
        d.lines.length === 0,
        "HOLD_LINES",
        "Holding stock does not unload quantities.",
      );
    } else if (d.kind === "ADJUSTMENT") {
      const p = await one(db, "SELECT * FROM sanket.products WHERE id=$1", [
        d.productId,
      ]);
      insist(
        p?.active_packaging_id,
        "PRODUCT_NOT_READY",
        "Choose a configured product.",
      );
      const pk = await one(db, "SELECT * FROM sanket.packaging WHERE id=$1", [
        p.active_packaging_id,
      ]);
      insist(
        pk!.id === d.packagingId,
        "STALE_PACKAGING",
        "Packaging changed. Refresh and review.",
        409,
      );
      lines = [
        {
          productId: p.id,
          productName: p.name,
          packagingId: pk!.id,
          baseUnit: pk!.base_unit,
          levels: pk!.levels,
          unitCode: pk!.base_unit,
          quantity: d.delta,
          baseQuantity: d.delta,
        },
      ];
    } else {
      insist(
        d.lines.length > 0,
        "EMPTY_REQUEST",
        "Select at least one quantity.",
      );
      const resolved = await resolveLines(db, d.lines);
      await checkAvailable(
        db,
        d.kind === "RETURN" ? "vehicle" : "warehouse",
        d.kind === "RETURN" ? v.id : w.id,
        resolved.totals,
      );
      lines = resolved.lines;
    }
    const id = uid(),
      reference = `REQ-${id.toUpperCase()}`;
    await db.query(
      `INSERT INTO sanket.stock_requests(id,reference,kind,status,vehicle_id,warehouse_id,assignment_id,salesman_id,salesman_name,vehicle_name,warehouse_name,day,lines,vehicle_snapshot,reason,created_by,completion_stock)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        id,
        reference,
        d.kind,
        d.kind === "HOLD" ? "COMPLETED" : "PENDING",
        v.id,
        w.id,
        v.assignment_id,
        v.salesman_id,
        v.salesman_name,
        v.name,
        w.name,
        day,
        JSON.stringify(lines),
        JSON.stringify(snapshot),
        d.reason,
        actor.id,
        d.kind === "HOLD" ? JSON.stringify(snapshot) : null,
      ],
    );
    return {
      id,
      reference,
      message:
        d.kind === "HOLD"
          ? "Stock remains in your vehicle and is available for future sales."
          : "Request submitted for owner approval. Stock has not moved.",
    };
  }
  owner(actor);
  const r = await one(
    db,
    "SELECT * FROM sanket.stock_requests WHERE id=$1 FOR UPDATE",
    [d.id],
  );
  insist(r, "NOT_FOUND", "Request was not found.", 404);
  insist(
    r.status === "PENDING",
    "ALREADY_DECIDED",
    "This request already has a final decision.",
    409,
  );
  let documentId: string | null = null,
    completion: StockSnapshot[] | null = null;
  if (action === "inventory-request.approve") {
    const v = await vehicleScope(db, actor, r.vehicle_id, r.assignment_id);
    insist(
      v.warehouse_id === r.warehouse_id,
      "HOME_GODOWN_CHANGED",
      "The vehicle home godown changed. Reject this request and ask for a new one.",
      409,
    );
    await warehouseScope(db, r.warehouse_id);
    // An approval posts on the current open business date, never into a sealed historical report.
    const day = await writableDay(db, v.id);
    if (r.kind === "ALLOCATION") {
      const result = await inventoryAction(db, actor, "transfer.create", {
        vehicleId: v.id,
        warehouseId: r.warehouse_id,
        assignmentId: r.assignment_id,
        day,
        lines: r.lines,
      });
      documentId = result.id;
    } else if (r.kind === "ADJUSTMENT") {
      const line = r.lines[0];
      const p = await one(
        db,
        "SELECT active_packaging_id FROM sanket.products WHERE id=$1",
        [line.productId],
      );
      insist(
        p?.active_packaging_id === line.packagingId,
        "STALE_PACKAGING",
        "Packaging changed. Reject and review a new discrepancy request.",
        409,
      );
      const result = await inventoryAction(db, actor, "stock.adjust", {
        locationType: "vehicle",
        locationId: v.id,
        assignmentId: r.assignment_id,
        productId: line.productId,
        delta: line.baseQuantity,
        reason: `${r.reference} · ${r.reason} · ${d.reason}`,
        day,
      });
      documentId = result.id;
    } else {
      const resolved = await resolveLines(db, r.lines);
      const doc = await createDocument(db, actor, {
        kind: "RETURN",
        warehouseId: r.warehouse_id,
        vehicleId: v.id,
        salesmanId: r.salesman_id,
        salesmanName: r.salesman_name,
        assignmentId: r.assignment_id,
        lines: resolved.lines,
        day,
        notes: `${r.reference} · ${r.reason}`,
      });
      const changes: StockChange[] = [];
      for (const [productId, quantity] of resolved.totals)
        changes.push(
          {
            productId,
            quantity: -quantity,
            locationType: "vehicle",
            locationId: v.id,
            kind: "RETURN_OUT",
          },
          {
            productId,
            quantity,
            locationType: "warehouse",
            locationId: r.warehouse_id,
            kind: "RETURN",
          },
        );
      await move(db, actor, doc, changes);
      documentId = doc.id;
    }
    completion = await vehicleStock(db, v.id);
  }
  await db.query(
    "UPDATE sanket.stock_requests SET status=$2,decided_by=$3,decided_name=$4,decided_at=now(),decision_reason=$5,document_id=$6,completion_stock=$7 WHERE id=$1",
    [
      r.id,
      action === "inventory-request.approve" ? "APPROVED" : "REJECTED",
      actor.id,
      actor.name,
      d.reason,
      documentId,
      completion ? JSON.stringify(completion) : null,
    ],
  );
  return {
    id: r.id,
    documentId,
    message:
      action === "inventory-request.approve"
        ? "Approved. Warehouse and vehicle balances are updated."
        : "Request rejected. Stock is unchanged.",
  };
}
export async function getWarehouseStock(
  actor: Actor,
  vehicleId?: string,
  page = 1,
): Promise<WarehouseStockView> {
  if (vehicleId) uuid(vehicleId);
  insist(
    Number.isInteger(page) && page >= 1 && page <= 100000,
    "INVALID_PAGE",
    "Choose a valid page.",
  );
  return transaction(async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await actorCheck(db, actor);
    if (vehicleId) await vehicleScope(db, actor, vehicleId, undefined, false);
    const day = await today(db);
    const warehouseIds = (
      await db.query(
        `SELECT DISTINCT w.id FROM sanket.warehouses w WHERE $1 OR EXISTS(SELECT 1 FROM sanket.vehicles v JOIN sanket.assignments a ON a.vehicle_id=v.id AND a.ends_at IS NULL WHERE v.warehouse_id=w.id AND a.salesman_id=$2)`,
        [actor.role === "owner", actor.id],
      )
    ).rows.map((r) => r.id);
    const rows = (
      await db.query(
        `SELECT w.id AS warehouse_id,p.id AS product_id,COALESCE(b.quantity,0)::text AS available,
   COALESCE((SELECT SUM(vb.quantity) FROM sanket.stock_balances vb JOIN sanket.vehicles v ON v.id=vb.location_id WHERE vb.location_type='vehicle' AND v.warehouse_id=w.id AND vb.product_id=p.id),0)::text AS allocated,
   (SELECT max(m.created_at) FROM sanket.stock_movements m WHERE m.location_type='warehouse' AND m.location_id=w.id AND m.product_id=p.id) AS last_update
   FROM sanket.warehouses w CROSS JOIN sanket.products p LEFT JOIN sanket.stock_balances b ON b.location_type='warehouse' AND b.location_id=w.id AND b.product_id=p.id WHERE w.id=ANY($1::uuid[]) ORDER BY w.name,p.name`,
        [warehouseIds],
      )
    ).rows.map((r) => ({
      warehouseId: r.warehouse_id,
      productId: r.product_id,
      available: integer(Number(r.available)),
      allocated: integer(Number(r.allocated)),
      total: integer(Number(r.available) + Number(r.allocated)),
      lastUpdate: r.last_update ? iso(r.last_update) : null,
    }));
    const journey = vehicleId
      ? (
          await db.query(
            `SELECT product_id,
   SUM(CASE WHEN day<$2::date THEN quantity ELSE 0 END)::text AS opening,
   SUM(CASE WHEN day=$2::date AND kind='LOAD' THEN quantity ELSE 0 END)::text AS loaded,
   -SUM(CASE WHEN day=$2::date AND kind IN ('SALE','SALE_REVERSAL') THEN quantity ELSE 0 END)::text::bigint AS sold,
   -SUM(CASE WHEN day=$2::date AND kind='RETURN_OUT' THEN quantity ELSE 0 END)::text::bigint AS returned,
   SUM(quantity)::text AS current FROM sanket.stock_movements WHERE location_type='vehicle' AND location_id=$1 GROUP BY product_id ORDER BY product_id`,
            [vehicleId, day],
          )
        ).rows.map((r) => ({
          productId: r.product_id,
          opening: Number(r.opening),
          loaded: Number(r.loaded),
          sold: Number(r.sold),
          returned: Number(r.returned),
          current: Number(r.current),
        }))
      : [];
    const args = [actor.role === "owner", actor.id, vehicleId || null];
    const where =
      "WHERE ($1 OR salesman_id=$2) AND ($3::uuid IS NULL OR vehicle_id=$3)";
    const total = Number(
      (
        await db.query(
          `SELECT count(*) FROM sanket.stock_requests ${where}`,
          args,
        )
      ).rows[0].count,
    );
    const requests = (
      await db.query(
        `SELECT * FROM sanket.stock_requests ${where} ORDER BY created_at DESC,id LIMIT 50 OFFSET $4`,
        [...args, (page - 1) * 50],
      )
    ).rows.map(requestRow);
    return {
      day,
      rows,
      journey,
      requests,
      total,
      page,
      hasMore: page * 50 < total,
    };
  });
}
