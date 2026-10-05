import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { getReportRevision } from "@/lib/domain/service";
import { json, errorResponse } from "@/lib/server/responses";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const rev = request.nextUrl.searchParams.get("revision");
    return json(
      await getReportRevision(
        await requireUser(request),
        id,
        rev ? Number(rev) : undefined,
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
