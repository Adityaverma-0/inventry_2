import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { previewReport } from "@/lib/domain/service";
import { json, errorResponse } from "@/lib/server/responses";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    return json(
      await previewReport(
        await requireUser(request),
        p.get("day") || "",
        p.get("vehicleId") || "",
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
