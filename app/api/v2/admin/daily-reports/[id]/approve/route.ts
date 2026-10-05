import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { transaction } from "@/lib/server/database";
import { json, errorResponse } from "@/lib/server/responses";
import { HttpError } from "@/lib/server/security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request, true);
    const resolvedParams = await params;
    
    await transaction(async (client) => {
        const reportRes = await client.query(
            "SELECT * FROM sanket.feature_daily_reports WHERE id = $1 FOR UPDATE", 
            [resolvedParams.id]
        );
        if (reportRes.rowCount === 0) throw new HttpError("Report not found", 404);
        const report = reportRes.rows[0];
        
        if (report.status !== "SUBMITTED") throw new HttpError("Only submitted reports can be approved.", 400);
        if (report.salesman_id === actor.id) throw new HttpError("Approver cannot approve their own report.", 403);
        
        await client.query(
            "UPDATE sanket.feature_daily_reports SET status = 'APPROVED', approved_by = $1, approved_at = now() WHERE id = $2",
            [actor.id, resolvedParams.id]
        );
        
        await client.query(
            "UPDATE sanket.feature_daily_report_items SET status = 'APPROVED' WHERE report_id = $1 AND status = 'PENDING_APPROVAL'",
            [resolvedParams.id]
        );
    });

    return json({ message: "Report approved successfully." });
  } catch (e) {
    return errorResponse(e);
  }
}
