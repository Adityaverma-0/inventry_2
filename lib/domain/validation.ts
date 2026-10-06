import { z } from "zod";
import { DomainError } from "./errors";
import type { Row } from "./common";
const id = z.string().uuid();
const text = z.string().trim().max(1000);
const name = z.string().trim().min(1).max(200);
const reason = z.string().trim().min(3).max(2000);
const whole = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = whole.min(1);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid date");
const line = z
  .object({
    productId: id,
    packagingId: id,
    unitCode: name,
    quantity: positive,
  })
  .strict();
const lines = z.array(line).min(1).max(300);
const scope = { assignmentId: id.optional(), day: day.optional() };
const revision = { id, revision: positive };
const invoiceLine = z
  .object({
    description: text,
    productId: id,
    packagingId: id,
    unitCode: name,
    invoiceQuantity: whole,
    receivedQuantity: whole,
    reason: text.default(""),
    evidence: text.default(""),
    freeQuantity: whole.optional(),
  })
  .strict();
export const schemas: Record<string, z.ZodTypeAny> = {
  "inventory-request.create": z
    .object({
      kind: z.enum(["RETURN", "HOLD", "ALLOCATION", "ADJUSTMENT"]),
      vehicleId: id,
      assignmentId: id,
      day: day.optional(),
      lines: z.array(line).max(300).default([]),
      reason,
      productId: id.optional(),
      packagingId: id.optional(),
      delta: z
        .number()
        .int()
        .min(-Number.MAX_SAFE_INTEGER)
        .max(Number.MAX_SAFE_INTEGER)
        .refine((v) => v !== 0)
        .optional(),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (
        v.kind === "ADJUSTMENT" &&
        (!v.productId || !v.packagingId || v.delta === undefined)
      )
        ctx.addIssue({
          code: "custom",
          message: "Choose a product and a nonzero base-unit correction.",
        });
    }),
  "inventory-request.approve": z.object({ id, reason }).strict(),
  "inventory-request.reject": z.object({ id, reason }).strict(),
  "location.save": z
    .object({ id: id.optional(), name, active: z.boolean().default(true) })
    .strict(),
  "warehouse.save": z
    .object({
      id: id.optional(),
      name,
      locationId: id,
      active: z.boolean().default(true),
    })
    .strict(),
  "vehicle.save": z
    .object({
      id: id.optional(),
      name,
      registration: text.default(""),
      warehouseId: id,
      active: z.boolean().default(true),
      schedule: text.nullable().optional(),
      maintenanceDate: day.nullable().optional(),
    })
    .strict(),
  "assignment.save": z
    .object({
      vehicleId: id,
      salesmanId: id.nullable(),
      reason: text.default(""),
    })
    .strict(),
  "product.save": z
    .object({
      id: id.optional(),
      sku: text.default(""),
      name,
      category: name,
      active: z.boolean().default(true),
      minStock: whole.default(0),
      price: z
        .union([
          z.string().regex(/^\d{1,14}(\.\d{1,2})?$/),
          z
            .number()
            .nonnegative()
            .max(99999999999999)
            .refine(
              (value) => Number(value.toFixed(2)) === value,
              "Prices may have at most two decimal places.",
            ),
        ])
        .nullable()
        .optional(),
      priceUnit: name.nullable().optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .default("INR"),
      rawImport: z.record(z.string().max(10000)).optional(),
    })
    .strict(),
  "packaging.save": z
    .object({
      productId: id,
      baseUnit: name,
      priceBasis: z
        .object({
          price: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/),
          unitCode: name,
          currency: z.string().regex(/^[A-Z]{3}$/),
        })
        .strict()
        .optional(),
      levels: z
        .array(z.object({ code: name, label: name, factor: positive }).strict())
        .min(1)
        .max(10),
      reason,
    })
    .strict(),
  "stock.receive": z
    .object({
      warehouseId: id,
      kind: z.enum(["OPENING", "MANUAL_RECEIPT"]),
      lines,
      notes: reason,
      reference: name,
    })
    .strict(),
  "stock.adjust": z
    .object({
      locationId: id,
      locationType: z.enum(["warehouse", "vehicle"]),
      productId: id,
      sourceInvoiceId: id.optional(),
      delta: z
        .number()
        .int()
        .min(-Number.MAX_SAFE_INTEGER)
        .max(Number.MAX_SAFE_INTEGER)
        .refine((v) => v !== 0),
      reason,
      ...scope,
    })
    .strict(),
  "transfer.create": z
    .object({ warehouseId: id, vehicleId: id, lines, ...scope })
    .strict(),
  "sale.create": z
    .object({
      vehicleId: id,
      lines,
      notes: text.default(""),
      customer: z
        .object({
          name: text.default(""),
          phone: text.default(""),
          address: text.default(""),
          gstin: text.default(""),
        })
        .strict()
        .optional(),
      tax: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).optional(),
      discount: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).optional(),
      payments: z
        .array(
          z.object({
            method: z.string().min(1),
            amount: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/),
            reference: text.optional(),
          })
        )
        .optional(),
      ...scope,
    })
    .strict(),
  "sale.correct": z
    .object({
      saleId: id,
      lines: z.array(line).max(300),
      reason,
      void: z.boolean().default(false),
      tax: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).optional(),
      discount: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).optional(),
      payments: z
        .array(
          z.object({
            method: z.string().min(1),
            amount: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/),
            reference: text.optional(),
          })
        )
        .optional(),
      ...scope,
    })
    .strict(),
  "report.submit": z
    .object({
      vehicleId: id,
      day,
      notes: text.default(""),
      expectedSourceHash: z.string().min(32).max(128),
    })
    .strict(),
  "report.approve": z
    .object({ ...revision, reason: text.default("") })
    .strict(),
  "report.reject": z.object({ ...revision, reason }).strict(),
  "report.reopen": z.object({ ...revision, reason }).strict(),
  "invoice.create": z
    .object({
      fileId: name,
      fileName: name,
      mime: name,
      hash: z.string().min(16).max(128),
      extractionStatus: z
        .enum(["QUEUED", "PROCESSING", "COMPLETED", "FAILED"])
        .default("QUEUED"),
    })
    .strict(),
  "invoice.update": z
    .object({
      ...revision,
      supplier: name,
      invoiceNumber: name,
      invoiceDate: day,
      warehouseId: id,
      lines: z.array(invoiceLine).min(1).max(300),
      reason: text.default(""),
    })
    .strict(),
  "invoice.ready": z.object({ ...revision, reason: text.default("") }).strict(),
  "invoice.approve": z
    .object({ ...revision, reason: text.default("") })
    .strict(),
  "invoice.reject": z.object({ ...revision, reason }).strict(),
  "settings.save": z
    .object({
      businessName: name,
      timezone: name.refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Invalid timezone"),
      phone: text,
      address: text,
      trackingInterval: z.number().int().min(15).max(3600),
      staleMinutes: z.number().int().min(1).max(1440),
      retentionDays: z.number().int().min(1).max(365),
    })
    .strict(),
  "location.record": z
    .object({
      vehicleId: id,
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().min(0).max(100000),
      capturedAt: z.string().datetime(),
      assignmentId: id.optional(),
    })
    .strict(),
};
schemas["product.import"] = z
  .object({
    products: z.array(schemas["product.save"]).min(1).max(500),
    importHash: z.string().min(16).max(128),
  })
  .strict();
export function parseAction(action: string, data: unknown): Row {
  const schema = schemas[action];
  if (!schema)
    throw new DomainError("UNKNOWN_ACTION", "Unknown operation.", 404);
  const result = schema.safeParse(data);
  if (!result.success)
    throw new DomainError(
      "VALIDATION",
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return result.data;
}
export function uuid(value: string): void {
  if (!id.safeParse(value).success)
    throw new DomainError("VALIDATION", "Invalid record ID.");
}
export function validDay(value: string): void {
  if (!day.safeParse(value).success)
    throw new DomainError("VALIDATION", "Invalid business date.");
}
