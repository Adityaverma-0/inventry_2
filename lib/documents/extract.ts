import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  access,
  mkdir,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Product } from "../domain/types.ts";
import { DocumentError, type LoadedFile } from "./types.ts";
import {
  MAX_DOCUMENT_PAGES,
  privateDataDir,
  validateUpload,
} from "./storage.ts";
import { parseInvoiceText } from "./parse-invoice.ts";

const execute = promisify(execFile);
const MAX_TEXT = 1_000_000;
function executable(name: string) {
  return process.env.POPPLER_BIN
    ? path.join(process.env.POPPLER_BIN, name)
    : name;
}
async function poppler(name: string, args: string[], cwd: string) {
  try {
    return (
      await execute(executable(name), args, {
        cwd,
        timeout: 30_000,
        maxBuffer: MAX_TEXT,
        windowsHide: true,
        env: { ...process.env, LC_ALL: "C" },
      })
    ).stdout;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT")
      throw new DocumentError(
        "PDF extraction needs Poppler (pdfinfo, pdftotext and pdftoppm) on PATH or POPPLER_BIN.",
        "PDF_RUNTIME_MISSING",
        503,
      );
    throw new DocumentError(
      "PDF parser could not safely read this file within its resource limits. It may be invalid, encrypted or too complex. Manual review remains available.",
      "PDF_PARSE_FAILED",
    );
  }
}

export async function extractInvoice(file: LoadedFile, products: Product[]) {
  const mime = validateUpload(file.bytes, file.metadata.mime);
  const temp = await mkdtemp(path.join(os.tmpdir(), "sanket-invoice-"));
  const pageTexts: string[] = [],
    engines = new Set<string>();
  let worker:
    | Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>
    | undefined;
  const ocr = async (image: Buffer) => {
    const langPath =
      process.env.TESSERACT_LANG_PATH ||
      path.join(process.cwd(), "runtime", "ocr");
    if (!langPath || /^(?:https?|file):/i.test(langPath))
      throw new DocumentError(
        "Local OCR needs TESSERACT_LANG_PATH pointing to a directory containing eng.traineddata. Install the documented English model, then retry extraction.",
        "OCR_MODEL_MISSING",
        503,
      );
    try {
      await access(path.join(path.resolve(langPath), "eng.traineddata"));
    } catch {
      throw new DocumentError(
        "English OCR model eng.traineddata was not found in TESSERACT_LANG_PATH.",
        "OCR_MODEL_MISSING",
        503,
      );
    }
    if (!worker) {
      const { createWorker, OEM } = await import("tesseract.js");
      const cachePath = path.join(privateDataDir(), "ocr-cache");
      await mkdir(cachePath, { recursive: true, mode: 0o700 });
      worker = await createWorker("eng", OEM.LSTM_ONLY, {
        langPath: path.resolve(langPath),
        gzip: false,
        cachePath,
        cacheMethod: "none",
        logger: () => {},
      });
      await worker.setParameters({
        preserve_interword_spaces: "1",
        user_defined_dpi: "220",
      });
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        worker.recognize(image),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new DocumentError(
                  "OCR exceeded the 90-second per-page limit.",
                  "OCR_TIMEOUT",
                ),
              ),
            90_000,
          );
        }),
      ]);
      engines.add("tesseract-local-eng");
      return result.data.text.slice(0, MAX_TEXT);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    if (mime !== "application/pdf") {
      pageTexts.push(await ocr(file.bytes));
    } else {
      const source = path.join(temp, "source.pdf");
      await writeFile(source, file.bytes, { mode: 0o600 });
      const info = await poppler("pdfinfo", [source], temp);
      const pages = Number(info.match(/^Pages:\s*(\d+)/m)?.[1]);
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
          "Encrypted PDFs cannot be extracted. Upload an unencrypted invoice.",
          "ENCRYPTED_PDF",
        );
      for (let page = 1; page <= pages; page++) {
        const pageText = await poppler(
          "pdftotext",
          [
            "-f",
            String(page),
            "-l",
            String(page),
            "-layout",
            "-enc",
            "UTF-8",
            source,
            "-",
          ],
          temp,
        );
        if ((pageText.match(/[\p{L}\p{N}]/gu) || []).length >= 30) {
          pageTexts.push(pageText.replace(/\f/g, ""));
          engines.add("poppler-text");
        } else {
          const prefix = path.join(temp, `page-${page}`);
          await poppler(
            "pdftoppm",
            [
              "-f",
              String(page),
              "-l",
              String(page),
              "-singlefile",
              "-scale-to",
              "2400",
              "-png",
              source,
              prefix,
            ],
            temp,
          );
          pageTexts.push(await ocr(await readFile(`${prefix}.png`)));
        }
        if (pageTexts.reduce((sum, t) => sum + t.length, 0) > MAX_TEXT)
          throw new DocumentError(
            "Extracted text exceeds the 1 MB document limit.",
            "TEXT_LIMIT",
            413,
          );
      }
    }
    if (!pageTexts.some((t) => /[\p{L}\p{N}]/u.test(t)))
      throw new DocumentError(
        "No readable invoice text was found. Use manual entry or upload a clearer scan.",
        "NO_TEXT",
      );
    return parseInvoiceText(pageTexts, products, [...engines]);
  } finally {
    if (worker) await worker.terminate().catch(() => {});
    await rm(temp, { recursive: true, force: true });
  }
}
