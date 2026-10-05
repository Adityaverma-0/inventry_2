import { z } from "zod";
import { transaction } from "@/lib/server/database";
import type { Actor } from "./types";
import { actorCheck, date, iso, owner, type Row } from "./common";
import { DomainError, insist } from "./errors";
import { validDay } from "./validation";
import { readRevision } from "./reports";
const filterSchema = z
  .object({
    kind: z.enum([
      "sales",
      "movements",
      "invoices",
      "audit",
      "transfers",
      "reports",
    ]),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    from: z.string().optional(),
    to: z.string().optional(),
    vehicleId: z.string().uuid().optional(),
    warehouseId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    salesmanId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
    category: z.string().max(200).optional(),
    status: z.string().max(50).optional(),
    search: z.string().trim().max(200).optional(),
  })
  .strict();
export type HistoryFilter = z.input<typeof filterSchema>;
export type HistoryPage = {
  items: unknown[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};
export async function getHistory(
  actor: Actor,
  input: HistoryFilter | Record<string, unknown>,
): Promise<HistoryPage> {
  const parsed = filterSchema.safeParse(input);
  if (!parsed.success)
    throw new DomainError(
      "VALIDATION",
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  const f = parsed.data;
  if (f.from) validDay(f.from);
  if (f.to) validDay(f.to);
  insist(
    !f.from || !f.to || f.from <= f.to,
    "DATE_RANGE",
    "Choose an ordered date range.",
  );
  if (f.kind === "invoices" || f.kind === "audit") owner(actor);
  return transaction(async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await actorCheck(db, actor);
    const values: unknown[] = [],
      conditions: string[] = [];
    const parameter = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const equal = (expression: string, value: unknown) => {
      if (value !== undefined)
        conditions.push(`${expression}=${parameter(value)}`);
    };
    let table: string,
      selection: string,
      dayExpression: string,
      order: string,
      vehicleExpression: string | undefined,
      warehouseExpression: string | undefined,
      productExpression: string | undefined,
      linesExpression: string | undefined,
      salesmanExpression: string | undefined,
      statusExpression: string | undefined,
      locationExpression: string | undefined;
    if (f.kind === "sales" || f.kind === "transfers") {
      table =
        "sanket.stock_documents d LEFT JOIN sanket.vehicles v ON v.id=d.vehicle_id LEFT JOIN sanket.warehouses w ON w.id=COALESCE(d.warehouse_id,v.warehouse_id)";
      if (f.kind === "sales")
        table += " LEFT JOIN sanket.sales_invoices si ON si.sale_id=d.id";
      selection =
        f.kind === "sales"
          ? "d.*,si.invoice_number,si.snapshot->'customer'->>'name' AS customer_name"
          : "d.*";
      dayExpression = "d.day";
      order = "d.created_at DESC,d.id";
      vehicleExpression = "d.vehicle_id";
      warehouseExpression = "COALESCE(d.warehouse_id,v.warehouse_id)";
      salesmanExpression = "d.salesman_id";
      statusExpression = "d.status";
      locationExpression = "w.location_id";
      linesExpression = "d.lines";
      equal("d.kind", f.kind === "sales" ? "SALE" : "TRANSFER");
      if (actor.role !== "owner") equal("d.salesman_id", actor.id);
    } else if (f.kind === "movements") {
      table =
        "sanket.stock_movements m JOIN sanket.stock_documents d ON d.id=m.document_id LEFT JOIN sanket.vehicles v ON m.location_type='vehicle' AND v.id=m.location_id LEFT JOIN sanket.warehouses w ON w.id=CASE WHEN m.location_type='warehouse' THEN m.location_id ELSE v.warehouse_id END";
      selection = "m.*";
      dayExpression = "m.day";
      order = "m.created_at DESC,m.id";
      vehicleExpression = "v.id";
      warehouseExpression = "w.id";
      salesmanExpression = "d.salesman_id";
      locationExpression = "w.location_id";
      productExpression = "m.product_id";
      statusExpression = "m.kind";
      if (actor.role !== "owner") {
        equal("m.location_type", "vehicle");
        equal("d.salesman_id", actor.id);
      }
    } else if (f.kind === "invoices") {
      table =
        "sanket.invoices i LEFT JOIN sanket.warehouses w ON w.id=i.warehouse_id LEFT JOIN sanket.users u ON u.id=i.approved_by";
      selection = "i.*,u.name AS approver_name";
      dayExpression =
        "(i.created_at AT TIME ZONE (SELECT data->>'timezone' FROM sanket.settings WHERE id=true))::date";
      order = "i.created_at DESC,i.id";
      warehouseExpression = "i.warehouse_id";
      locationExpression = "w.location_id";
      statusExpression = "i.status";
      linesExpression = "i.lines";
    } else if (f.kind === "reports") {
      table =
        "sanket.daily_reports d JOIN sanket.report_revisions r ON r.report_id=d.id AND r.revision=d.revision JOIN sanket.vehicles v ON v.id=d.vehicle_id JOIN sanket.warehouses w ON w.id=v.warehouse_id";
      selection = "d.id,d.revision";
      dayExpression = "d.day";
      order = "d.day DESC,d.id";
      vehicleExpression = "d.vehicle_id";
      warehouseExpression = "v.warehouse_id";
      locationExpression = "w.location_id";
      salesmanExpression = "r.snapshot->>'salesmanId'";
      statusExpression = "d.status";
      linesExpression = "r.snapshot->'lines'";
      if (actor.role !== "owner") equal(salesmanExpression, actor.id);
    } else {
      table = "sanket.audit a";
      selection = "a.*";
      dayExpression =
        "(a.created_at AT TIME ZONE (SELECT data->>'timezone' FROM sanket.settings WHERE id=true))::date";
      order = "a.created_at DESC,a.id";
      salesmanExpression = "a.actor_id";
      statusExpression = "a.action";
    }
    const supported = (
      expression: string | undefined,
      value: unknown,
      label: string,
    ) => {
      if (value !== undefined) {
        insist(
          expression,
          "UNSUPPORTED_FILTER",
          `${label} does not apply to this history.`,
        );
        equal(expression, value);
      }
    };
    supported(vehicleExpression, f.vehicleId, "Vehicle");
    supported(warehouseExpression, f.warehouseId, "Godown");
    supported(locationExpression, f.locationId, "Location");
    supported(salesmanExpression, f.salesmanId, "Salesman");
    supported(statusExpression, f.status, "Status");
    if (f.from) conditions.push(`${dayExpression}>=${parameter(f.from)}::date`);
    if (f.to) conditions.push(`${dayExpression}<=${parameter(f.to)}::date`);
    if (f.productId) {
      if (productExpression) equal(productExpression, f.productId);
      else {
        insist(
          linesExpression,
          "UNSUPPORTED_FILTER",
          "Product does not apply to this history.",
        );
        conditions.push(
          `EXISTS(SELECT 1 FROM jsonb_array_elements(${linesExpression}) line WHERE line->>'productId'=${parameter(f.productId)})`,
        );
      }
    }
    if (f.category) {
      if (productExpression)
        conditions.push(
          `EXISTS(SELECT 1 FROM sanket.products p WHERE p.id=${productExpression} AND p.category=${parameter(f.category)})`,
        );
      else {
        insist(
          linesExpression,
          "UNSUPPORTED_FILTER",
          "Category does not apply to this history.",
        );
        conditions.push(
          `EXISTS(SELECT 1 FROM jsonb_array_elements(${linesExpression}) line JOIN sanket.products p ON p.id::text=line->>'productId' WHERE p.category=${parameter(f.category)})`,
        );
      }
    }
    if (f.search) {
      insist(
        f.kind === "invoices" || f.kind === "audit" || f.kind === "sales",
        "UNSUPPORTED_FILTER",
        "Text search is available for sales, invoices and audit history.",
      );
      const text =
        f.kind === "sales"
          ? "concat_ws(' ',d.reference,d.salesman_name,COALESCE(si.invoice_number,'SI-'||upper(d.id::text)),si.snapshot->'customer'->>'name',si.snapshot->'customer'->>'phone')"
          : f.kind === "invoices"
            ? "concat_ws(' ',i.supplier,i.invoice_number,i.file_name)"
            : "concat_ws(' ',a.action,a.actor_name,a.detail::text)";
      conditions.push(`strpos(lower(${text}),lower(${parameter(f.search)}))>0`);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const total = Number(
      (await db.query(`SELECT COUNT(*) AS count FROM ${table}${where}`, values))
        .rows[0].count,
    );
    const rows = (
      await db.query(
        `SELECT ${selection} FROM ${table}${where} ORDER BY ${order} LIMIT ${parameter(f.pageSize)} OFFSET ${parameter((f.page - 1) * f.pageSize)}`,
        values,
      )
    ).rows;
    const items: unknown[] = [];
    for (const r of rows as Row[]) {
      if (f.kind === "sales")
        items.push({
          id: r.id,
          reference: r.reference,
          invoiceNumber: r.invoice_number || `SI-${r.id.toUpperCase()}`,
          customerName: r.customer_name || "",
          vehicleId: r.vehicle_id,
          warehouseId: r.warehouse_id,
          salesmanId: r.salesman_id,
          salesmanName: r.salesman_name,
          day: date(r.day),
          status: r.status,
          lines: r.lines,
          notes: r.notes,
          createdAt: iso(r.created_at),
          replacesId: r.replaces_id,
          replacedById: r.replaced_by_id,
        });
      else if (f.kind === "transfers")
        items.push({
          id: r.id,
          reference: r.reference,
          warehouseId: r.warehouse_id,
          vehicleId: r.vehicle_id,
          lines: r.lines,
          createdAt: iso(r.created_at),
          actorName: r.actor_name,
        });
      else if (f.kind === "movements")
        items.push({
          id: r.id,
          productId: r.product_id,
          locationId: r.location_id,
          locationType: r.location_type,
          kind: r.kind,
          quantity: Number(r.quantity),
          reference: r.reference,
          actorName: r.actor_name,
          createdAt: iso(r.created_at),
          day: date(r.day),
          note: r.note,
        });
      else if (f.kind === "audit")
        items.push({
          id: r.id,
          action: r.action,
          entityId: r.entity_id,
          actorName: r.actor_name,
          detail: JSON.stringify(r.detail),
          createdAt: iso(r.created_at),
        });
      else if (f.kind === "reports")
        items.push(await readRevision(db, actor, r.id, r.revision));
      else
        items.push({
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
          extractionMeta: r.extraction_meta || {},
          extractionWarnings: r.extraction_meta?.warnings || [],
          lines: r.lines,
          createdAt: iso(r.created_at),
          approvedAt: r.approved_at ? iso(r.approved_at) : null,
          approvedBy: r.approver_name,
          receiptReference: r.receipt_reference,
          decisionReason: r.decision_reason,
        });
    }
    return {
      items,
      total,
      page: f.page,
      pageSize: f.pageSize,
      hasMore: f.page * f.pageSize < total,
    };
  });
}
