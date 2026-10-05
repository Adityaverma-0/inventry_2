import { transaction } from "@/lib/server/database";
import type { Actor } from "./types";
import { actorCheck, owner, uid } from "./common";
import { insist } from "./errors";
import { uuid } from "./validation";

export type VehicleSchedule = {
  id: string;
  vehicleId: string;
  weekday: number;
  areas: string[];
  notes: string;
  offDay: boolean;
};

export async function saveVehicleSchedule(
  actor: Actor,
  data: { vehicleId: string; weekday: number; areas: string[]; notes: string; offDay: boolean }
) {
  owner(actor);
  uuid(data.vehicleId);
  insist(data.weekday >= 0 && data.weekday <= 6, "INVALID_WEEKDAY", "Weekday must be 0-6");
  
  return transaction(async (db) => {
    await actorCheck(db, actor);
    
    // Upsert schedule
    await db.query(
      `INSERT INTO sanket.vehicle_schedules(id, vehicle_id, weekday, areas, notes, off_day, configured_by)
       VALUES($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (vehicle_id, weekday) DO UPDATE SET 
         areas = $4, notes = $5, off_day = $6, configured_by = $7, updated_at = now()`,
      [uid(), data.vehicleId, data.weekday, data.areas, data.notes, data.offDay, actor.id]
    );
    
    return { message: "Schedule updated." };
  });
}
