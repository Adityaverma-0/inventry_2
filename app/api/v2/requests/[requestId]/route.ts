import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, jsonBody } from "@/lib/server/security";
import { json, errorResponse } from "@/lib/server/responses";
import { lookupSaleRequest, cancelSaleRequest } from "@/lib/domain/requests";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ requestId: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    return json(
      await lookupSaleRequest(
        await requireUser(request),
        (await context.params).requestId,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request);
    const actor = await requireUser(request);
    const body = z
      .object({ action: z.literal("cancel"), data: z.record(z.unknown()) })
      .strict()
      .parse(await jsonBody(request));
    return json(
      await cancelSaleRequest(
        actor,
        (await context.params).requestId,
        body.data,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
