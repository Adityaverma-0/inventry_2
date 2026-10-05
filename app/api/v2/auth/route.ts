import type { NextRequest } from "next/server";
import { authStatus, handleAuth } from "@/lib/server/auth";
import { assertSameOrigin, jsonBody } from "@/lib/server/security";
import { json, errorResponse } from "@/lib/server/responses";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    return json(await authStatus(request));
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    return await handleAuth(request, await jsonBody(request, 10000));
  } catch (e) {
    return errorResponse(e);
  }
}
