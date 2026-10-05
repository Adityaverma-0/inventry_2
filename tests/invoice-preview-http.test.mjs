import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

// Read-only business verification: reuse existing test accounts and invoice files.
const base = process.env.PREVIEW_TEST_URL || "http://127.0.0.1:5175";
const parsed = new URL(base);
if (
  !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
  !["5174", "5175"].includes(parsed.port)
)
  throw Error(
    "Preview HTTP verification requires the isolated local test server.",
  );
const fixture = JSON.parse(
  await readFile(
    process.env.TEST_CREDENTIALS_PATH ||
      path.resolve("work/test-credentials.json"),
    "utf8",
  ),
);
async function login(account) {
  const r = await fetch(base + "/api/v2/auth", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ action: "login", ...account }),
  });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
test("private invoice page endpoint renders PNG, reports pages and rejects unauthorized access", async () => {
  const cookie = await login(fixture.owner),
    salesman = await login(fixture.salesman);
  const state = await (
    await fetch(base + "/api/v2/state", { headers: { cookie } })
  ).json();
  const invoice = state.invoices.find((i) => i.mime === "application/pdf");
  assert.ok(invoice, "Existing isolated test PDF invoice is required.");
  const endpoint = `${base}/api/v2/files/${invoice.fileId}/preview`;
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal(
    (await fetch(endpoint, { headers: { cookie: salesman } })).status,
    403,
  );
  const metadata = await fetch(endpoint + "?metadata=true", {
    headers: { cookie },
  });
  assert.equal(metadata.status, 200);
  const info = await metadata.json();
  assert.ok(info.pages >= 1 && info.pages <= 20);
  assert.equal(info.mime, "application/pdf");
  assert.equal(info.fileName, invoice.fileName);
  const response = await fetch(endpoint + "?page=1", { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("x-document-pages"), String(info.pages));
  assert.equal(response.headers.get("x-document-page"), "1");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(
    bytes.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  assert.ok(bytes.length > 1000);
  for (const page of ["0", "-1", "x", "1.5"])
    assert.equal(
      (await fetch(endpoint + `?page=${page}`, { headers: { cookie } })).status,
      400,
    );
  assert.equal(
    (await fetch(endpoint + `?page=${info.pages + 1}`, { headers: { cookie } }))
      .status,
    404,
  );
  assert.equal(
    (
      await fetch(`${base}/api/v2/files/${randomUUID()}/preview`, {
        headers: { cookie },
      })
    ).status,
    404,
  );
  const original = await fetch(
    `${base}/api/v2/files/${invoice.fileId}?download=true`,
    { headers: { cookie } },
  );
  assert.equal(original.status, 200);
  assert.equal(original.headers.get("content-type"), "application/pdf");
  const dir = path.resolve(
    process.env.TEST_OUTPUT_DIR || "work",
    "invoice-preview-verification",
  );
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "http-page.png"), bytes);
});
