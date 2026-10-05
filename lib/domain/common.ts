import { createHash, randomUUID } from "node:crypto";
import type { DbClient } from "@/lib/server/database";
import type {
  Actor,
  AppState,
  Packaging,
  QuantityInput,
  TransactionLine,
} from "./types";
import { insist } from "./errors";
import { integer, toBase } from "./units";
// SQL rows and already-validated action records are dynamic at this adapter boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export const uid = randomUUID;
export const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? "");
// pg parses DATE as local midnight; ISO conversion can incorrectly shift it a day west.
export const date = (value: unknown): string =>
  value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : String(value).slice(0, 10);
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((k) => [k, stable(record[k])]),
    );
  }
  return value;
}
export const hash = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
export const owner = (actor: Actor): void =>
  insist(
    actor.role === "owner",
    "FORBIDDEN",
    "Only an owner can perform this operation.",
    403,
  );
export async function one(
  db: DbClient,
  sql: string,
  args: unknown[] = [],
): Promise<Row | undefined> {
  return (await db.query(sql, args)).rows[0];
}
export async function actorCheck(db: DbClient, actor: Actor): Promise<void> {
  const user = await one(
    db,
    "SELECT id,role,active FROM sanket.users WHERE id=$1 FOR SHARE",
    [actor.id],
  );
  insist(
    user?.active && user.role === actor.role,
    "SESSION_REVOKED",
    "Your account is inactive or permissions have changed. Sign in again.",
    401,
  );
}
export async function settings(db: DbClient): Promise<AppState["settings"]> {
  return (await one(db, "SELECT data FROM sanket.settings WHERE id=true"))
    ?.data;
}
export async function today(db: DbClient): Promise<string> {
  const tz = (await settings(db))?.timezone || "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export const packaging = (r: Row): Packaging => ({
  id: r.id,
  version: r.version,
  baseUnit: r.base_unit,
  levels: r.levels,
  createdAt: iso(r.created_at),
  reason: r.reason,
});
export async function audit(
  db: DbClient,
  actor: Actor,
  action: string,
  entityId: string,
  detail: unknown,
): Promise<void> {
  await db.query(
    "INSERT INTO sanket.audit(id,action,entity_id,actor_id,actor_name,detail) VALUES($1,$2,$3,$4,$5,$6)",
    [uid(), action, entityId, actor.id, actor.name, JSON.stringify(detail)],
  );
}
export async function vehicleScope(
  db: DbClient,
  actor: Actor,
  vehicleId: string,
  assignmentId?: string,
  requireActive = true,
): Promise<Row> {
  const v = await one(
    db,
    `SELECT v.*,a.id AS assignment_id,a.salesman_id,u.name AS salesman_name FROM sanket.vehicles v LEFT JOIN sanket.assignments a ON a.vehicle_id=v.id AND a.ends_at IS NULL LEFT JOIN sanket.users u ON u.id=a.salesman_id AND u.active=true WHERE v.id=$1 FOR UPDATE OF v`,
    [vehicleId],
  );
  insist(
    v && (!requireActive || v.active),
    "VEHICLE_UNAVAILABLE",
    "Vehicle is missing or inactive.",
    404,
  );
  if (actor.role !== "owner")
    insist(
      v.salesman_id === actor.id && v.salesman_name,
      "FORBIDDEN",
      "This vehicle is not assigned to your active account.",
      403,
    );
  if (assignmentId)
    insist(
      v.assignment_id === assignmentId,
      "ASSIGNMENT_CHANGED",
      "Vehicle assignment changed. Review this entry before retrying.",
      409,
    );
  return v;
}
export async function writableDay(
  db: DbClient,
  vehicleId: string,
  inputDay?: string,
): Promise<string> {
  let day = await today(db);
  let report = await one(
    db,
    "SELECT sealed FROM sanket.daily_reports WHERE vehicle_id=$1 AND day=$2 FOR UPDATE",
    [vehicleId, day],
  );
  if (report?.sealed) {
    const d = new Date(`${day}T12:00:00Z`);
    d.setDate(d.getDate() + 1);
    day = d.toISOString().slice(0, 10);
    report = await one(
      db,
      "SELECT sealed FROM sanket.daily_reports WHERE vehicle_id=$1 AND day=$2 FOR UPDATE",
      [vehicleId, day],
    );
    insist(
      !report?.sealed,
      "DAY_SEALED",
      "This vehicle’s business date is submitted. Ask an owner to reopen it before changing stock.",
      409,
    );
  }
  insist(
    !inputDay || inputDay === day,
    "STALE_DAY",
    "This entry belongs to an earlier business date. Ask an owner to resolve the conflict.",
    409,
  );
  return day;
}
export async function warehouseScope(db: DbClient, id: string): Promise<Row> {
  const w = await one(
    db,
    "SELECT w.* FROM sanket.warehouses w JOIN sanket.locations l ON l.id=w.location_id WHERE w.id=$1 AND w.active AND l.active FOR UPDATE OF w",
    [id],
  );
  insist(w, "WAREHOUSE_UNAVAILABLE", "Godown is missing or inactive.", 404);
  return w;
}
export async function resolveLines(
  db: DbClient,
  input: QuantityInput[],
  historical = false,
): Promise<{ lines: TransactionLine[]; totals: Map<string, number> }> {
  const productIds = [...new Set(input.map((l) => l.productId))].sort();
  const rows = (
    await db.query(
      "SELECT * FROM sanket.products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [productIds],
    )
  ).rows;
  const products = new Map<string, Row>(rows.map((r: Row) => [r.id, r]));
  const packIds = [...new Set(input.map((l) => l.packagingId))];
  const packs = new Map<string, Row>(
    (
      await db.query(
        "SELECT * FROM sanket.packaging WHERE id=ANY($1::uuid[])",
        [packIds],
      )
    ).rows.map((r: Row) => [r.id, r]),
  );
  const totals = new Map<string, number>();
  const lines = input.map((line) => {
    const p = products.get(line.productId),
      pack = packs.get(line.packagingId);
    insist(
      p?.active && p.active_packaging_id,
      "PRODUCT_NOT_READY",
      "A selected product is inactive or needs packaging setup.",
    );
    insist(
      p.price === null || (p.price_unit && p.currency),
      "PRICE_NOT_READY",
      `${p.name} needs an explicit price unit and currency confirmation.`,
    );
    insist(
      pack?.product_id === line.productId,
      "INVALID_PACKAGING",
      "Packaging does not belong to this product.",
    );
    insist(
      historical || p.active_packaging_id === line.packagingId,
      "STALE_PACKAGING",
      `${p.name} packaging has changed. Refresh and review the quantities.`,
      409,
    );
    const baseQuantity = toBase(line.quantity, line.unitCode, {
      levels: pack.levels,
    });
    totals.set(
      line.productId,
      integer((totals.get(line.productId) || 0) + baseQuantity),
    );
    return {
      ...line,
      productName: p.name,
      baseQuantity,
      levels: pack.levels,
      baseUnit: pack.base_unit,
    };
  });
  return { lines, totals };
}
export type StockChange = {
  locationType: "warehouse" | "vehicle";
  locationId: string;
  productId: string;
  quantity: number;
  kind: string;
};
export async function move(
  db: DbClient,
  actor: Actor,
  document: Row,
  changes: StockChange[],
): Promise<void> {
  // Deterministic row order avoids deadlocks; aggregate duplicate lines before the check.
  const net = new Map<string, StockChange>();
  for (const c of changes) {
    const key = `${c.locationType}:${c.locationId}:${c.productId}`;
    const prev = net.get(key);
    net.set(key, { ...c, quantity: (prev?.quantity || 0) + c.quantity });
  }
  for (const [key, c] of [...net].sort(([a], [b]) => a.localeCompare(b))) {
    void key;
    insist(
      Number.isSafeInteger(c.quantity),
      "OVERFLOW",
      "Quantity exceeds the safe integer range.",
    );
    await db.query(
      "INSERT INTO sanket.stock_balances(location_type,location_id,product_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [c.locationType, c.locationId, c.productId],
    );
    const row = await one(
      db,
      "SELECT quantity FROM sanket.stock_balances WHERE location_type=$1 AND location_id=$2 AND product_id=$3 FOR UPDATE",
      [c.locationType, c.locationId, c.productId],
    );
    const next = Number(row!.quantity) + c.quantity;
    insist(
      next >= 0,
      "INSUFFICIENT_STOCK",
      "Insufficient available stock. No lines were posted.",
      409,
    );
    integer(next);
    await db.query(
      "UPDATE sanket.stock_balances SET quantity=$4 WHERE location_type=$1 AND location_id=$2 AND product_id=$3",
      [c.locationType, c.locationId, c.productId, next],
    );
  }
  for (const c of changes.filter((c) => c.quantity !== 0))
    await db.query(
      "INSERT INTO sanket.stock_movements(id,product_id,location_type,location_id,quantity,kind,document_id,reference,actor_id,actor_name,day,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        uid(),
        c.productId,
        c.locationType,
        c.locationId,
        c.quantity,
        c.kind,
        document.id,
        document.reference,
        actor.id,
        actor.name,
        document.day,
        document.notes || "",
      ],
    );
}
export async function createDocument(
  db: DbClient,
  actor: Actor,
  input: Row,
): Promise<Row> {
  const id = uid(),
    reference = `${input.kind}-${id.slice(0, 8).toUpperCase()}`;
  await db.query(
    "INSERT INTO sanket.stock_documents(id,reference,kind,warehouse_id,vehicle_id,actor_id,actor_name,salesman_id,salesman_name,assignment_id,day,lines,notes,replaces_id,status,source_document_id,source_invoice_id,delivery_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
    [
      id,
      reference,
      input.kind,
      input.warehouseId || null,
      input.vehicleId || null,
      actor.id,
      actor.name,
      input.salesmanId || null,
      input.salesmanName || null,
      input.assignmentId || null,
      input.day,
      JSON.stringify(input.lines),
      input.notes || "",
      input.replacesId || null,
      input.status || "POSTED",
      input.sourceDocumentId || null,
      input.sourceInvoiceId || null,
      input.deliveryReference || null,
    ],
  );
  return { id, reference, ...input };
}
