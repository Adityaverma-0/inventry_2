import nextEnv from "@next/env";
import { spawn } from "node:child_process";
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_HTTP_DATABASE_URL)
  throw new Error(
    "Set TEST_HTTP_DATABASE_URL to an isolated local database ending in _test. The application DATABASE_URL is never used for fixtures.",
  );
const url = new URL(process.env.TEST_HTTP_DATABASE_URL);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  !url.pathname.endsWith("_test")
)
  throw new Error(
    "HTTP test fixtures require an isolated local database ending in _test.",
  );
const production = process.argv.includes("--production");
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    ...(production ? ["start"] : ["dev", "--webpack"]),
    "--hostname",
    "127.0.0.1",
    "--port",
    "5174",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url.href,
      APP_URL: "http://127.0.0.1:5174",
      NEXT_DIST_DIR:
        process.env.TEST_BUILD_DIR ||
        (production ? ".next-production" : ".next-test"),
      DATA_DIR: "./.data-test",
      ALLOW_LOCAL_SETUP: "true",
    },
  },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
