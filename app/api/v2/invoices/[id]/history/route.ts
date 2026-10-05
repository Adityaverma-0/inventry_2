import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { getInvoiceHistory } from "@/lib/domain/service";
import { errorResponse, json } from "@/lib/server/responses";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return json(
      await getInvoiceHistory(
        await requireUser(request, true),
        (await context.params).id,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
