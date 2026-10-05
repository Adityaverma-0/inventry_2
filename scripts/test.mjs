import nextEnv from "@next/env";
import { spawn } from "node:child_process";
nextEnv.loadEnvConfig(process.cwd());
const suite = process.argv[2] || "documents";
const suites = {
  documents: "tests/documents.test.mts",
  ocr: "tests/documents.test.mts",
  domain: "tests/domain.integration.test.ts",
  http: "tests/v2-http.test.mjs",
};
if (!suites[suite]) throw new Error("Choose documents, ocr, domain or http.");
if (
  suite === "domain" &&
  (!process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test"))
)
  throw new Error(
    "Set TEST_DATABASE_URL to a dedicated database ending in _test. Domain fixtures reset its sanket schema.",
  );
const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", suites[suite]],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(suite === "ocr" ? { DOCUMENT_RUNTIME_TESTS: "1" } : {}),
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
