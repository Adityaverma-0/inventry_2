import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, HttpError } from "@/lib/server/security";
import { json, errorResponse } from "@/lib/server/responses";
import { query } from "@/lib/server/database";
import { enqueueInvoice } from "@/lib/server/documents";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    await requireUser(request, true);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const [invoice] = await query(
      "SELECT id,file_id,status FROM sanket.invoices WHERE id=$1",
      [id],
    );
    if (!invoice) throw new HttpError("Invoice not found.", 404);
    if (invoice.status !== "DRAFT" && invoice.status !== "REJECTED")
      throw new HttpError(
        "Only a draft or rejected invoice can be extracted again.",
        409,
      );
    return json(await enqueueInvoice(id, invoice.file_id), 202);
  } catch (error) {
    return errorResponse(error);
  }
}
