import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { getSalesInvoice } from "@/lib/domain/sales-invoices";
import { json, errorResponse } from "@/lib/server/responses";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return json(await getSalesInvoice(await requireUser(request), id));
  } catch (e) {
    return errorResponse(e);
  }
}
