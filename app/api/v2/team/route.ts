import type { NextRequest } from "next/server";
import { requireUser, saveTeamMember } from "@/lib/server/auth";
import { assertSameOrigin, jsonBody } from "@/lib/server/security";
import { json, errorResponse } from "@/lib/server/responses";
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    return json(
      await saveTeamMember(
        await requireUser(request, true),
        await jsonBody(request, 20000),
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
