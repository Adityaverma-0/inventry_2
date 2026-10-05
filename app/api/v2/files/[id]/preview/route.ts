import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { query } from "@/lib/server/database";
import { HttpError } from "@/lib/server/security";
import { errorResponse } from "@/lib/server/responses";
import { readStoredFile } from "@/lib/documents/storage";
import { DocumentError } from "@/lib/documents/types";
import { invoicePreviewInfo, renderInvoicePage } from "@/lib/documents/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser(request, true);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const [invoice] = await query(
      "SELECT id,hash FROM sanket.invoices WHERE file_id=$1",
      [id],
    );
    if (!invoice) throw new HttpError("File not found.", 404);
    const file = await readStoredFile(id);
    if (file.metadata.hash !== invoice.hash)
      throw new HttpError(
        "Invoice source failed its integrity check.",
        500,
        "FILE_INTEGRITY",
      );
    const headers = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    if (request.nextUrl.searchParams.get("metadata") === "true")
      return Response.json(await invoicePreviewInfo(file), { headers });
    const raw = request.nextUrl.searchParams.get("page") || "1";
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      throw new HttpError(
        "Page must be a positive integer.",
        400,
        "INVALID_PAGE",
      );
    const preview = await renderInvoicePage(file, Number(raw));
    return new Response(new Uint8Array(preview.bytes), {
      headers: {
        ...headers,
        "Content-Type": preview.mime,
        "Content-Length": String(preview.bytes.length),
        "Content-Disposition": "inline",
        "X-Document-Pages": String(preview.pages),
        "X-Document-Page": String(preview.page),
      },
    });
  } catch (error) {
    if (error instanceof DocumentError)
      return errorResponse(
        new HttpError(error.message, error.status, error.code),
      );
    return errorResponse(error);
  }
}
