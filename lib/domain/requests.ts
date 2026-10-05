import { transaction } from "@/lib/server/database";
import type { Actor, ActionResult } from "./types";
import { actorCheck, audit, hash, one } from "./common";
import { insist } from "./errors";
import { parseAction } from "./validation";
export type RequestResolution = {
  state: "CONFIRMED" | "CANCELLED" | "NOT_FOUND";
  requestId: string;
  result?: ActionResult;
};
function requestKey(key: string): void {
  insist(
    typeof key === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(key),
    "REQUEST_ID_REQUIRED",
    "Invalid request ID.",
  );
}
/** Shared lock waits for an in-flight commit; absence is informational, never a safe-discard guarantee. */
export async function lookupSaleRequest(
  actor: Actor,
  requestId: string,
): Promise<RequestResolution> {
  requestKey(requestId);
  return transaction(async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock_shared(hashtext('sanket-business-write'))",
    );
    await actorCheck(db, actor);
    const previous = await one(
      db,
      "SELECT result FROM sanket.requests WHERE actor_id=$1 AND action='sale.create' AND request_id=$2",
      [actor.id, requestId],
    );
    if (!previous) return { state: "NOT_FOUND", requestId };
    return {
      state: previous.result.state === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
      requestId,
      result: previous.result,
    };
  });
}
/** A cancellation tombstone wins the same lock as posting; it cannot race into a double sale. */
export async function cancelSaleRequest(
  actor: Actor,
  requestId: string,
  data: unknown,
): Promise<RequestResolution> {
  requestKey(requestId);
  parseAction("sale.create", data);
  const payloadHash = hash(data);
  return transaction(async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('sanket-business-write'))",
    );
    await actorCheck(db, actor);
    const previous = await one(
      db,
      "SELECT payload_hash,result FROM sanket.requests WHERE actor_id=$1 AND action='sale.create' AND request_id=$2",
      [actor.id, requestId],
    );
    if (previous) {
      insist(
        previous.payload_hash === payloadHash,
        "IDEMPOTENCY_CONFLICT",
        "The original request data does not match. Preserve the pending entry and review its committed result.",
        409,
      );
      return {
        state:
          previous.result.state === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
        requestId,
        result: previous.result,
      };
    }
    const result: ActionResult = {
      state: "CANCELLED",
      message: "Pending request cancelled. This request ID cannot post a sale.",
    };
    await db.query(
      "INSERT INTO sanket.requests(actor_id,action,request_id,payload_hash,result) VALUES($1,'sale.create',$2,$3,$4)",
      [actor.id, requestId, payloadHash, JSON.stringify(result)],
    );
    await audit(db, actor, "sale.cancelled", requestId, {
      requestId,
      payloadHash,
    });
    return { state: "CANCELLED", requestId, result };
  });
}
