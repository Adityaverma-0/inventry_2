import type { DbClient } from "@/lib/server/database";
import { one } from "./common";
import { insist } from "./errors";
/** Called only inside the serialized business transaction. Legacy references are
 * read from immutable audit data rather than guessed from free-form notes. */
export async function assertNoManualReceipt(
  db: DbClient,
  warehouseId: string,
  references: string[],
): Promise<void> {
  const found = await one(
    db,
    `SELECT d.reference FROM sanket.stock_documents d
    LEFT JOIN LATERAL (SELECT a.detail->>'reference' AS original_reference FROM sanket.audit a WHERE a.action='stock.receive' AND a.entity_id=d.id::text ORDER BY a.created_at LIMIT 1) historical ON d.delivery_reference IS NULL
    WHERE d.warehouse_id=$1 AND d.kind IN ('OPENING','MANUAL_RECEIPT')
      AND sanket.normalize_delivery_reference(COALESCE(d.delivery_reference,historical.original_reference,''))<>''
      AND sanket.normalize_delivery_reference(COALESCE(d.delivery_reference,historical.original_reference,''))
        IN (SELECT sanket.normalize_delivery_reference(value) FROM unnest($2::text[]) value)
    LIMIT 1`,
    [warehouseId, references],
  );
  insist(
    !found,
    "DUPLICATE_DELIVERY",
    `This delivery reference was already received${found ? ` under ${found.reference}` : ""}. Review the original receipt; stock cannot be added twice.`,
    409,
  );
}
export async function assertNoApprovedInvoice(
  db: DbClient,
  warehouseId: string,
  reference: string,
): Promise<void> {
  const found = await one(
    db,
    `SELECT invoice_number,receipt_reference FROM sanket.invoices
    WHERE warehouse_id=$1 AND status='APPROVED_POSTED'
      AND (sanket.normalize_delivery_reference(invoice_number)=sanket.normalize_delivery_reference($2)
       OR sanket.normalize_delivery_reference(receipt_reference)=sanket.normalize_delivery_reference($2)) LIMIT 1`,
    [warehouseId, reference],
  );
  insist(
    !found,
    "DUPLICATE_DELIVERY",
    "This invoice/delivery was already posted through Purchase Invoices. Open its receipt or create a linked correction instead.",
    409,
  );
}
