import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { query } from "@/lib/server/database";
import { json, errorResponse } from "@/lib/server/responses";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    
    // Authorization check
    // "Salesman can only see/modify their own vehicle stock and reports"
    const results = await query(
      `SELECT p.name as product_name, v.product_id, v.available_qty, v.held_qty, v.updated_at 
       FROM sanket.feature_vehicle_stock v 
       JOIN sanket.products p ON p.id = v.product_id
       WHERE v.salesman_id = $1`,
      [actor.id]
    );

    return json({ stock: results });
  } catch (e) {
    return errorResponse(e);
  }
}
