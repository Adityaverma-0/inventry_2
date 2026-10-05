import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, jsonBody, HttpError } from "@/lib/server/security";
import { applyAction } from "@/lib/domain/service";
import { json, errorResponse } from "@/lib/server/responses";
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireUser(request);
    const body = z
      .object({
        action: z.string().max(80),
        data: z.record(z.unknown()),
        requestId: z.string().uuid(),
      })
      .parse(await jsonBody(request));
    if (["invoice.create", "product.import"].includes(body.action))
      throw new HttpError("Use the reviewed document or import workflow.", 403);
    return json(
      await applyAction(actor, body.action, body.data, body.requestId),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
