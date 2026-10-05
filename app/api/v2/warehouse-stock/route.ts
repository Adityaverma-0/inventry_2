import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { getWarehouseStock } from "@/lib/domain/stock-requests";
import { json, errorResponse } from "@/lib/server/responses";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    return json(
      await getWarehouseStock(
        await requireUser(request),
        request.nextUrl.searchParams.get("vehicleId") || undefined,
        Number(request.nextUrl.searchParams.get("page") || 1),
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
