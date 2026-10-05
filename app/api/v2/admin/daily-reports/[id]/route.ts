import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { query } from "@/lib/server/database";
import { json, errorResponse } from "@/lib/server/responses";
import { HttpError } from "@/lib/server/security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request, true);
    const resolvedParams = await params;
    
    const reports = await query(
      `SELECT r.*, u.name as salesman_name 
       FROM sanket.feature_daily_reports r
       JOIN sanket.users u ON u.id = r.salesman_id
       WHERE r.id = $1`, 
       [resolvedParams.id]
    );
    if (reports.length === 0) throw new HttpError("Report not found", 404);
    
    const items = await query(
       `SELECT i.*, p.name as product_name
        FROM sanket.feature_daily_report_items i
        JOIN sanket.products p ON p.id = i.product_id
        WHERE i.report_id = $1`,
        [resolvedParams.id]
    );

    return json({ report: reports[0], items });
  } catch (e) {
    return errorResponse(e);
  }
}
