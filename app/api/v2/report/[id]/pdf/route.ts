import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/security";
import { errorResponse } from "@/lib/server/responses";
import { getReportRevision } from "@/lib/domain/service";
import { renderReportPdf } from "@/lib/documents/report-pdf";

export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireUser(request),
      { id } = await context.params;
    const revision = request.nextUrl.searchParams.get("revision");
    if (
      revision !== null &&
      (!/^[1-9]\d*$/.test(revision) || !Number.isSafeInteger(Number(revision)))
    )
      throw new HttpError("Choose a positive report revision.");
    const report = await getReportRevision(
      actor,
      id,
      revision === null ? undefined : Number(revision),
    );
    const bytes = await renderReportPdf(report);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="daily-report-${report.day}-revision-${report.revision}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
