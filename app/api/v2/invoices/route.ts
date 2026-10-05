import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import {
  assertSameOrigin,
  HttpError,
  limitedBody,
  hash,
} from "@/lib/server/security";
import { json, errorResponse } from "@/lib/server/responses";
import { applyAction } from "@/lib/domain/service";
import { query, transaction } from "@/lib/server/database";
import { storeUpload, MAX_UPLOAD_BYTES } from "@/lib/documents/storage";
import { enqueueInvoice } from "@/lib/server/documents";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireUser(request, true);
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data;"))
      throw new HttpError("Choose an invoice file.", 415);
    const bytes = await limitedBody(request, MAX_UPLOAD_BYTES + 65_536);
    const form = await new Response(bytes, {
      headers: { "Content-Type": contentType },
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new HttpError("Choose a PDF, PNG or JPEG invoice.");
    const requestId = z
      .string()
      .uuid()
      .parse(form.get("requestId") || request.headers.get("idempotency-key"));
    const payload = Buffer.from(await file.arrayBuffer());
    const fingerprint = hash(
      Buffer.concat([
        Buffer.from(file.name + "\0" + file.type + "\0"),
        payload,
      ]),
    );
    const uploaded = await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `upload:${requestId}`,
      ]);
      const prior = await db.query(
        "SELECT * FROM sanket.upload_requests WHERE request_id=$1",
        [requestId],
      );
      if (prior.rows[0]) {
        if (
          prior.rows[0].actor_id !== actor.id ||
          prior.rows[0].payload_hash !== fingerprint
        )
          throw new HttpError(
            "This upload request ID was used for different content.",
            409,
            "IDEMPOTENCY_CONFLICT",
          );
        return prior.rows[0].metadata;
      }
      const existing = await db.query(
        "SELECT id FROM sanket.invoices WHERE hash=$1",
        [hash(payload)],
      );
      if (existing.rows[0])
        throw new HttpError(
          "This exact invoice was already uploaded. Open the existing invoice.",
          409,
          "DUPLICATE_INVOICE",
        );
      const metadata = await storeUpload(payload, file.name, file.type);
      await db.query(
        "INSERT INTO sanket.upload_requests(request_id,actor_id,payload_hash,metadata) VALUES($1,$2,$3,$4)",
        [requestId, actor.id, fingerprint, JSON.stringify(metadata)],
      );
      return metadata;
    });
    const result = await applyAction(
      actor,
      "invoice.create",
      {
        fileId: uploaded.fileId,
        fileName: uploaded.fileName,
        mime: uploaded.mime,
        hash: uploaded.hash,
      },
      requestId,
    );
    if (result.id) {
      const [current] = await query(
        "SELECT status,extraction_status FROM sanket.invoices WHERE id=$1",
        [result.id],
      );
      if (
        current?.status === "DRAFT" &&
        current?.extraction_status === "QUEUED"
      )
        await enqueueInvoice(result.id, uploaded.fileId);
    }
    return json(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
