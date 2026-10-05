import { transaction, type DbClient } from "@/lib/server/database";
import type { Actor, TransactionLine } from "./types";
import { actorCheck, iso, one, settings, type Row } from "./common";
import { insist } from "./errors";
import { uuid } from "./validation";
export type InvoiceSnapshot = {
  invoiceNumber: string;
  saleId: string;
  reference: string;
  createdAt: string;
  business: { name: string; address: string; phone: string };
  customer: { name: string; phone: string; address: string; gstin: string };
  salesmanName: string;
  salesmanId: string;
  warehouseName: string;
  vehicleName: string;
  lines: (TransactionLine & {
    price: string | null;
    priceUnit: string | null;
    currency: string;
    total: string | null;
  })[];
  totals: { currency: string; amount: string }[];
  completePricing: boolean;
  historical: boolean;
  status?: string;
  replacedById?: string | null;
};
// Decimal money never passes through binary floating point. Round each line half up.
export function lineAmount(
  price: string,
  baseQuantity: number,
  priceFactor: number,
): string {
  const [whole, fraction = ""] = price.split(".");
  const minor = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  const divisor = BigInt(priceFactor),
    numerator = minor * BigInt(baseQuantity);
  return money((numerator + divisor / BigInt(2)) / divisor);
}
function money(minor: bigint): string {
  return `${minor / BigInt(100)}.${(minor % BigInt(100)).toString().padStart(2, "0")}`;
}
function minor(value: string): bigint {
  return BigInt(value.replace(".", ""));
}
export async function captureSalesInvoice(
  db: DbClient,
  doc: Row,
  customer?: InvoiceSnapshot["customer"],
): Promise<void> {
  const snapshot = await makeSnapshot(db, doc, customer, false);
  await db.query(
    "INSERT INTO sanket.sales_invoices(sale_id,invoice_number,snapshot) VALUES($1,$2,$3)",
    [doc.id, snapshot.invoiceNumber, JSON.stringify(snapshot)],
  );
}
async function makeSnapshot(
  db: DbClient,
  doc: Row,
  customer: InvoiceSnapshot["customer"] | undefined,
  historical: boolean,
): Promise<InvoiceSnapshot> {
  const config = await settings(db);
  const products = new Map<string, Row>(
    (
      await db.query(
        "SELECT id,price,price_unit,currency FROM sanket.products WHERE id=ANY($1::uuid[])",
        [(doc.lines as TransactionLine[]).map((l) => l.productId)],
      )
    ).rows.map((r) => [r.id, r]),
  );
  const lines = (doc.lines as TransactionLine[]).map((l) => {
    const p = products.get(l.productId),
      factor = l.levels.find((level) => level.code === p?.price_unit)?.factor;
    const priced =
      !historical && p?.price !== null && p?.price !== undefined && factor;
    return {
      ...l,
      price: priced ? String(p.price) : null,
      priceUnit: priced ? p.price_unit : null,
      currency: historical ? "" : p?.currency || "",
      total: priced
        ? lineAmount(String(p.price), l.baseQuantity, factor)
        : null,
    };
  });
  const totals = new Map<string, bigint>();
  for (const l of lines)
    if (l.total !== null)
      totals.set(
        l.currency,
        (totals.get(l.currency) || BigInt(0)) + minor(l.total),
      );
  const v = await one(
    db,
    "SELECT v.name,w.name AS warehouse_name FROM sanket.vehicles v LEFT JOIN sanket.warehouses w ON w.id=$2 WHERE v.id=$1",
    [doc.vehicle_id, doc.warehouse_id],
  );
  return {
    invoiceNumber: `SI-${doc.id.toUpperCase()}`,
    saleId: doc.id,
    reference: doc.reference,
    createdAt: iso(doc.created_at),
    business: {
      name: config.businessName,
      address: config.address,
      phone: config.phone,
    },
    customer: customer || { name: "", phone: "", address: "", gstin: "" },
    salesmanName: doc.salesman_name || "",
    salesmanId: doc.salesman_id || "",
    warehouseName: v?.warehouse_name || "",
    vehicleName: v?.name || "",
    lines,
    totals: [...totals].map(([currency, amount]) => ({
      currency,
      amount: money(amount),
    })),
    completePricing: lines.every((l) => l.total !== null),
    historical,
  };
}
export async function getSalesInvoice(
  actor: Actor,
  id: string,
): Promise<InvoiceSnapshot> {
  uuid(id);
  return transaction(async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await actorCheck(db, actor);
    const doc = await one(
      db,
      "SELECT * FROM sanket.stock_documents WHERE id=$1 AND kind='SALE'",
      [id],
    );
    insist(
      doc && (actor.role === "owner" || doc.salesman_id === actor.id),
      "NOT_FOUND",
      "Sale invoice was not found.",
      404,
    );
    const saved = await one(
      db,
      "SELECT snapshot FROM sanket.sales_invoices WHERE sale_id=$1",
      [id],
    );
    const snapshot =
      saved?.snapshot || (await makeSnapshot(db, doc, undefined, true));
    return {
      ...snapshot,
      status: doc.status,
      replacedById: doc.replaced_by_id,
    };
  });
}
