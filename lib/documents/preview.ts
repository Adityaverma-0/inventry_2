import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rename,
  rm,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DocumentError, type LoadedFile } from "./types.ts";
import {
  MAX_DOCUMENT_PAGES,
  privateDataDir,
  validateUpload,
  imageDimensions,
} from "./storage.ts";

const execute = promisify(execFile);
const EDGE = 2000,
  MAX_RENDER_BYTES = 20 * 1024 * 1024;
type PreviewInfo = { pages: number; mime: string; fileName: string };
type PreviewResult = PreviewInfo & { page: number; bytes: Buffer };
const runtime = globalThis as typeof globalThis & {
  __sanketPreviewJobs?: Map<string, Promise<unknown>>;
  __sanketPreviewActive?: number;
};

async function singleFlight<T>(
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const jobs = (runtime.__sanketPreviewJobs ??= new Map());
  if (jobs.has(key)) return jobs.get(key)! as Promise<T>;
  const job = work().finally(() => jobs.delete(key));
  jobs.set(key, job);
  return job;
}
async function limitedParser<T>(work: () => Promise<T>): Promise<T> {
  if ((runtime.__sanketPreviewActive || 0) >= 2)
    throw new DocumentError(
      "Invoice previews are busy. Try this page again shortly.",
      "PREVIEW_BUSY",
      503,
    );
  runtime.__sanketPreviewActive = (runtime.__sanketPreviewActive || 0) + 1;
  try {
    return await work();
  } finally {
    runtime.__sanketPreviewActive!--;
  }
}
async function poppler(name: string, args: string[], cwd: string) {
  try {
    return (
      await execute(
        process.env.POPPLER_BIN
          ? path.join(process.env.POPPLER_BIN, name)
          : name,
        args,
        {
          cwd,
          timeout: 30_000,
          maxBuffer: 1_000_000,
          windowsHide: true,
          env: { ...process.env, LC_ALL: "C" },
        },
      )
    ).stdout;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new DocumentError(
        "PDF preview requires Poppler pdfinfo and pdftoppm on PATH or POPPLER_BIN. The original is still available to download.",
        "PDF_RUNTIME_MISSING",
        503,
      );
    throw new DocumentError(
      "This PDF page could not be rendered within the preview resource limits. Download the original to inspect it.",
      "PDF_PREVIEW_FAILED",
      422,
    );
  }
}
function verified(file: LoadedFile) {
  const mime = validateUpload(file.bytes, file.metadata.mime);
  const hash = createHash("sha256").update(file.bytes).digest("hex");
  if (hash !== file.metadata.hash)
    throw new DocumentError(
      "Stored document failed its integrity check.",
      "FILE_INTEGRITY",
      500,
    );
  return { mime, hash, dir: path.join(privateDataDir(), "previews", hash) };
}
async function cached(file: string, maxBytes: number) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function atomicWrite(file: string, data: string | Buffer) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, data, { mode: 0o600, flag: "wx" });
  try {
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
async function withPdf<T>(
  bytes: Buffer,
  work: (source: string, temp: string) => Promise<T>,
): Promise<T> {
  const temp = await mkdtemp(path.join(os.tmpdir(), "sanket-preview-"));
  try {
    const source = path.join(temp, "source.pdf");
    await writeFile(source, bytes, { mode: 0o600 });
    return await work(source, temp);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
export async function invoicePreviewInfo(
  file: LoadedFile,
): Promise<PreviewInfo> {
  const { mime, hash, dir } = verified(file);
  if (mime !== "application/pdf")
    return { pages: 1, mime, fileName: file.metadata.fileName };
  return singleFlight(`info:${dir}`, async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const saved = await cached(path.join(dir, "info-v1.json"), 2048);
    if (saved) {
      try {
        const info = JSON.parse(saved.toString());
        if (
          info.hash === hash &&
          Number.isSafeInteger(info.pages) &&
          info.pages >= 1 &&
          info.pages <= MAX_DOCUMENT_PAGES
        )
          return { pages: info.pages, mime, fileName: file.metadata.fileName };
      } catch {
        /* Recreate an interrupted or obsolete cache record. */
      }
    }
    const pages = await limitedParser(() =>
      withPdf(file.bytes, async (source, temp) => {
        const info = await poppler("pdfinfo", [source], temp),
          pages = Number(info.match(/^Pages:\s*(\d+)/m)?.[1]);
        if (
          !Number.isSafeInteger(pages) ||
          pages < 1 ||
          pages > MAX_DOCUMENT_PAGES
        )
          throw new DocumentError(
            `PDF must contain between 1 and ${MAX_DOCUMENT_PAGES} pages.`,
            "PAGE_LIMIT",
            413,
          );
        if (/^Encrypted:\s*yes/m.test(info))
          throw new DocumentError(
            "Encrypted PDFs cannot be previewed. Download the original or upload an unencrypted document.",
            "ENCRYPTED_PDF",
            422,
          );
        return pages;
      }),
    );
    await atomicWrite(
      path.join(dir, "info-v1.json"),
      JSON.stringify({ hash, pages }),
    );
    return { pages, mime, fileName: file.metadata.fileName };
  });
}
export async function renderInvoicePage(
  file: LoadedFile,
  page = 1,
): Promise<PreviewResult> {
  if (!Number.isSafeInteger(page) || page < 1)
    throw new DocumentError(
      "Page must be a positive integer.",
      "INVALID_PAGE",
      400,
    );
  const info = await invoicePreviewInfo(file);
  if (page > info.pages)
    throw new DocumentError(
      "This invoice page does not exist.",
      "PAGE_NOT_FOUND",
      404,
    );
  if (info.mime !== "application/pdf")
    return { ...info, page, bytes: file.bytes };
  const { dir } = verified(file),
    target = path.join(dir, `page-${page}-${EDGE}-v1.png`);
  const validPng = (bytes: Buffer) => {
    try {
      if (
        bytes.length < 24 ||
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        return false;
      const dimensions = imageDimensions(bytes, "image/png");
      return Boolean(
        dimensions &&
        dimensions.width > 0 &&
        dimensions.height > 0 &&
        dimensions.width <= EDGE &&
        dimensions.height <= EDGE,
      );
    } catch {
      return false;
    }
  };
  const bytes = await singleFlight(`page:${target}`, async () => {
    const saved = await cached(target, MAX_RENDER_BYTES);
    if (saved && validPng(saved)) return saved;
    const rendered = await limitedParser(() =>
      withPdf(file.bytes, async (source, temp) => {
        const output = path.join(temp, "page");
        await poppler(
          "pdftoppm",
          [
            "-f",
            String(page),
            "-l",
            String(page),
            "-singlefile",
            "-scale-to",
            String(EDGE),
            "-png",
            source,
            output,
          ],
          temp,
        );
        const bytes = await cached(`${output}.png`, MAX_RENDER_BYTES);
        if (!bytes || !validPng(bytes))
          throw new DocumentError(
            "Rendered page exceeded the supported image limits. Download the original instead.",
            "PREVIEW_IMAGE_LIMIT",
            413,
          );
        return bytes;
      }),
    );
    await atomicWrite(target, rendered);
    return rendered;
  });
  return { ...info, mime: "image/png", page, bytes };
}
