import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { transaction, query } from "@/lib/server/database";
import { json, errorResponse } from "@/lib/server/responses";
import { HttpError } from "@/lib/server/security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    if (actor.role !== "salesman") throw new HttpError("Only salesmen can add stock.", 403);
    
    const body = await request.json();
    const { productId, qty, warehouseId } = body;
    
    if (!productId || typeof qty !== 'number' || qty <= 0 || !warehouseId) {
       throw new HttpError("Invalid input: productId, qty > 0, and warehouseId required.", 400);
    }
    
    await transaction(async (client) => {
      // 1. Lock warehouse stock row
      const whStockResult = await client.query(
        "SELECT quantity FROM sanket.stock_balances WHERE location_type = 'warehouse' AND location_id = $1 AND product_id = $2 FOR UPDATE",
        [warehouseId, productId]
      );
      
      const whQty = whStockResult.rows[0]?.quantity;
      if (whQty === undefined || whQty < qty) {
         throw new HttpError("Insufficient warehouse stock.", 400);
      }
      
      // 2. Reduce warehouse stock
      await client.query(
        "UPDATE sanket.stock_balances SET quantity = quantity - $1 WHERE location_type = 'warehouse' AND location_id = $2 AND product_id = $3",
        [qty, warehouseId, productId]
      );
      
      // 3. Upsert salesman vehicle stock
      // Retrieve before qty
      const vsResult = await client.query(
        "SELECT available_qty FROM sanket.feature_vehicle_stock WHERE salesman_id = $1 AND product_id = $2 FOR UPDATE",
        [actor.id, productId]
      );
      const beforeQty = vsResult.rows[0]?.available_qty ? Number(vsResult.rows[0]?.available_qty) : 0;
      const afterQty = beforeQty + qty;

      await client.query(
        `INSERT INTO sanket.feature_vehicle_stock (salesman_id, product_id, available_qty) 
         VALUES ($1, $2, $3)
         ON CONFLICT (salesman_id, product_id) 
         DO UPDATE SET available_qty = sanket.feature_vehicle_stock.available_qty + EXCLUDED.available_qty, updated_at = now()`,
        [actor.id, productId, qty]
      );
      
      // 4. Record stock movement
      await client.query(
        `INSERT INTO sanket.feature_stock_movements (salesman_id, product_id, type, qty, before_qty, after_qty) 
         VALUES ($1, $2, 'WAREHOUSE_TO_VEHICLE', $3, $4, $5)`,
        [actor.id, productId, qty, beforeQty, afterQty]
      );
    });

    return json({ message: "Stock added successfully." });
  } catch (e) {
    return errorResponse(e);
  }
}
