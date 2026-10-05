import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, lstat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  DocumentError,
  type LoadedFile,
  type StoredFile,
  type SupportedMime,
} from "./types.ts";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_DOCUMENT_PAGES = 20;
export const MAX_IMAGE_PIXELS = 30_000_000;
const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function privateDataDir() {
  const dir = path.resolve(
    process.env.DATA_DIR || path.join(process.cwd(), ".data"),
  );
  const publicDir = path.resolve(process.cwd(), "public");
  if (dir === publicDir || dir.startsWith(publicDir + path.sep))
    throw new DocumentError(
      "DATA_DIR must be outside the public directory.",
      "UNSAFE_STORAGE",
      500,
    );
  return dir;
}
export function detectMime(bytes: Buffer): SupportedMime {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-")
    return "application/pdf";
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  throw new DocumentError(
    "Only PDF, PNG and JPEG invoices are supported.",
    "INVALID_FILE_TYPE",
  );
}
export function imageDimensions(
  bytes: Buffer,
  mime: SupportedMime,
): { width: number; height: number } | null {
  if (mime === "image/png") {
    if (bytes.subarray(12, 16).toString("ascii") !== "IHDR")
      throw new DocumentError("Invalid PNG header.", "INVALID_IMAGE");
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mime !== "image/jpeg") return null;
  let p = 2;
  while (p < bytes.length - 9) {
    if (bytes[p++] !== 255) continue;
    while (bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7))
      continue;
    if (p + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(p);
    if (length < 2 || p + length > bytes.length) break;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      return {
        height: bytes.readUInt16BE(p + 3),
        width: bytes.readUInt16BE(p + 5),
      };
    }
    p += length;
  }
  throw new DocumentError(
    "JPEG dimensions could not be read.",
    "INVALID_IMAGE",
  );
}
export function validateUpload(bytes: Buffer, mimeHint: string): SupportedMime {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES)
    throw new DocumentError(
      "Invoices must be between 1 byte and 15 MB.",
      "FILE_SIZE",
      413,
    );
  const mime = detectMime(bytes);
  const hint = mimeHint.toLowerCase().split(";")[0].trim();
  if (hint && hint !== "application/octet-stream" && hint !== mime)
    throw new DocumentError(
      "File signature does not match its stated type.",
      "MIME_MISMATCH",
    );
  const dimensions = imageDimensions(bytes, mime);
  if (
    dimensions &&
    (!dimensions.width ||
      !dimensions.height ||
      dimensions.width * dimensions.height > MAX_IMAGE_PIXELS)
  )
    throw new DocumentError(
      "Image must have positive dimensions and at most 30 million pixels.",
      "IMAGE_SIZE",
      413,
    );
  return mime;
}
export async function storeUpload(
  bytes: Buffer,
  name: string,
  mimeHint: string,
): Promise<StoredFile> {
  const mime = validateUpload(bytes, mimeHint);
  const id = randomUUID();
  // Filenames are metadata only. Never used as a filesystem component.
  const fileName =
    name
      .replace(/[\x00-\x1f\x7f]/g, "")
      .replace(/[\\/]/g, "_")
      .slice(0, 180) || "invoice";
  const metadata: StoredFile = {
    id,
    fileId: id,
    name: fileName,
    fileName,
    mime,
    size: bytes.length,
    hash: createHash("sha256").update(bytes).digest("hex"),
    createdAt: new Date().toISOString(),
  };
  const dir = path.join(privateDataDir(), "uploads");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const binary = path.join(dir, `${id}.bin`);
  await writeFile(binary, bytes, { flag: "wx", mode: 0o600 });
  try {
    await writeFile(path.join(dir, `${id}.json`), JSON.stringify(metadata), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    await unlink(binary).catch(() => {});
    throw error;
  }
  return metadata;
}
/** Call only after session + invoice ownership authorization in the route. */
export async function readStoredFile(fileId: string): Promise<LoadedFile> {
  if (!idPattern.test(fileId))
    throw new DocumentError("File not found.", "FILE_NOT_FOUND", 404);
  const dir = path.join(privateDataDir(), "uploads");
  try {
    const binary = path.join(dir, `${fileId}.bin`),
      info = path.join(dir, `${fileId}.json`);
    const [bs, ms] = await Promise.all([lstat(binary), lstat(info)]);
    if (
      !bs.isFile() ||
      !ms.isFile() ||
      bs.size > MAX_UPLOAD_BYTES ||
      ms.size > 4096
    )
      throw new Error("Invalid stored file.");
    const metadata = JSON.parse(await readFile(info, "utf8")) as StoredFile;
    const bytes = await readFile(binary);
    if (
      metadata.id !== fileId ||
      metadata.fileId !== fileId ||
      metadata.size !== bytes.length ||
      metadata.hash !== createHash("sha256").update(bytes).digest("hex") ||
      metadata.mime !== detectMime(bytes)
    )
      throw new Error("File integrity check failed.");
    return { metadata, bytes };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new DocumentError("File not found.", "FILE_NOT_FOUND", 404);
    throw new DocumentError(
      "Stored file is unavailable or failed its integrity check.",
      "FILE_INTEGRITY",
      500,
    );
  }
}
