import { captureSalesInvoice } from "./sales-invoices";
import type { DbClient } from "@/lib/server/database";
import type { Actor, TransactionLine } from "./types";
import { insist } from "./errors";
import { assertNoManualReceipt, assertNoApprovedInvoice } from "./receipts";
import {
  createDocument,
  date,
  move,
  one,
  owner,
  resolveLines,
  today,
  vehicleScope,
  warehouseScope,
  writableDay,
  type Row,
  type StockChange,
} from "./common";
export async function inventoryAction(
  db: DbClient,
  actor: Actor,
  action: string,
  d: Row,
): Promise<Row> {
  if (action === "stock.receive") {
    owner(actor);
    await warehouseScope(db, d.warehouseId);
    await assertNoManualReceipt(db, d.warehouseId, [d.reference]);
    await assertNoApprovedInvoice(db, d.warehouseId, d.reference);
    const resolved = await resolveLines(db, d.lines);
    if (d.kind === "OPENING")
      for (const productId of resolved.totals.keys())
        insist(
          !(await one(
            db,
            "SELECT id FROM sanket.stock_movements WHERE location_type='warehouse' AND location_id=$1 AND product_id=$2 LIMIT 1",
            [d.warehouseId, productId],
          )),
          "OPENING_EXISTS",
          "Opening stock requires a product with no previous movement at this godown. Use a manual receipt instead.",
          409,
        );
    const doc = await createDocument(db, actor, {
      kind: d.kind,
      deliveryReference: d.reference,
      warehouseId: d.warehouseId,
      lines: resolved.lines,
      day: await today(db),
      notes: [d.notes, d.reference].filter(Boolean).join(" · "),
    });
    await move(
      db,
      actor,
      doc,
      [...resolved.totals].map(([productId, quantity]) => ({
        productId,
        quantity,
        locationType: "warehouse",
        locationId: d.warehouseId,
        kind: d.kind,
      })),
    );
    return {
      id: doc.id,
      reference: doc.reference,
      message: "Godown receipt posted.",
    };
  }
  if (action === "stock.adjust") {
    owner(actor);
    let v: Row | undefined;
    if (d.locationType === "vehicle")
      v = await vehicleScope(db, actor, d.locationId, d.assignmentId);
    else await warehouseScope(db, d.locationId);
    if (d.locationType === "warehouse" && d.day)
      insist(
        d.day === (await today(db)),
        "STALE_DAY",
        "Warehouse adjustments use the current business date.",
        409,
      );
    let source: Row | undefined;
    if (d.sourceInvoiceId) {
      source = await one(
        db,
        "SELECT i.*,doc.lines AS receipt_lines FROM sanket.invoices i JOIN sanket.stock_documents doc ON doc.id=i.receipt_id WHERE i.id=$1 AND i.status='APPROVED_POSTED'",
        [d.sourceInvoiceId],
      );
      insist(
        source,
        "INVALID_RECEIPT",
        "Choose an approved and posted invoice receipt.",
      );
      insist(
        d.locationType === "warehouse" && source.warehouse_id === d.locationId,
        "RECEIPT_SCOPE",
        "Receipt corrections must use the original receiving godown.",
      );
      insist(
        source.receipt_lines.some(
          (line: TransactionLine) => line.productId === d.productId,
        ),
        "RECEIPT_PRODUCT",
        "This product was not received on the selected invoice.",
      );
    }
    const p = await one(
      db,
      "SELECT * FROM sanket.products WHERE id=$1 FOR UPDATE",
      [d.productId],
    );
    insist(
      p?.active_packaging_id,
      "PRODUCT_NOT_READY",
      "Complete packaging setup first.",
    );
    const pack = await one(db, "SELECT * FROM sanket.packaging WHERE id=$1", [
      p.active_packaging_id,
    ]);
    const doc = await createDocument(db, actor, {
      kind: "ADJUSTMENT",
      sourceDocumentId: source?.receipt_id,
      sourceInvoiceId: source?.id,
      warehouseId:
        d.locationType === "warehouse" ? d.locationId : v?.warehouse_id,
      vehicleId: v?.id,
      salesmanId: v?.salesman_id,
      salesmanName: v?.salesman_name,
      assignmentId: v?.assignment_id,
      lines: [
        {
          productId: p.id,
          productName: p.name,
          packagingId: pack!.id,
          baseUnit: pack!.base_unit,
          levels: pack!.levels,
          unitCode: pack!.base_unit,
          quantity: d.delta,
          baseQuantity: d.delta,
        },
      ],
      day: v ? await writableDay(db, v.id, d.day) : await today(db),
      notes: source
        ? `${d.reason} · correction of ${source.receipt_reference}`
        : d.reason,
    });
    await move(db, actor, doc, [
      {
        productId: d.productId,
        quantity: d.delta,
        locationType: d.locationType,
        locationId: d.locationId,
        kind: "ADJUSTMENT",
      },
    ]);
    return {
      id: doc.id,
      reference: doc.reference,
      message: "Audited adjustment posted.",
    };
  }
  if (action === "transfer.create") {
    owner(actor);
    const v = await vehicleScope(db, actor, d.vehicleId, d.assignmentId);
    await warehouseScope(db, d.warehouseId);
    insist(
      v.warehouse_id === d.warehouseId,
      "HOME_GODOWN_ONLY",
      "This vehicle can only load from its assigned home godown.",
    );
    const day = await writableDay(db, v.id, d.day),
      resolved = await resolveLines(db, d.lines);
    const doc = await createDocument(db, actor, {
      kind: "TRANSFER",
      warehouseId: d.warehouseId,
      vehicleId: v.id,
      salesmanId: v.salesman_id,
      salesmanName: v.salesman_name,
      assignmentId: v.assignment_id,
      lines: resolved.lines,
      day,
    });
    const changes: StockChange[] = [];
    for (const [productId, quantity] of resolved.totals) {
      changes.push(
        {
          productId,
          quantity: -quantity,
          locationType: "warehouse",
          locationId: d.warehouseId,
          kind: "LOAD_OUT",
        },
        {
          productId,
          quantity,
          locationType: "vehicle",
          locationId: v.id,
          kind: "LOAD",
        },
      );
    }
    await move(db, actor, doc, changes);
    return {
      id: doc.id,
      reference: doc.reference,
      message: "Stock loaded into the vehicle.",
    };
  }
  if (action === "sale.create") {
    const v = await vehicleScope(db, actor, d.vehicleId, d.assignmentId);
    insist(
      v.salesman_id && v.salesman_name,
      "ASSIGNMENT_REQUIRED",
      "Assign an active salesman before recording sales.",
    );
    const day = await writableDay(db, v.id, d.day),
      resolved = await resolveLines(db, d.lines);
    const doc = await createDocument(db, actor, {
      kind: "SALE",
      warehouseId: v.warehouse_id,
      vehicleId: v.id,
      salesmanId: v.salesman_id,
      salesmanName: v.salesman_name,
      assignmentId: v.assignment_id,
      lines: resolved.lines,
      day,
      notes: d.notes,
    });
    await move(
      db,
      actor,
      doc,
      [...resolved.totals].map(([productId, quantity]) => ({
        productId,
        quantity: -quantity,
        locationType: "vehicle",
        locationId: v.id,
        kind: "SALE",
      })),
    );
    await captureSalesInvoice(
      db,
      (await one(db, "SELECT * FROM sanket.stock_documents WHERE id=$1", [
        doc.id,
      ]))!,
      d.customer,
    );
    return {
      id: doc.id,
      reference: doc.reference,
      message: "Sale posted and vehicle stock updated.",
    };
  }
  if (action === "sale.correct") {
    const original = await one(
      db,
      "SELECT * FROM sanket.stock_documents WHERE id=$1 AND kind='SALE' FOR UPDATE",
      [d.saleId],
    );
    insist(original, "NOT_FOUND", "Sale was not found.", 404);
    const v = await vehicleScope(
      db,
      actor,
      original.vehicle_id,
      d.assignmentId,
    );
    insist(
      actor.role === "owner" || original.salesman_id === actor.id,
      "FORBIDDEN",
      "You can only correct your own sales.",
      403,
    );
    insist(
      !original.replaced_by_id && original.status === "POSTED",
      "ALREADY_CORRECTED",
      "This sale already has a linked correction.",
      409,
    );
    const day = await writableDay(db, v.id, d.day);
    if (date(original.day) !== day) owner(actor);
    insist(
      d.void || d.lines.length > 0,
      "EMPTY_SALE",
      "A corrected sale needs at least one line. Choose void to reverse it entirely.",
    );
    insist(
      !d.void || d.lines.length === 0,
      "VOID_LINES",
      "A void correction cannot contain sale lines.",
    );
    const resolved = d.void
      ? { lines: [], totals: new Map<string, number>() }
      : await resolveLines(db, d.lines);
    const doc = await createDocument(db, actor, {
      kind: "SALE",
      warehouseId: original.warehouse_id || v.warehouse_id,
      vehicleId: v.id,
      salesmanId: original.salesman_id,
      salesmanName: original.salesman_name,
      assignmentId: original.assignment_id,
      lines: resolved.lines,
      day,
      notes: d.reason,
      replacesId: original.id,
      status: d.void ? "VOID" : "POSTED",
    });
    const previous = new Map<string, number>();
    for (const line of original.lines as TransactionLine[])
      previous.set(
        line.productId,
        (previous.get(line.productId) || 0) + line.baseQuantity,
      );
    const changes: StockChange[] = [];
    for (const [productId, quantity] of previous)
      changes.push({
        productId,
        quantity,
        locationType: "vehicle",
        locationId: v.id,
        kind: "SALE_REVERSAL",
      });
    for (const [productId, quantity] of resolved.totals)
      changes.push({
        productId,
        quantity: -quantity,
        locationType: "vehicle",
        locationId: v.id,
        kind: "SALE",
      });
    await move(db, actor, doc, changes);
    const originalInvoice = await one(
      db,
      "SELECT snapshot FROM sanket.sales_invoices WHERE sale_id=$1",
      [original.id],
    );
    await captureSalesInvoice(
      db,
      (await one(db, "SELECT * FROM sanket.stock_documents WHERE id=$1", [
        doc.id,
      ]))!,
      originalInvoice?.snapshot?.customer,
    );
    await db.query(
      "UPDATE sanket.stock_documents SET status='CORRECTED',replaced_by_id=$2 WHERE id=$1",
      [original.id, doc.id],
    );
    return {
      id: doc.id,
      reference: doc.reference,
      message: d.void
        ? "Sale voided with a linked reversal."
        : "Linked sale correction posted.",
    };
  }
  insist(false, "UNKNOWN_ACTION", "Unknown stock operation.");
}
