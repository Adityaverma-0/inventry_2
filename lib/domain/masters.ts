import type { DbClient } from "@/lib/server/database";
import type { Actor } from "./types";
import { insist } from "./errors";
import {
  one,
  owner,
  uid,
  vehicleScope,
  warehouseScope,
  type Row,
} from "./common";
import { validateLevels } from "./units";
export async function masterAction(
  db: DbClient,
  actor: Actor,
  action: string,
  d: Row,
): Promise<Row> {
  owner(actor);
  const id = d.id || uid();
  if (action === "location.save") {
    if (d.id)
      insist(
        await one(db, "SELECT id FROM sanket.locations WHERE id=$1", [d.id]),
        "NOT_FOUND",
        "Location was not found.",
        404,
      );
    await db.query(
      "INSERT INTO sanket.locations(id,name,active) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,active=EXCLUDED.active",
      [id, d.name, d.active],
    );
  } else if (action === "warehouse.save") {
    insist(
      await one(db, "SELECT id FROM sanket.locations WHERE id=$1 AND active", [
        d.locationId,
      ]),
      "LOCATION_UNAVAILABLE",
      "Choose an active location.",
    );
    if (d.id)
      insist(
        await one(db, "SELECT id FROM sanket.warehouses WHERE id=$1", [d.id]),
        "NOT_FOUND",
        "Godown was not found.",
        404,
      );
    await db.query(
      "INSERT INTO sanket.warehouses(id,name,location_id,active) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,location_id=EXCLUDED.location_id,active=EXCLUDED.active",
      [id, d.name, d.locationId, d.active],
    );
  } else if (action === "vehicle.save") {
    await warehouseScope(db, d.warehouseId);
    if (d.id) {
      const existing = await vehicleScope(db, actor, d.id, undefined, false);
      if (existing.warehouse_id !== d.warehouseId)
        insist(
          !(await one(
            db,
            "SELECT product_id FROM sanket.stock_balances WHERE location_type='vehicle' AND location_id=$1 AND quantity>0 LIMIT 1",
            [d.id],
          )),
          "VEHICLE_HAS_STOCK",
          "A vehicle with stock cannot change its home godown. Reconcile its remaining stock first.",
          409,
        );
    }
    await db.query(
      "INSERT INTO sanket.vehicles(id,name,registration,warehouse_id,active,schedule,maintenance_date) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,registration=EXCLUDED.registration,warehouse_id=EXCLUDED.warehouse_id,active=EXCLUDED.active,schedule=EXCLUDED.schedule,maintenance_date=EXCLUDED.maintenance_date",
      [id, d.name, d.registration, d.warehouseId, d.active, d.schedule || null, d.maintenanceDate || null],
    );
  } else if (action === "assignment.save") {
    const v = await vehicleScope(db, actor, d.vehicleId);
    if (d.salesmanId)
      insist(
        await one(
          db,
          "SELECT id FROM sanket.users WHERE id=$1 AND role='salesman' AND active FOR UPDATE",
          [d.salesmanId],
        ),
        "SALESMAN_UNAVAILABLE",
        "Choose an active salesman.",
      );
    if (v.salesman_id === d.salesmanId)
      return { id: v.assignment_id, message: "Assignment is already current." };
    const other = d.salesmanId
      ? await one(
          db,
          "SELECT id FROM sanket.assignments WHERE salesman_id=$1 AND ends_at IS NULL",
          [d.salesmanId],
        )
      : undefined;
    insist(
      !other,
      "SALESMAN_ASSIGNED",
      "This salesman already has a vehicle. End that assignment first.",
      409,
    );
    await db.query(
      "UPDATE sanket.assignments SET ends_at=now() WHERE vehicle_id=$1 AND ends_at IS NULL",
      [d.vehicleId],
    );
    if (d.salesmanId)
      await db.query(
        "INSERT INTO sanket.assignments(id,vehicle_id,salesman_id,actor_id,reason) VALUES($1,$2,$3,$4,$5)",
        [id, d.vehicleId, d.salesmanId, actor.id, d.reason],
      );
  } else if (action === "product.save") {
    if (d.id)
      insist(
        await one(db, "SELECT id FROM sanket.products WHERE id=$1 FOR UPDATE", [
          d.id,
        ]),
        "NOT_FOUND",
        "Product was not found.",
        404,
      );
    if (d.priceUnit && d.id) {
      const pack = await one(
        db,
        "SELECT pk.levels FROM sanket.products p JOIN sanket.packaging pk ON pk.id=p.active_packaging_id WHERE p.id=$1",
        [d.id],
      );
      if (pack)
        insist(
          pack.levels.some((l: Row) => l.code === d.priceUnit),
          "PRICE_UNIT",
          "Choose a configured price unit.",
        );
    }
    await db.query(
      "INSERT INTO sanket.products(id,sku,name,category,active,min_stock,price,price_unit,currency,raw_import) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET sku=EXCLUDED.sku,name=EXCLUDED.name,category=EXCLUDED.category,active=EXCLUDED.active,min_stock=EXCLUDED.min_stock,price=EXCLUDED.price,price_unit=EXCLUDED.price_unit,currency=EXCLUDED.currency,raw_import=COALESCE(EXCLUDED.raw_import,sanket.products.raw_import)",
      [
        id,
        d.sku,
        d.name,
        d.category,
        d.active,
        d.minStock,
        d.price ?? null,
        d.priceUnit ?? null,
        d.currency,
        d.rawImport ? JSON.stringify(d.rawImport) : null,
      ],
    );
  } else if (action === "packaging.save") {
    const levels = validateLevels(d.baseUnit, d.levels);
    const p = await one(
      db,
      "SELECT * FROM sanket.products WHERE id=$1 FOR UPDATE",
      [d.productId],
    );
    insist(p, "NOT_FOUND", "Product was not found.", 404);
    insist(
      !p.canonical_base_unit || p.canonical_base_unit === d.baseUnit,
      "BASE_IMMUTABLE",
      "The canonical smallest stock unit cannot be changed. Create a separate product for a different base unit.",
      409,
    );
    insist(
      !(d.priceBasis?.unitCode || p.price_unit) ||
        levels.some(
          (level) => level.code === (d.priceBasis?.unitCode || p.price_unit),
        ),
      "PRICE_UNIT",
      `The price unit “${d.priceBasis?.unitCode || p.price_unit}” is not in this packaging. Choose one of the configured units in Selling price before activating.`,
    );
    if (d.priceBasis) {
      // Price confirmation and activation commit together; a failed version saves neither.
      await db.query(
        "UPDATE sanket.products SET price=$2,price_unit=$3,currency=$4 WHERE id=$1",
        [
          d.productId,
          d.priceBasis.price,
          d.priceBasis.unitCode,
          d.priceBasis.currency,
        ],
      );
    }
    const previous = await one(
      db,
      "SELECT MAX(version) AS version FROM sanket.packaging WHERE product_id=$1",
      [d.productId],
    );
    const version = Number(previous?.version || 0) + 1;
    await db.query(
      "INSERT INTO sanket.packaging(id,product_id,version,base_unit,levels,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        d.productId,
        version,
        d.baseUnit,
        JSON.stringify(levels),
        d.reason,
        actor.id,
      ],
    );
    await db.query(
      "UPDATE sanket.products SET canonical_base_unit=$2,active_packaging_id=$3 WHERE id=$1",
      [d.productId, d.baseUnit, id],
    );
    return {
      id,
      version,
      message: "Packaging version saved. Base stock quantities are unchanged.",
    };
  } else if (action === "settings.save") {
    const prev = await one(
      db,
      "SELECT data FROM sanket.settings WHERE id=true",
    );
    if (prev?.data.timezone !== d.timezone)
      insist(
        !(await one(db, "SELECT id FROM sanket.stock_documents LIMIT 1")),
        "TIMEZONE_IN_USE",
        "The business timezone is fixed after the first stock posting to preserve business-date history.",
      );
    await db.query("UPDATE sanket.settings SET data=$1 WHERE id=true", [
      JSON.stringify(d),
    ]);
  } else insist(false, "UNKNOWN_ACTION", "Unknown master operation.");
  return { id, message: "Saved successfully." };
}
