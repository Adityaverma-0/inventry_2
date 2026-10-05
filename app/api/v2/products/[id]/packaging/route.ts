import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { packagingHistory } from "@/lib/domain/service";
import { json, errorResponse } from "@/lib/server/responses";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return json(
      await packagingHistory(
        await requireUser(request),
        (await context.params).id,
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
