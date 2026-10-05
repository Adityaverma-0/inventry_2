import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import {
  assertSameOrigin,
  jsonBody,
  HttpError,
  hash,
} from "@/lib/server/security";
import { json, errorResponse } from "@/lib/server/responses";
import { transaction } from "@/lib/server/database";
import { applyAction, getState } from "@/lib/domain/service";
import {
  previewProductImport,
  prepareProductImport,
  type ColumnMapping,
} from "@/lib/documents/csv";
const schema = z.object({
  csv: z.string().max(5 * 1024 * 1024),
  confirm: z.boolean().default(false),
  requestId: z.string().uuid().optional(),
  mapping: z.record(z.string()).optional(),
  decisions: z
    .array(
      z.object({
        rowNumber: z.number().int().positive(),
        action: z.enum(["create", "update", "skip"]),
        productId: z.string().uuid().optional(),
        confirmPrice: z.boolean().optional(),
        currency: z.string().optional(),
        priceUnit: z.string().optional(),
        confirmMinimumStock: z.boolean().optional(),
      }),
    )
    .max(5000)
    .optional(),
});
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireUser(request, true);
    const body = schema.parse(await jsonBody(request, 6 * 1024 * 1024));
    const { products } = await getState(actor);
    const mapping = body.mapping as ColumnMapping | undefined;
    if (!body.confirm)
      return json(previewProductImport(body.csv, products, mapping));
    if (!body.requestId || !body.decisions)
      throw new HttpError(
        "Review rows and supply import decisions before confirming.",
      );
    // Save the validated plan before posting. On a response-loss retry the catalogue
    // already contains created rows, so recomputing a create plan would reject it.
    const fingerprint = hash(
      JSON.stringify({
        csv: body.csv,
        mapping: body.mapping,
        decisions: body.decisions,
      }),
    );
    const plan = await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `import:${actor.id}:${body.requestId}`,
      ]);
      const old = await db.query(
        "SELECT payload_hash,result FROM sanket.requests WHERE actor_id=$1 AND action='product.import.prepare' AND request_id=$2",
        [actor.id, body.requestId],
      );
      if (old.rows[0]) {
        if (old.rows[0].payload_hash !== fingerprint)
          throw new HttpError(
            "This import request ID was used for different source data or decisions.",
            409,
            "IDEMPOTENCY_CONFLICT",
          );
        return old.rows[0].result;
      }
      const prepared = prepareProductImport(
        body.csv,
        products,
        mapping,
        body.decisions!,
      );
      const value = {
        products: prepared.products,
        importHash: prepared.preview.fileHash,
        summary: prepared.summary,
      };
      await db.query(
        "INSERT INTO sanket.requests(actor_id,action,request_id,payload_hash,result) VALUES($1,'product.import.prepare',$2,$3,$4::jsonb)",
        [actor.id, body.requestId, fingerprint, JSON.stringify(value)],
      );
      return value;
    });
    if (!plan.products.length)
      return json({
        message: "All rows skipped. No products or stock changed.",
        summary: plan.summary,
      });
    const result = await applyAction(
      actor,
      "product.import",
      { products: plan.products, importHash: plan.importHash },
      body.requestId,
    );
    return json({ ...result, summary: plan.summary });
  } catch (error) {
    return errorResponse(error);
  }
}
