import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { migrate, query, transaction } from "./database";
import {
  HttpError,
  SESSION_COOKIE,
  SESSION_SECONDS,
  allowLocalSetup,
  hash,
  hashPassword,
  safeEqual,
  sessionOptions,
  token,
  verifyPassword,
} from "./security";
import type { Actor } from "@/lib/domain/types";

const safeFields = "id,name,username,email,role,active";
const account = z.object({
  name: z.string().trim().min(1).max(160),
  username: z.string().trim().toLowerCase(),
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()).optional(),
  password: z.string().min(12).max(256),
});
export async function currentUser(request: NextRequest): Promise<Actor | null> {
  await migrate();
  const value = request.cookies.get(SESSION_COOKIE)?.value;
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const rows = await query<Actor>(
    `SELECT u.${safeFields.replaceAll(",", ",u.")} FROM sanket.sessions s JOIN sanket.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active`,
    [hash(value)]
  );
  return rows[0] || null;
}
export async function requireUser(request: NextRequest, owner = false) {
  const actor = await currentUser(request);
  if (!actor)
    throw new HttpError("Sign in to continue.", 401, "UNAUTHENTICATED");
  if (owner && actor.role !== "owner")
    throw new HttpError("Only the admin can do this.", 403, "FORBIDDEN");
  return actor;
}
export async function authStatus(request: NextRequest) {
  const user = await currentUser(request);
  const rows = await query("SELECT count(*)::int AS count FROM sanket.users");
  return {
    user,
    setupRequired: rows[0].count === 0,
    localSetup: allowLocalSetup(request),
  };
}
async function issueSession(
  request: NextRequest,
  user: Actor,
  passwordHash: string,
) {
  const plain = token();
  await transaction(async (client) => {
    const result = await client.query(
      "SELECT id FROM sanket.users WHERE id=$1 AND active AND password_hash=$2 FOR UPDATE",
      [user.id, passwordHash],
    );
    if (!result.rowCount)
      throw new HttpError("Account changed. Sign in again.", 401);
    const old = request.cookies.get(SESSION_COOKIE)?.value;
    if (old)
      await client.query("DELETE FROM sanket.sessions WHERE token_hash=$1", [
        hash(old),
      ]);
    await client.query(
      "INSERT INTO sanket.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3::text || ' seconds')::interval)",
      [hash(plain), user.id, SESSION_SECONDS],
    );
  });
  const response = NextResponse.json({ user, message: "Signed in." });
  response.cookies.set(SESSION_COOKIE, plain, sessionOptions(request));
  return response;
}
export async function handleAuth(request: NextRequest, raw: unknown) {
  const input = z.record(z.unknown()).parse(raw);
  await migrate();
  if (input.action === "setup") {
    const value = account.parse(input);
    if (!allowLocalSetup(request)) {
      const expected = process.env.OWNER_SETUP_TOKEN;
      if (
        !expected ||
        expected.length < 32 ||
        typeof input.setupToken !== "string" ||
        !safeEqual(input.setupToken, expected)
      )
        throw new HttpError("The owner setup token is incorrect.", 403);
    }
    const passwordHash = await hashPassword(value.password);
    const actor = await transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('sanket-owner-setup'))",
      );
      const users = await client.query("SELECT id FROM sanket.users LIMIT 1");
      if (users.rowCount)
        throw new HttpError("Owner setup is already complete.", 409);
      const created = await client.query(
        `INSERT INTO sanket.users(name,username,email,role,password_hash) VALUES($1,$2,$3,'owner',$4) RETURNING ${safeFields}`,
        [value.name, value.username, value.email || null, passwordHash],
      );
      return created.rows[0] as Actor;
    });
    return issueSession(request, actor, passwordHash);
  }
  if (input.action === "login") {
    const value = z
      .object({
        username: z.string().trim().toLowerCase(),
        password: z.string().min(1).max(256),
      })
      .parse(input);
    const bucket = hash(`login:${value.username}`);
    const allowed = await transaction(async (client) => {
      await client.query(
        "INSERT INTO sanket.auth_attempts(bucket) VALUES($1) ON CONFLICT DO NOTHING",
        [bucket],
      );
      const r = await client.query(
        "SELECT attempts,window_start FROM sanket.auth_attempts WHERE bucket=$1 FOR UPDATE",
        [bucket],
      );
      const fresh =
        Date.now() - new Date(r.rows[0].window_start).getTime() >
        15 * 60 * 1000;
      if (!fresh && r.rows[0].attempts >= 10) return false;
      await client.query(
        "UPDATE sanket.auth_attempts SET attempts=$2,window_start=CASE WHEN $3 THEN now() ELSE window_start END WHERE bucket=$1",
        [bucket, fresh ? 1 : r.rows[0].attempts + 1, fresh],
      );
      return true;
    });
    if (!allowed)
      throw new HttpError(
        "Too many attempts. Try again in 15 minutes.",
        429,
        "RATE_LIMIT",
      );
    const rows = await query(
      `SELECT ${safeFields},password_hash FROM sanket.users WHERE username=$1 OR email=$1`,
      [value.username],
    );
    const row = rows[0];
    if (
      !row ||
      !row.active ||
      !(await verifyPassword(value.password, row.password_hash))
    )
      throw new HttpError("Login ID or password is incorrect.", 401);
    await query("DELETE FROM sanket.auth_attempts WHERE bucket=$1", [bucket]);
    const { password_hash, ...actor } = row;
    return issueSession(request, actor as Actor, password_hash);
  }
  if (input.action === "logout") {
    const value = request.cookies.get(SESSION_COOKIE)?.value;
    if (value)
      await query("DELETE FROM sanket.sessions WHERE token_hash=$1", [
        hash(value),
      ]);
    const response = NextResponse.json({ message: "Signed out." });
    response.cookies.set(SESSION_COOKIE, "", {
      ...sessionOptions(request),
      maxAge: 0,
    });
    return response;
  }
  if (input.action === "password") {
    const actor = await requireUser(request);
    const value = z
      .object({
        currentPassword: z.string().min(1).max(256),
        newPassword: z.string().min(12).max(256),
      })
      .parse(input);
    const rows = await query(
      "SELECT password_hash FROM sanket.users WHERE id=$1",
      [actor.id],
    );
    const previous = rows[0]?.password_hash;
    if (!previous || !(await verifyPassword(value.currentPassword, previous)))
      throw new HttpError("Current password is incorrect.", 401);
    const replacement = await hashPassword(value.newPassword);
    await transaction(async (client) => {
      const r = await client.query(
        "UPDATE sanket.users SET password_hash=$1 WHERE id=$2 AND password_hash=$3 RETURNING id",
        [replacement, actor.id, previous],
      );
      if (!r.rowCount)
        throw new HttpError("Account changed. Sign in again.", 409);
      await client.query("DELETE FROM sanket.sessions WHERE user_id=$1", [
        actor.id,
      ]);
    });
    return issueSession(request, actor, replacement);
  }
  if (input.action === "reset") {
    const value = z
      .object({
        username: z.string().trim().toLowerCase(),
        resetToken: z.string().min(1).max(256),
        newPassword: z.string().min(12).max(256),
      })
      .parse(input);
    const expected = process.env.OWNER_SETUP_TOKEN;
    if (
      !expected ||
      expected.length < 16 ||
      !safeEqual(value.resetToken, expected)
    )
      throw new HttpError("The reset token is incorrect.", 403);
    const rows = await query(
      `SELECT ${safeFields},password_hash FROM sanket.users WHERE (username=$1 OR email=$1) AND role='owner'`,
      [value.username],
    );
    const row = rows[0];
    if (!row)
      throw new HttpError("No owner account found with that username.", 404);
    const newHash = await hashPassword(value.newPassword);
    await transaction(async (client) => {
      await client.query(
        "UPDATE sanket.users SET password_hash=$1 WHERE id=$2",
        [newHash, row.id],
      );
      await client.query("DELETE FROM sanket.sessions WHERE user_id=$1", [
        row.id,
      ]);
    });
    const { password_hash: _, ...actor } = row;
    return issueSession(request, actor as Actor, newHash);
  }
  throw new HttpError("Unknown account action.");
}

