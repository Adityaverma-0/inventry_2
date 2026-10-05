import { randomUUID } from "node:crypto";
import {
  mkdir,
  writeFile,
  readdir,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { extractInvoice } from "./extract.ts";
import { privateDataDir, readStoredFile } from "./storage.ts";
import { DocumentError, type ExtractionHooks } from "./types.ts";

type Job = {
  id: string;
  invoiceId: string;
  fileId: string;
  createdAt: string;
  attempts: number;
};
const idPattern = /^[0-9a-f-]{36}$/i;
type QueueResult = { queued: boolean; alreadyQueued?: boolean; jobId?: string };
const state = globalThis as typeof globalThis & {
  __sanketExtractionDrain?: Promise<void>;
  __sanketExtractionEnqueues?: Map<string, Promise<QueueResult>>;
};
const dir = () => path.join(privateDataDir(), "extraction-queue");

/** Persist first, then process independently of the HTTP request. Requires a long-running Node server. */
export async function queueExtraction(
  invoiceId: string,
  fileId: string,
  hooks: ExtractionHooks,
): Promise<QueueResult> {
  const enqueues = (state.__sanketExtractionEnqueues ??= new Map());
  const key = `${privateDataDir()}:${invoiceId}`;
  if (enqueues.has(key)) return enqueues.get(key)!;
  const promise = persistExtraction(invoiceId, fileId, hooks).finally(() =>
    enqueues.delete(key),
  );
  enqueues.set(key, promise);
  return promise;
}
async function persistExtraction(
  invoiceId: string,
  fileId: string,
  hooks: ExtractionHooks,
): Promise<QueueResult> {
  if (!idPattern.test(invoiceId) || !idPattern.test(fileId))
    throw new DocumentError(
      "Invalid extraction job identifier.",
      "INVALID_JOB",
    );
  await mkdir(dir(), { recursive: true, mode: 0o700 });
  const existing = (await readdir(dir())).some(
    (n) =>
      n.startsWith(`${invoiceId}.`) && /\.(?:queued|working)\.json$/.test(n),
  );
  if (existing) {
    resumeExtractionQueue(hooks);
    return { queued: true, alreadyQueued: true };
  }
  const job: Job = {
    id: randomUUID(),
    invoiceId,
    fileId,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const filename = path.join(dir(), `${invoiceId}.${job.id}.queued.json`);
  await writeFile(filename, JSON.stringify(job), { flag: "wx", mode: 0o600 });
  await hooks.update(invoiceId, {
    extractionStatus: "QUEUED",
    extractionError: "",
  });
  resumeExtractionQueue(hooks);
  return { queued: true, jobId: job.id };
}

/** Call at server startup and from the state route to resume queued work after restarts.
 * A single extraction worker process is supported. Working jobs are recoverable by recoverExtractionQueue on startup.
 */
export function resumeExtractionQueue(hooks: ExtractionHooks): Promise<void> {
  if (state.__sanketExtractionDrain) return state.__sanketExtractionDrain;
  state.__sanketExtractionDrain = new Promise<void>((resolve) =>
    setImmediate(resolve),
  )
    .then(async () => {
      await mkdir(dir(), { recursive: true, mode: 0o700 });
      for (;;) {
        const name = (await readdir(dir()))
          .filter((n) => /^[0-9a-f.-]+\.queued\.json$/i.test(n))
          .sort()[0];
        if (!name) break;
        const pending = path.join(dir(), name),
          working = pending.replace(/\.queued\.json$/, ".working.json");
        try {
          await rename(pending, working);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw e;
        }
        const job = JSON.parse(await readFile(working, "utf8")) as Job;
        try {
          await hooks.update(job.invoiceId, {
            extractionStatus: "PROCESSING",
            extractionError: "",
          });
          const result = await extractInvoice(
            await readStoredFile(job.fileId),
            await hooks.products(),
          );
          await hooks.update(job.invoiceId, result);
          await unlink(working);
        } catch (error) {
          // An owner may finish manual review while OCR is still running. Posted or
          // deleted documents are terminal; never keep retrying an obsolete job.
          if (
            ["INVOICE_POSTED", "NOT_FOUND"].includes(
              (error as { code?: string }).code || "",
            )
          ) {
            await unlink(working);
            continue;
          }
          const message =
            error instanceof DocumentError
              ? error.message
              : "Extraction failed. The original remains available; retry extraction or enter invoice lines manually.";
          try {
            await hooks.update(job.invoiceId, {
              extractionStatus: "FAILED",
              extractionError: message,
            });
          } catch {
            // Preserve the job when the database cannot record its terminal status.
            await rename(working, pending);
            throw error;
          }
          await unlink(working);
        }
      }
    })
    .finally(() => {
      state.__sanketExtractionDrain = undefined;
    });
  // Attach a handler because HTTP callers intentionally do not await long extraction jobs.
  void state.__sanketExtractionDrain.catch((error) =>
    console.error(
      "[invoice-extraction] Queue stopped:",
      error instanceof Error ? error.message : "unknown error",
    ),
  );
  return state.__sanketExtractionDrain;
}

/** Call exactly once when a sole server/worker starts, before accepting extraction requests. */
export async function recoverExtractionQueue(hooks: ExtractionHooks) {
  await mkdir(dir(), { recursive: true, mode: 0o700 });
  for (const name of await readdir(dir())) {
    if (/^[0-9a-f.-]+\.working\.json$/i.test(name))
      await rename(
        path.join(dir(), name),
        path.join(dir(), name.replace(/\.working\.json$/, ".queued.json")),
      );
  }
  // Startup recovery must not make subsequent upload requests wait for OCR.
  void resumeExtractionQueue(hooks);
}
