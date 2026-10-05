import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { query } from "@/lib/server/database";
import { json, errorResponse } from "@/lib/server/responses";
import { HttpError } from "@/lib/server/security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const body = await request.json();
    const { reportDate } = body;
    
    if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
       throw new HttpError("Invalid reportDate.", 400);
    }
    
    const existing = await query(
      "SELECT id FROM sanket.feature_daily_reports WHERE salesman_id = $1 AND report_date = $2",
      [actor.id, reportDate]
    );
    
    if (existing.length > 0) {
       throw new HttpError("Report already exists for this date.", 409);
    }
    
    const result = await query(
      "INSERT INTO sanket.feature_daily_reports (salesman_id, report_date) VALUES ($1, $2) RETURNING id",
      [actor.id, reportDate]
    );

    return json({ id: result[0].id, message: "Report created as DRAFT." });
  } catch (e) {
    return errorResponse(e);
  }
}
