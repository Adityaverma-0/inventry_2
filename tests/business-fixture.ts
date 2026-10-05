import { transaction } from "../lib/server/database";
import type { Actor } from "../lib/domain/types";
import { owner, actorCheck, one, uid } from "../lib/domain/common";

// Synthetic structure for isolated integration databases only.
export async function initializeBusiness(actor: Actor): Promise<void> {
  owner(actor);
  await transaction(async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('sanket-business-write'))",
    );
    await actorCheck(db, actor);
    for (const [name, vehicles] of [
      ["Hardpiplya", ["Hardpiplya Vehicle 1", "Hardpiplya Vehicle 2"]],
      ["Dewas", ["Dewas Vehicle 1"]],
    ] as const) {
      await db.query(
        "INSERT INTO sanket.locations(id,name) VALUES($1,$2) ON CONFLICT(name) DO NOTHING",
        [uid(), name],
      );
      const l = await one(db, "SELECT id FROM sanket.locations WHERE name=$1", [
        name,
      ]);
      await db.query(
        "INSERT INTO sanket.warehouses(id,name,location_id) VALUES($1,$2,$3) ON CONFLICT(name) DO NOTHING",
        [uid(), `${name} Godown`, l!.id],
      );
      const w = await one(
        db,
        "SELECT id FROM sanket.warehouses WHERE name=$1",
        [`${name} Godown`],
      );
      for (const v of vehicles)
        await db.query(
          "INSERT INTO sanket.vehicles(id,name,warehouse_id) VALUES($1,$2,$3) ON CONFLICT(name) DO NOTHING",
          [uid(), v, w!.id],
        );
    }
  });
}
