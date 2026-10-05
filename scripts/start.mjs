import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required. Configure a PostgreSQL connection string in the server environment.",
  );
await import("./migrate-v2.mjs");
const port = process.env.PORT || "10000";
if (!/^\d+$/.test(port) || +port < 1 || +port > 65535)
  throw new Error("PORT must be a valid port number.");
const server = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/next/dist/bin/next", import.meta.url),
    ),
    "start",
    "--hostname",
    "0.0.0.0",
    "--port",
    port,
  ],
  { stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.kill(signal));
server.on("error", () => {
  console.error("The production server could not start.");
  process.exit(1);
});
server.on("exit", (code) => process.exit(code ?? 1));
