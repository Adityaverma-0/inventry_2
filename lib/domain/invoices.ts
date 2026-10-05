import type { DbClient } from "@/lib/server/database";
import type { Actor, InvoiceLine, QuantityInput } from "./types";
import { insist } from "./errors";
import { assertNoManualReceipt } from "./receipts";
import {
  createDocument,
  move,
  one,
  owner,
  resolveLines,
  today,
  uid,
  warehouseScope,
  type Row,
} from "./common";
async function snapshot(db: DbClient, actor: Actor, id: string): Promise<void> {
  const invoice = await one(db, "SELECT * FROM sanket.invoices WHERE id=$1", [
    id,
  ]);
  await db.query(
    "INSERT INTO sanket.invoice_revisions(invoice_id,revision,snapshot,actor_id) VALUES($1,$2,$3,$4)",
    [id, invoice!.revision, JSON.stringify(invoice), actor.id],
  );
}
async function review(
  db: DbClient,
  invoice: Row,
): Promise<Awaited<ReturnType<typeof resolveLines>>> {
  insist(
    invoice.supplier &&
      invoice.invoice_number &&
      invoice.invoice_date &&
      invoice.warehouse_id,
    "INCOMPLETE_INVOICE",
    "Complete the supplier, invoice number, date and receiving godown.",
  );
  await warehouseScope(db, invoice.warehouse_id);
  insist(
    invoice.lines.length > 0,
    "EMPTY_INVOICE",
    "Add at least one reviewed invoice line.",
  );
  const inputs: QuantityInput[] = [];
  for (const line of invoice.lines as InvoiceLine[]) {
    insist(
      Number.isSafeInteger(line.receivedQuantity) &&
        line.receivedQuantity >= 0 &&
        Number.isSafeInteger(line.freeQuantity || 0),
      "INVALID_QUANTITY",
      "Invoice quantities must be whole numbers.",
    );
    const total = line.receivedQuantity + (line.freeQuantity || 0);
    insist(
      Number.isSafeInteger(total),
      "INVALID_QUANTITY",
      "Invoice quantity is too large.",
    );
    if (
      line.receivedQuantity !== line.invoiceQuantity ||
      (line.freeQuantity || 0) > 0
    )
      insist(
        line.reason.trim().length >= 3,
        "DISCREPANCY_REASON",
        "Explain shortages, excess or free quantities before approval.",
      );
    const p = await one(
      db,
      "SELECT active_packaging_id FROM sanket.products WHERE id=$1",
      [line.productId],
    );
    if (p?.active_packaging_id !== line.packagingId)
      insist(
        line.reason.trim().length >= 3,
        "HISTORICAL_PACKAGING_REASON",
        "Explain the explicit historical packaging selection on each affected line.",
      );
    // Validate even zero-quantity lines; an unmatched line must never be ignored.
    await resolveLines(
      db,
      [
        {
          productId: line.productId,
          packagingId: line.packagingId,
          unitCode: line.unitCode,
          quantity: 0,
        },
      ],
      true,
    );
    if (total > 0)
      inputs.push({
        productId: line.productId,
        packagingId: line.packagingId,
        unitCode: line.unitCode,
        quantity: total,
      });
  }
  insist(
    inputs.length > 0,
    "NO_RECEIVED_STOCK",
    "An approved receipt must contain received stock.",
  );
  return resolveLines(db, inputs, true);
}
export async function invoiceAction(
  db: DbClient,
  actor: Actor,
  action: string,
  d: Row,
): Promise<Row> {
  owner(actor);
  if (action === "invoice.create") {
    const duplicate = await one(
      db,
      "SELECT id,file_name FROM sanket.invoices WHERE hash=$1",
      [d.hash],
    );
    insist(
      !duplicate,
      "DUPLICATE_FILE",
      `This file was already uploaded${duplicate ? ` as ${duplicate.file_name}` : ""}. Open the existing invoice.`,
      409,
    );
    const id = uid();
    await db.query(
      "INSERT INTO sanket.invoices(id,file_id,file_name,mime,hash,extraction_status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, d.fileId, d.fileName, d.mime, d.hash, d.extractionStatus, actor.id],
    );
    await snapshot(db, actor, id);
    return {
      id,
      revision: 1,
      message: "Invoice uploaded as a draft. Inventory is unchanged.",
    };
  }
  const invoice = await one(
    db,
    "SELECT * FROM sanket.invoices WHERE id=$1 FOR UPDATE",
    [d.id],
  );
  insist(invoice, "NOT_FOUND", "Invoice was not found.", 404);
  insist(
    invoice.revision === d.revision,
    "STALE_REVISION",
    "The invoice changed after this view was opened. Review its latest revision.",
    409,
  );
  if (action === "invoice.approve" && invoice.status === "APPROVED_POSTED")
    return {
      id: invoice.id,
      reference: invoice.receipt_reference,
      message: "Invoice receipt already posted.",
    };
  insist(
    invoice.status !== "APPROVED_POSTED",
    "INVOICE_POSTED",
    "Approved invoices are immutable. Use an audited stock correction with the receipt reference.",
    409,
  );
  if (action === "invoice.update") {
    await warehouseScope(db, d.warehouseId);
    await db.query(
      "UPDATE sanket.invoices SET revision=revision+1,supplier=$2,invoice_number=$3,invoice_date=$4,warehouse_id=$5,lines=$6,status='DRAFT',decision_reason=$7 WHERE id=$1",
      [
        d.id,
        d.supplier,
        d.invoiceNumber,
        d.invoiceDate,
        d.warehouseId,
        JSON.stringify(d.lines),
        d.reason,
      ],
    );
    await snapshot(db, actor, d.id);
    return {
      id: d.id,
      revision: d.revision + 1,
      message: "Invoice revision saved. Review and mark ready before approval.",
    };
  }
  if (action === "invoice.reject") {
    await db.query(
      "UPDATE sanket.invoices SET status='REJECTED',decision_reason=$2 WHERE id=$1",
      [d.id, d.reason],
    );
    return {
      id: d.id,
      revision: d.revision,
      message: "Invoice rejected. Inventory is unchanged.",
    };
  }
  if (action === "invoice.ready") {
    await review(db, invoice);
    await db.query(
      "UPDATE sanket.invoices SET status='READY_FOR_APPROVAL',decision_reason='' WHERE id=$1",
      [d.id],
    );
    return {
      id: d.id,
      revision: d.revision,
      message: "Invoice is ready for owner approval.",
    };
  }
  insist(
    action === "invoice.approve",
    "UNKNOWN_ACTION",
    "Unknown invoice operation.",
  );
  insist(
    invoice.status === "READY_FOR_APPROVAL",
    "INVOICE_NOT_READY",
    "Review the invoice and mark the exact revision ready for approval.",
    409,
  );
  await assertNoManualReceipt(db, invoice.warehouse_id, [
    invoice.invoice_number,
  ]);
  const resolved = await review(db, invoice);
  const doc = await createDocument(db, actor, {
    kind: "PURCHASE_RECEIPT",
    warehouseId: invoice.warehouse_id,
    lines: resolved.lines,
    day: await today(db),
    notes: `${invoice.supplier} · ${invoice.invoice_number} · invoice ${invoice.id} revision ${invoice.revision}`,
  });
  await move(
    db,
    actor,
    doc,
    [...resolved.totals].map(([productId, quantity]) => ({
      productId,
      quantity,
      locationType: "warehouse",
      locationId: invoice.warehouse_id,
      kind: "PURCHASE_RECEIPT",
    })),
  );
  await db.query(
    "UPDATE sanket.invoices SET status='APPROVED_POSTED',approved_at=now(),approved_by=$2,receipt_id=$3,receipt_reference=$4,decision_reason=$5 WHERE id=$1",
    [invoice.id, actor.id, doc.id, doc.reference, d.reason],
  );
  return {
    id: invoice.id,
    reference: doc.reference,
    revision: invoice.revision,
    message: "Invoice approved; receipt posted once to the selected godown.",
  };
}
