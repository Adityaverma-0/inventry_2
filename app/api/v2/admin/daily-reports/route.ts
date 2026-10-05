import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { query } from "@/lib/server/database";
import { json, errorResponse } from "@/lib/server/responses";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request, true); // req owner
    
    const { searchParams } = new URL(request.url);
    const salesmanId = searchParams.get("salesmanId");
    const date = searchParams.get("date");
    const status = searchParams.get("status");

    let sql = `
      SELECT r.*, u.name as salesman_name 
      FROM sanket.feature_daily_reports r
      JOIN sanket.users u ON u.id = r.salesman_id
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (salesmanId) { params.push(salesmanId); sql += ` AND r.salesman_id = $${params.length}`; }
    if (date) { params.push(date); sql += ` AND r.report_date = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND r.status = $${params.length}`; }
    
    sql += " ORDER BY r.created_at DESC";

    const reports = await query(sql, params);
    
    return json({ reports });
  } catch (e) {
    return errorResponse(e);
  }
}
