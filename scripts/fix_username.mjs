import nextEnv from "@next/env";
import pg from "pg";
nextEnv.loadEnvConfig(process.cwd());
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, enableChannelBinding: true, connectionTimeoutMillis: 8000 });
const db = await pool.connect();
try {
  let rows = (await db.query("SELECT id, name, username, email FROM sanket.users")).rows;
  console.log("Before:", rows);
  for (const row of rows) {
    if (!row.username) {
        let newUsername = Math.random().toString(36).substring(2, 10);
        console.log(`Setting username ${newUsername} for user ${row.name}`);
        await db.query("UPDATE sanket.users SET username = $1 WHERE id = $2", [newUsername, row.id]);
    }
  }
} finally {
  db.release();
  await pool.end();
}
