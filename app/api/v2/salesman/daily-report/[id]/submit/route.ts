import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { query } from "@/lib/server/database";
import { json, errorResponse } from "@/lib/server/responses";
import { HttpError } from "@/lib/server/security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    const resolvedParams = await params;
    
    const row = await query(
      "SELECT salesman_id, status FROM sanket.feature_daily_reports WHERE id = $1", 
      [resolvedParams.id]
    );
    
    if (row.length === 0) throw new HttpError("Report not found.", 404);
    if (row[0].salesman_id !== actor.id) throw new HttpError("Forbidden.", 403);
    if (row[0].status === "SUBMITTED" || row[0].status === "APPROVED") {
        throw new HttpError("Report cannot be edited in this status.", 400);
    }
    
    await query(
      "UPDATE sanket.feature_daily_reports SET status = 'SUBMITTED', submitted_at = now() WHERE id = $1",
      [resolvedParams.id]
    );

    return json({ message: "Report submitted." });
  } catch (e) {
    return errorResponse(e);
  }
}
