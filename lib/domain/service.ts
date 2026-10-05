import { transaction } from "@/lib/server/database";
import type {
  Actor,
  ActionResult,
  AppState,
  DailyReport,
  Packaging,
} from "./types";
import { DomainError, insist } from "./errors";
import {
  actorCheck,
  audit,
  hash,
  iso,
  one,
  owner,
  packaging,
  settings,
  uid,
  vehicleScope,
} from "./common";
import { parseAction, uuid } from "./validation";
import { masterAction } from "./masters";
import { inventoryAction } from "./inventory";
import { invoiceAction } from "./invoices";
import { buildReport, readRevision, reportAction } from "./reports";
import { stockRequestAction } from "./stock-requests";
import { readState } from "./state";
import type { ExtractionUpdate } from "@/lib/documents/types";
function databaseError(error: unknown): never {
  if (error instanceof DomainError) throw error;
  const e = error as { code?: string; constraint?: string };
  if (e.code === "23505")
    throw new DomainError(
      "DUPLICATE_RECORD",
      "This record already exists. Check the product SKU/name, invoice number/file or active assignment.",
      409,
    );
  if (e.code === "23503")
    throw new DomainError(
      "INVALID_REFERENCE",
      "A selected record no longer exists. Refresh and choose it again.",
      409,
    );
  if (e.code === "22003" || e.code === "23514")
    throw new DomainError(
      "INVALID_VALUE",
      "The operation violates an inventory or data constraint.",
      400,
    );
  throw error;
}
export async function applyAction(
  actor: Actor,
  action: string,
  data: unknown,
  requestId: string,
): Promise<ActionResult> {
  insist(
    typeof action === "string" && action.length < 100,
    "VALIDATION",
    "Invalid operation.",
  );
  insist(
    typeof requestId === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(requestId),
    "REQUEST_ID_REQUIRED",
    "Use a stable request ID for each operation.",
  );
  const parsed = parseAction(action, data);
  const payloadHash = hash(data);
  try {
    return await transaction(async (db) => {
      // A single short business write mutex makes multi-entity report/assignment transitions
      // serializable. Stock rows also lock individually; replace the mutex with scoped
      // locks only after profiling, retaining the same invariant-oriented tests.
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtext('sanket-business-write'))",
      );
      await actorCheck(db, actor);
      const previous = await one(
        db,
        "SELECT * FROM sanket.requests WHERE actor_id=$1 AND action=$2 AND request_id=$3",
        [actor.id, action, requestId],
      );
      if (previous) {
        insist(
          previous.payload_hash === payloadHash,
          "IDEMPOTENCY_CONFLICT",
          "This request ID was already used for different data. Restore the original request or start a reviewed new operation.",
          409,
        );
        insist(
          previous.result.state !== "CANCELLED",
          "REQUEST_CANCELLED",
          "This pending request was cancelled. Review the entry before creating a new request.",
          409,
        );
        return previous.result;
      }
      let result: ActionResult;
      if (action === "product.import") {
        owner(actor);
        const ids: string[] = [];
        for (const product of parsed.products) {
          const saved = await masterAction(db, actor, "product.save", product);
          ids.push(saved.id);
        }
        result = {
          ids,
          message: `Imported ${ids.length} catalogue product(s). Live stock is unchanged.`,
        };
      } else if (action.startsWith("inventory-request."))
        result = (await stockRequestAction(
          db,
          actor,
          action,
          parsed,
        )) as ActionResult;
      else if (action.startsWith("invoice."))
        result = (await invoiceAction(
          db,
          actor,
          action,
          parsed,
        )) as ActionResult;
      else if (action.startsWith("report."))
        result = (await reportAction(
          db,
          actor,
          action,
          parsed,
        )) as ActionResult;
      else if (
        action.startsWith("stock.") ||
        action.startsWith("transfer.") ||
        action.startsWith("sale.")
      )
        result = (await inventoryAction(
          db,
          actor,
          action,
          parsed,
        )) as ActionResult;
      else if (action === "location.record") { throw new Error("Location tracking disabled"); } else
        result = (await masterAction(
          db,
          actor,
          action,
          parsed,
        )) as ActionResult;
      await audit(db, actor, action, String(result.id || ""), parsed);
      await db.query(
        "INSERT INTO sanket.requests(actor_id,action,request_id,payload_hash,result) VALUES($1,$2,$3,$4,$5)",
        [actor.id, action, requestId, payloadHash, JSON.stringify(result)],
      );
      return result;
    });
  } catch (error) {
    return databaseError(error);
  }
}
export async function getState(actor: Actor): Promise<AppState> {
  return transaction(async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await actorCheck(db, actor);
    return readState(db, actor);
  });
}
export async function getExportState(actor: Actor): Promise<AppState> {
  return transaction(async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await actorCheck(db, actor);
    return readState(db, actor, { unlimited: true });
  });
}
export async function previewReport(
  actor: Actor,
  day: string,
  vehicleId: string,
): Promise<DailyReport> {
  return transaction(async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock_shared(hashtext('sanket-business-write'))",
    );
    await actorCheck(db, actor);
    return buildReport(db, actor, day, vehicleId);
  });
}
export async function getReportRevision(
  actor: Actor,
  id: string,
  revision?: number,
): Promise<DailyReport> {
  return transaction(async (db) => {
    await actorCheck(db, actor);
    return readRevision(db, actor, id, revision);
  });
}
export async function packagingHistory(
  actor: Actor,
  productId: string,
): Promise<Packaging[]> {
  uuid(productId);
  return transaction(async (db) => {
    await actorCheck(db, actor);
    const rows = (
      await db.query(
        "SELECT * FROM sanket.packaging WHERE product_id=$1 ORDER BY version DESC",
        [productId],
      )
    ).rows;
    return rows.map(packaging);
  });
}
/** Internal extraction boundary: suggestions can never modify reviewed lines or inventory. */
export async function setInvoiceExtraction(
  id: string,
  result: ExtractionUpdate,
): Promise<void> {
  uuid(id);
  insist(
    ["QUEUED", "PROCESSING", "COMPLETED", "FAILED"].includes(
      result.extractionStatus,
    ),
    "EXTRACTION_STATUS",
    "Invalid extraction status.",
  );
  insist(
    JSON.stringify(result).length <= 2_000_000,
    "EXTRACTION_TOO_LARGE",
    "Extraction result is too large.",
  );
  await transaction(async (db) => {
    const invoice = await one(
      db,
      "SELECT id,status FROM sanket.invoices WHERE id=$1 FOR UPDATE",
      [id],
    );
    insist(invoice, "NOT_FOUND", "Invoice was not found.", 404);
    insist(
      invoice.status !== "APPROVED_POSTED",
      "INVOICE_POSTED",
      "Approved invoices cannot be re-extracted.",
      409,
    );
    const {
      extractionStatus,
      extractionError,
      extractedText,
      suggestions,
      ...meta
    } = result;
    await db.query(
      "UPDATE sanket.invoices SET extraction_status=$2,extraction_error=$3,extracted_text=COALESCE($4,extracted_text),suggestions=COALESCE($5,suggestions),extraction_meta=COALESCE(extraction_meta,'{}'::jsonb)||$6::jsonb WHERE id=$1",
      [
        id,
        extractionStatus,
        extractionError || "",
        extractedText ?? null,
        suggestions ? JSON.stringify(suggestions) : null,
        JSON.stringify(meta),
      ],
    );
  });
}

