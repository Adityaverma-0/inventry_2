import {
  scrypt as scryptCallback,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "sanket_v2_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "INVALID_REQUEST",
  ) {
    super(message);
  }
}

export function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
export function token() {
  return randomBytes(32).toString("base64url");
}
export function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export async function hashPassword(password: string) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  )
    throw new HttpError("Use a password between 12 and 256 characters.");
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  if (typeof password !== "string" || password.length > 256) return false;
  const [algorithm, salt, value] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !value) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(value, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function canonicalOrigin(request: NextRequest) {
  const value =
    process.env.APP_URL ||
    (process.env.NODE_ENV !== "production" ? request.nextUrl.origin : "");
  if (!value)
    throw new HttpError("APP_URL must be configured.", 503, "CONFIGURATION");
  const url = new URL(value);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    url.protocol !== "https:"
  )
    throw new HttpError(
      "Production APP_URL must use HTTPS.",
      503,
      "CONFIGURATION",
    );
  return url.origin;
}
export function assertSameOrigin(request: NextRequest) {
  const expected = canonicalOrigin(request);
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== expected) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new HttpError(
      "This request came from a different website.",
      403,
      "ORIGIN",
    );
}
export function allowLocalSetup(request: NextRequest) {
  return (
    process.env.ALLOW_LOCAL_SETUP === "true" &&
    process.env.NODE_ENV !== "production" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(request.nextUrl.hostname)
  );
}
export function sessionOptions(request: NextRequest) {
  return {
    httpOnly: true,
    secure: new URL(canonicalOrigin(request)).protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_SECONDS,
  };
}
export async function jsonBody(request: NextRequest, limit = 1_000_000) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError("Send application/json.", 415);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit) throw new HttpError("Request is too large.", 413);
  const body = new TextDecoder().decode(await limitedBody(request, limit));
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError("Invalid JSON.");
  }
}

export async function limitedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new HttpError("Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
