import { transaction } from "@/lib/server/database";
import type { Actor, UnitLevel } from "./types";
import { actorCheck, owner, today, type Row } from "./common";
import { formatQuantity, integer } from "./units";
import { validDay, uuid } from "./validation";
import { insist } from "./errors";
export type ReconciliationLine = {
  productId: string;
  productName: string;
  packagingId: string | null;
  levels: UnitLevel[];
  baseUnit: string;
  opening: number;
  receipts: number;
  outgoing: number;
  returns: number;
  adjustments: number;
  closing: number;
  formatted: string;
  equationBalances: boolean;
  liveBalance: number | null;
  ledgerMatchesLive: boolean | null;
};
export type WarehouseReconciliation = {
  warehouseId: string;
  warehouseName: string;
  day: string;
  quantityBasis: "historical as-of";
  conversionBasis: "current packaging";
  lines: ReconciliationLine[];
  generatedAt: string;
};
export async function getWarehouseReconciliation(
  actor: Actor,
  day: string,
  warehouseId?: string,
): Promise<WarehouseReconciliation[]> {
  owner(actor);
  validDay(day);
  if (warehouseId) uuid(warehouseId);
  return transaction(async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await actorCheck(db, actor);
    const current = await today(db);
    insist(
      day <= current,
      "FUTURE_DAY",
      "Choose today or a previous business date.",
    );
    const warehouses = (
      await db.query(
        "SELECT * FROM sanket.warehouses WHERE $1::uuid IS NULL OR id=$1 ORDER BY name",
        [warehouseId || null],
      )
    ).rows;
    if (warehouseId)
      insist(warehouses.length, "NOT_FOUND", "Godown was not found.", 404);
    const rows = (
      await db.query(
        `SELECT m.location_id,m.product_id,p.name,pk.id AS packaging_id,pk.base_unit,pk.levels,
      SUM(CASE WHEN m.day<$1::date THEN m.quantity ELSE 0 END)::text AS opening,
      SUM(CASE WHEN m.day=$1::date AND m.kind IN ('OPENING','MANUAL_RECEIPT','PURCHASE_RECEIPT') THEN m.quantity ELSE 0 END)::text AS receipts,
      -SUM(CASE WHEN m.day=$1::date AND m.kind='LOAD_OUT' THEN m.quantity ELSE 0 END)::bigint AS outgoing,
      SUM(CASE WHEN m.day=$1::date AND m.kind='RETURN' THEN m.quantity ELSE 0 END)::text AS returns,
      SUM(CASE WHEN m.day=$1::date AND m.kind NOT IN ('OPENING','MANUAL_RECEIPT','PURCHASE_RECEIPT','LOAD_OUT','RETURN') THEN m.quantity ELSE 0 END)::text AS adjustments,
      SUM(m.quantity)::text AS closing,MAX(b.quantity)::text AS live_balance
      FROM sanket.stock_movements m JOIN sanket.products p ON p.id=m.product_id LEFT JOIN sanket.packaging pk ON pk.id=p.active_packaging_id
      LEFT JOIN sanket.stock_balances b ON b.location_type=m.location_type AND b.location_id=m.location_id AND b.product_id=m.product_id
      WHERE m.location_type='warehouse' AND m.day<=$1 AND ($2::uuid IS NULL OR m.location_id=$2)
      GROUP BY m.location_id,m.product_id,p.name,pk.id,pk.base_unit,pk.levels ORDER BY p.name`,
        [day, warehouseId || null],
      )
    ).rows;
    const byWarehouse = new Map<string, ReconciliationLine[]>();
    for (const r of rows as Row[]) {
      const opening = integer(Number(r.opening)),
        receipts = integer(Number(r.receipts)),
        outgoing = integer(Number(r.outgoing)),
        returns = integer(Number(r.returns)),
        closing = integer(Number(r.closing)),
        adjustments = Number(r.adjustments);
      insist(
        Number.isSafeInteger(adjustments),
        "QUANTITY_OVERFLOW",
        "Report totals exceed the supported integer range.",
      );
      const line: ReconciliationLine = {
        productId: r.product_id,
        productName: r.name,
        packagingId: r.packaging_id,
        levels: r.levels || [],
        baseUnit: r.base_unit || "base",
        opening,
        receipts,
        outgoing,
        returns,
        adjustments,
        closing,
        formatted: formatQuantity(closing, r.levels || []),
        equationBalances:
          opening + receipts - outgoing + returns + adjustments === closing,
        liveBalance: day === current ? Number(r.live_balance) : null,
        ledgerMatchesLive:
          day === current ? closing === Number(r.live_balance) : null,
      };
      const group = byWarehouse.get(r.location_id) || [];
      group.push(line);
      byWarehouse.set(r.location_id, group);
    }
    return warehouses.map((w: Row) => ({
      warehouseId: w.id,
      warehouseName: w.name,
      day,
      quantityBasis: "historical as-of",
      conversionBasis: "current packaging",
      lines: byWarehouse.get(w.id) || [],
      generatedAt: new Date().toISOString(),
    }));
  });
}