export async function getInvoiceHistory(
  actor: Actor,
  id: string,
): Promise<{
  revisions: unknown[];
  decisions: unknown[];
  corrections: unknown[];
}> {
  owner(actor);
  uuid(id);
  return transaction(async (db) => {
    await actorCheck(db, actor);
    insist(
      await one(db, "SELECT id FROM sanket.invoices WHERE id=$1", [id]),
      "NOT_FOUND",
      "Invoice was not found.",
      404,
    );
    const revisions = (
      await db.query(
        "SELECT r.*,u.name AS actor_name FROM sanket.invoice_revisions r JOIN sanket.users u ON u.id=r.actor_id WHERE r.invoice_id=$1 ORDER BY r.revision",
        [id],
      )
    ).rows;
    const decisions = (
      await db.query(
        "SELECT action,actor_name,detail,created_at FROM sanket.audit WHERE entity_id=$1 AND action IN ('invoice.ready','invoice.approve','invoice.reject') ORDER BY created_at,id",
        [id],
      )
    ).rows;
    const corrections = (
      await db.query(
        "SELECT id,reference,lines,notes,created_at,actor_name,source_document_id FROM sanket.stock_documents WHERE source_invoice_id=$1 ORDER BY created_at,id",
        [id],
      )
    ).rows;
    return {
      revisions: revisions.map((r) => ({
        revision: r.revision,
        snapshot: r.snapshot,
        actorName: r.actor_name,
        createdAt: iso(r.created_at),
      })),
      decisions: decisions.map((r) => ({
        action: r.action,
        actorName: r.actor_name,
        detail: r.detail,
        createdAt: iso(r.created_at),
      })),
      corrections: corrections.map((r) => ({
        id: r.id,
        reference: r.reference,
        lines: r.lines,
        reason: r.notes,
        actorName: r.actor_name,
        createdAt: iso(r.created_at),
        sourceDocumentId: r.source_document_id,
      })),
    };
  });
}

export { getHistory } from "./history";
export { getWarehouseReconciliation } from "./reconciliation";

export { lookupSaleRequest, cancelSaleRequest } from "./requests";
