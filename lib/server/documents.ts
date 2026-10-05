import { query } from "./database";
import { getState, setInvoiceExtraction } from "../domain/service";
import {
  queueExtraction,
  recoverExtractionQueue,
  resumeExtractionQueue,
} from "../documents/queue";
import type { Actor } from "../domain/types";

const runtime = globalThis as typeof globalThis & {
  sanketDocumentWorker?: Promise<void>;
};
const hooks = {
  async products() {
    const [owner] = await query<Actor>(
      "SELECT id,name,email,role,active FROM sanket.users WHERE role='owner' AND active ORDER BY created_at LIMIT 1",
    );
    if (!owner)
      throw new Error("An active owner is required to process invoices.");
    return (await getState(owner)).products;
  },
  update: setInvoiceExtraction,
};
export function startDocumentWorker() {
  runtime.sanketDocumentWorker ??= recoverExtractionQueue(hooks).catch(
    (error) => {
      runtime.sanketDocumentWorker = undefined;
      console.error(
        "Invoice worker recovery failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    },
  );
  void runtime.sanketDocumentWorker
    .then(() => resumeExtractionQueue(hooks))
    .catch(() => {});
}
export async function enqueueInvoice(invoiceId: string, fileId: string) {
  startDocumentWorker();
  await runtime.sanketDocumentWorker;
  return queueExtraction(invoiceId, fileId, hooks);
}