export async function saveTeamMember(actor: Actor, input: unknown) {
  if (actor.role !== "owner")
    throw new HttpError("Only the admin can manage accounts.", 403);
  const data = z
    .object({
      id: z.string().uuid().optional(),
      requestId: z.string().uuid(),
      name: z.string().trim().min(1).max(160),
      username: z.string().trim().toLowerCase().min(3).max(50),
      mobile: z.string().max(30).default(""),
      role: z.literal("salesman").default("salesman"),
      active: z.boolean().default(true),
      password: z.string().min(12).max(256).optional(),
    })
    .parse(input);
  if (!data.id && !data.password)
    throw new HttpError("Set an initial password of at least 12 characters.");
  const payloadHash = hash(JSON.stringify(data));
  const passwordHash = data.password ? await hashPassword(data.password) : null;
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('sanket-business-write'))",
    );
    const current = await client.query(
      "SELECT id FROM sanket.users WHERE id=$1 AND role='owner' AND active FOR UPDATE",
      [actor.id],
    );
    if (!current.rowCount)
      throw new HttpError("Admin access is no longer active.", 403);
    const prior = await client.query(
      "SELECT * FROM sanket.team_requests WHERE request_id=$1",
      [data.requestId],
    );
    if (prior.rowCount) {
      if (
        prior.rows[0].actor_id !== actor.id ||
        prior.rows[0].payload_hash !== payloadHash
      )
        throw new HttpError("Request ID was reused with different data.", 409);
      return prior.rows[0].result;
    }
    let id = data.id;
    if (id) {
      const row = await client.query(
        "SELECT * FROM sanket.users WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!row.rowCount || row.rows[0].role === "owner")
        throw new HttpError("Select a salesman account.", 404);
      await client.query(
        "UPDATE sanket.users SET name=$2,username=$3,mobile=$4,active=$5,password_hash=COALESCE($6,password_hash) WHERE id=$1",
        [id, data.name, data.username, data.mobile, data.active, passwordHash],
      );
      if (!data.active || passwordHash || row.rows[0].username !== data.username)
        await client.query("DELETE FROM sanket.sessions WHERE user_id=$1", [
          id,
        ]);
    } else {
      const row = await client.query(
        "INSERT INTO sanket.users(name,username,mobile,role,active,password_hash) VALUES($1,$2,$3,'salesman',$4,$5) RETURNING id",
        [data.name, data.username, data.mobile, data.active, passwordHash],
      );
      id = row.rows[0].id;
    }
    const result = { id, message: "Salesman account saved." };
    await client.query(
      "INSERT INTO sanket.audit(id,action,entity_id,actor_id,actor_name,detail) VALUES(gen_random_uuid(),'team.save',$1,$2,$3,$4::jsonb)",
      [
        id,
        actor.id,
        actor.name,
        JSON.stringify({
          name: data.name,
          username: data.username,
          mobile: data.mobile,
          active: data.active,
          passwordChanged: Boolean(passwordHash),
        }),
      ],
    );
    await client.query(
      "INSERT INTO sanket.team_requests(request_id,actor_id,payload_hash,result) VALUES($1,$2,$3,$4::jsonb)",
      [data.requestId, actor.id, payloadHash, JSON.stringify(result)],
    );
    return result;
  });
}
