import { startDocumentWorker } from "@/lib/server/documents";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { getState } from "@/lib/domain/service";
import { json, errorResponse } from "@/lib/server/responses";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    startDocumentWorker();
    return json(await getState(actor));
  } catch (e) {
    return errorResponse(e);
  }
}
