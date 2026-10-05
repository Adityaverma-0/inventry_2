import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { query } from "@/lib/server/database";
import { json, errorResponse } from "@/lib/server/responses";
import { HttpError } from "@/lib/server/security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireUser(request);
    
    // Check report status
    const reportList = await query(
      "SELECT salesman_id, status FROM sanket.feature_daily_reports WHERE id = $1", 
      [params.id]
    );
    if (reportList.length === 0) throw new HttpError("Report not found.", 404);
    const report = reportList[0];
    if (report.salesman_id !== actor.id) throw new HttpError("Forbidden.", 403);
    if (report.status !== 'DRAFT' && report.status !== 'REJECTED') {
        throw new HttpError("Report cannot be modified in submitted/approved status.", 400);
    }

    const body = await request.json();
    const { productId, type, qty, reason } = body; // type HOLD or UNLOAD
    
    if (!productId || !['HOLD', 'UNLOAD'].includes(type) || qty <= 0) {
       throw new HttpError("Invalid input.", 400);
    }
    
    // TODO: Verify qty <= available vehicle stock
    
    await query(
      "INSERT INTO sanket.feature_daily_report_items (report_id, product_id, type, qty, reason) VALUES ($1, $2, $3, $4, $5)",
      [params.id, productId, type, qty, reason]
    );

    return json({ message: "Item request added." });
  } catch (e) {
    return errorResponse(e);
  }
}
