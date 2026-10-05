import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export type DbClient = PoolClient;
type Runtime = { pool?: Pool; migration?: Promise<void> };
const runtime = globalThis as typeof globalThis & { sanketDb?: Runtime };
const shared = (runtime.sanketDb ??= {});

export const pool = (shared.pool ??= new Pool({
  connectionString: process.env.DATABASE_URL,
  enableChannelBinding: true,
  max: 12,
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis: 30_000,
  application_name: "sanket-distribution",
}));

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result: QueryResult<T> = await pool.query(text, values);
  return result.rows;
}

export async function transaction<T>(
  work: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Serialize schema changes, checksum applied files, and never run legacy migrations implicitly. */
export async function migrate(): Promise<void> {
  if (shared.migration) return shared.migration;
  shared.migration = transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('sanket-v2-migrations'))",
    );
    await client.query("CREATE SCHEMA IF NOT EXISTS sanket");
    await client.query(
      "CREATE TABLE IF NOT EXISTS sanket.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = path.join(process.cwd(), "db");
    const files = (await readdir(directory))
      .filter((name) => /^(09\d|1\d\d)_.*\.sql$/.test(name))
      .sort();
    for (const name of files) {
      const sql = await readFile(path.join(directory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const old = await client.query(
        "SELECT checksum FROM sanket.schema_migrations WHERE name=$1",
        [name],
      );
      if (old.rows[0]) {
        if (old.rows[0].checksum !== checksum)
          throw new Error(
            `Applied migration changed: ${name}. Add a new migration instead.`,
          );
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO sanket.schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
    }
  }).catch((error) => {
    shared.migration = undefined;
    throw error;
  });
  return shared.migration;
}
