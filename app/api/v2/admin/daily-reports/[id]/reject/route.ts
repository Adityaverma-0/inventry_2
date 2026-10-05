import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { transaction } from "@/lib/server/database";
import { json, errorResponse } from "@/lib/server/responses";
import { HttpError } from "@/lib/server/security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireUser(request, true);
    const body = await request.json();
    const { remark } = body;
    if (!remark) throw new HttpError("Remark is required for rejection.", 400);
    
    await transaction(async (client) => {
        const reportRes = await client.query(
            "SELECT * FROM sanket.feature_daily_reports WHERE id = $1 FOR UPDATE", 
            [params.id]
        );
        if (reportRes.rowCount === 0) throw new HttpError("Report not found", 404);
        
        await client.query(
            "UPDATE sanket.feature_daily_reports SET status = 'REJECTED', approved_by = $1, approved_at = now(), remark = $2 WHERE id = $3",
            [actor.id, remark, params.id]
        );
        
        await client.query(
            "UPDATE sanket.feature_daily_report_items SET status = 'REJECTED' WHERE report_id = $1 AND status = 'PENDING_APPROVAL'",
            [params.id]
        );
    });

    return json({ message: "Report rejected successfully." });
  } catch (e) {
    return errorResponse(e);
  }
}
