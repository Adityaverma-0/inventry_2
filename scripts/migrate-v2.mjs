import nextEnv from "@next/env";
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  enableChannelBinding: true,
  connectionTimeoutMillis: 8000,
});
const db = await pool.connect();
try {
  await db.query("BEGIN");
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('sanket-v2-migrations'))",
  );
  await db.query("CREATE SCHEMA IF NOT EXISTS sanket");
  await db.query(
    "CREATE TABLE IF NOT EXISTS sanket.schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const directory = path.resolve("db");
  for (const name of (await readdir(directory))
    .filter((n) => /^(09\d|1\d\d)_.*\.sql$/.test(n))
    .sort()) {
    const sql = await readFile(path.join(directory, name), "utf8"),
      checksum = createHash("sha256").update(sql).digest("hex");
    const old = (
      await db.query(
        "SELECT checksum FROM sanket.schema_migrations WHERE name=$1",
        [name],
      )
    ).rows[0];
    if (old) {
      if (old.checksum !== checksum)
        throw new Error(
          `Applied migration changed: ${name}. Add a new migration.`,
        );
      continue;
    }
    await db.query(sql);
    await db.query(
      "INSERT INTO sanket.schema_migrations(name,checksum) VALUES($1,$2)",
      [name, checksum],
    );
    console.log(`Applied ${name}`);
  }
  await db.query("COMMIT");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  db.release();
  await pool.end();
}
