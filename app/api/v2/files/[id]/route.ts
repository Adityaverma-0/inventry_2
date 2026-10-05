import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/security";
import { errorResponse } from "@/lib/server/responses";
import { query } from "@/lib/server/database";
import { readStoredFile } from "@/lib/documents/storage";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser(request, true);
    const { id } = await context.params;
    const [invoice] = await query(
      "SELECT id FROM sanket.invoices WHERE file_id=$1",
      [id],
    );
    if (!invoice) throw new HttpError("File not found.", 404);
    const { metadata, bytes } = await readStoredFile(id);
    const disposition =
      request.nextUrl.searchParams.get("download") === "true"
        ? "attachment"
        : "inline";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": metadata.mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "frame-ancestors 'self'",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
