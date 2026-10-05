import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { json, errorResponse } from "@/lib/server/responses";
import { getHistory } from "@/lib/domain/history";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    return json(
      await getHistory(
        await requireUser(request),
        Object.fromEntries(
          [...request.nextUrl.searchParams].filter(([, value]) => value !== ""),
        ),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
