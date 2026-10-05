import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { json, errorResponse } from "@/lib/server/responses";
import { getWarehouseReconciliation } from "@/lib/domain/reconciliation";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    return json(
      await getWarehouseReconciliation(
        await requireUser(request),
        p.get("day") || "",
        p.get("warehouseId") || undefined,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
