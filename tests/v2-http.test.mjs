import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "../lib/documents/csv.ts";

// This suite mutates only the separately started local sanket_test server.
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5174";
const url = new URL(base);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "5174")
  throw new Error(
    "HTTP tests require the isolated local test server on port 5174.",
  );
const credentialsPath =
  process.env.TEST_CREDENTIALS_PATH ||
  path.resolve("work/test-credentials.json");
const jars = { owner: "", salesman: "" };
const tag = randomUUID().slice(0, 8);
let credentials,
  productId,
  invoice,
  scannedInvoice,
  reportProduct,
  v1Packaging,
  testWarehouse;
async function request(
  endpoint,
  {
    method = "GET",
    body,
    role = "owner",
    origin = base,
    raw = false,
    headers = {},
  } = {},
) {
  const h = { ...headers };
  if (role && jars[role]) h.cookie = jars[role];
  if (method !== "GET") h.origin = origin;
  if (body !== undefined && !(body instanceof FormData)) {
    body = JSON.stringify(body);
    h["content-type"] = "application/json";
  }
  const response = await fetch(base + endpoint, {
    method,
    headers: h,
    body,
    redirect: "manual",
  });
  const cookie = response.headers.get("set-cookie");
  if (cookie && role) jars[role] = cookie.split(";")[0];
  const data = raw
    ? Buffer.from(await response.arrayBuffer())
    : response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : await response.text();
  return { status: response.status, data, headers: response.headers };
}
async function ok(endpoint, options) {
  const r = await request(endpoint, options);
  assert.ok(
    r.status >= 200 && r.status < 300,
    `${endpoint}: HTTP ${r.status}: ${JSON.stringify(r.data)}`,
  );
  return r;
}
const action = (name, data) =>
  ok("/api/v2/action", {
    method: "POST",
    body: { action: name, data, requestId: randomUUID() },
  });
async function upload(name, bytes, requestId = randomUUID(), role = "owner") {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "application/pdf" }), name);
  form.set("requestId", requestId);
  return request("/api/v2/invoices", { method: "POST", body: form, role });
}
async function waitInvoice(id) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const current = (await ok("/api/v2/state")).data.invoices.find(
      (v) => v.id === id,
    );
    if (["COMPLETED", "FAILED"].includes(current?.extractionStatus)) {
      assert.equal(
        current.extractionStatus,
        "COMPLETED",
        current.extractionError,
      );
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  assert.fail(
    "Invoice extraction did not reach a terminal status within 90 seconds.",
  );
}

test("isolated v2 HTTP workflow", { timeout: 180_000 }, async (t) => {
  await t.test(
    "unauthenticated endpoints and CSRF boundaries reject access",
    async () => {
      assert.equal(
        (await request("/api/v2/state", { role: null })).status,
        401,
      );
      assert.equal(
        (await request(`/api/v2/files/${randomUUID()}`, { role: null })).status,
        401,
      );
      assert.equal(
        (
          await request("/api/v2/import", {
            method: "POST",
            body: { csv: "a\nb" },
            role: null,
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request("/api/v2/auth", {
            method: "POST",
            body: {
              action: "login",
              email: "invalid@example.test",
              password: "invalid",
            },
            role: null,
            origin: "https://other-site.test",
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    "first owner setup or fixture login uses secure server sessions",
    async () => {
      try {
        credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
      } catch {
        credentials = {
          owner: {
            email: "http-owner@sanket.test",
            password: randomBytes(24).toString("base64url"),
            name: "HTTP Test Owner",
          },
          salesman: {
            email: "http-salesman@sanket.test",
            password: randomBytes(24).toString("base64url"),
            name: "HTTP Test Salesman",
          },
        };
        await mkdir(path.dirname(credentialsPath), { recursive: true });
        await writeFile(credentialsPath, JSON.stringify(credentials, null, 2), {
          mode: 0o600,
        });
      }
      const status = (await ok("/api/v2/auth", { role: null })).data;
      const response = await ok("/api/v2/auth", {
        method: "POST",
        body: {
          action: status.setupRequired ? "setup" : "login",
          ...credentials.owner,
        },
        role: "owner",
      });
      assert.equal(response.data.user.role, "owner");
      assert.match(response.headers.get("set-cookie"), /HttpOnly/i);
      assert.match(response.headers.get("set-cookie"), /SameSite=Lax/i);
      const state = (await ok("/api/v2/state")).data;
      if (status.setupRequired) {
        for (const key of ["locations", "warehouses", "vehicles", "products"])
          assert.equal(
            state[key].length,
            0,
            `Fresh setup must not seed ${key}`,
          );
      }
      // Create fixtures explicitly, only on the isolated HTTP test server.
      for (const [name, count] of [
        ["Hardpiplya", 2],
        ["Dewas", 1],
      ]) {
        if (state.warehouses.some((v) => v.name === `${name} Godown`)) continue;
        const location = (await action("location.save", { name })).data;
        const warehouse = (
          await action("warehouse.save", {
            name: `${name} Godown`,
            locationId: location.id,
          })
        ).data;
        for (let i = 1; i <= count; i++)
          await action("vehicle.save", {
            name: `${name} Vehicle ${i}`,
            warehouseId: warehouse.id,
          });
      }
      assert.equal(JSON.stringify(state).includes("password_hash"), false);
      assert.equal(
        (
          await request("/api/v2/auth", {
            method: "POST",
            body: { action: "setup", ...credentials.owner },
          })
        ).status,
        status.localSetup ? 409 : 403,
      );
      assert.equal(
        (
          await request("/api/v2/auth", {
            method: "POST",
            body: {
              action: "login",
              email: credentials.owner.email,
              password: "wrong-password",
            },
          })
        ).status,
        401,
      );
    },
  );
  await t.test(
    "catalogue preview, explicit confirmation, replay and conflict keep stock untouched",
    async () => {
      const csv = `"Product","Category","Packaging","Warehouse","Selling price","Min stock","Status"\r\n"Allu Bhumiya HTTP ${tag}","snaks","1","0","200.00","0","true"\r\n`;
      const preview = (
        await ok("/api/v2/import", { method: "POST", body: { csv } })
      ).data;
      assert.equal(preview.rows[0].sourceStockQuantity, 0);
      assert.equal(preview.rows[0].product.price, "200.00");
      assert.equal(preview.rows[0].product.priceUnit, null);
      assert.equal(preview.rows[0].packaging, null);
      const before = (await ok("/api/v2/state")).data;
      const body = {
        csv,
        confirm: true,
        requestId: randomUUID(),
        decisions: [{ rowNumber: 2, action: "create" }],
      };
      const first = (await ok("/api/v2/import", { method: "POST", body })).data;
      const replay = (await ok("/api/v2/import", { method: "POST", body }))
        .data;
      assert.deepEqual(replay, first);
      assert.deepEqual(first.summary, {
        created: 1,
        updated: 0,
        skipped: 0,
        stockMovements: 0,
      });
      assert.equal(
        (
          await request("/api/v2/import", {
            method: "POST",
            body: { ...body, csv: csv.replace("200.00", "210.00") },
          })
        ).status,
        409,
      );
      const after = (await ok("/api/v2/state")).data;
      const created = after.products.find(
        (p) => p.name === `Allu Bhumiya HTTP ${tag}`,
      );
      assert.ok(created);
      productId = created.id;
      assert.equal(created.ready, false);
      assert.equal(created.rawImport.Packaging, "1");
      assert.equal(created.rawImport.Warehouse, "0");
      assert.equal(created.priceUnit, null);
      assert.deepEqual(after.balances, before.balances);
      assert.equal(after.movements.length, before.movements.length);
      assert.equal(
        after.products.filter((p) => p.name === created.name).length,
        1,
      );
      const skip = (
        await ok("/api/v2/import", {
          method: "POST",
          body: {
            csv,
            confirm: true,
            requestId: randomUUID(),
            decisions: [{ rowNumber: 2, action: "skip" }],
          },
        })
      ).data;
      assert.equal(skip.summary.skipped, 1);
    },
  );
  await t.test(
    "owner uploads digital invoice, retries safely and blocks renamed duplicates",
    async () => {
      const bytes = Buffer.concat([
        await readFile(
          new URL("./fixtures/digital-invoice.pdf", import.meta.url),
        ),
        Buffer.from(`\n% http-test ${tag}\n`),
      ]);
      const requestId = randomUUID();
      const first = await upload("digital-invoice.pdf", bytes, requestId);
      assert.equal(first.status, 201, JSON.stringify(first.data));
      const again = await upload("digital-invoice.pdf", bytes, requestId);
      assert.equal(again.status, 201);
      assert.deepEqual(again.data, first.data);
      const renamed = await upload("renamed-invoice.pdf", bytes);
      assert.equal(renamed.status, 409);
      assert.equal(renamed.data.code, "DUPLICATE_INVOICE");
      const conflict = await upload("changed-name.pdf", bytes, requestId);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.code, "IDEMPOTENCY_CONFLICT");
      invoice = await waitInvoice(first.data.id);
      assert.match(invoice.extractedText, /Allu Bhumiya/);
      assert.equal(invoice.status, "DRAFT");
      assert.equal(invoice.lines.length, 0);
      assert.ok(
        Array.isArray(invoice.suggestions) && invoice.suggestions.length > 0,
        "Structured extraction suggestions persist",
      );
      const downloaded = await ok(`/api/v2/files/${invoice.fileId}`, {
        raw: true,
      });
      assert.deepEqual(downloaded.data, bytes);
      assert.match(downloaded.headers.get("cache-control"), /private/);
      assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
      assert.equal(downloaded.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.equal(
        downloaded.headers.get("content-security-policy"),
        "frame-ancestors 'self'",
      );
      assert.equal(
        (await request(`/api/v2/files/${invoice.fileId}`, { role: null }))
          .status,
        401,
      );
    },
  );
  await t.test(
    "scanned invoice uses real OCR and re-extraction never posts stock",
    async () => {
      const bytes = Buffer.concat([
        await readFile(
          new URL("./fixtures/scanned-invoice.pdf", import.meta.url),
        ),
        Buffer.from(`\n% http-test-scan ${tag}\n`),
      ]);
      const before = (await ok("/api/v2/state")).data;
      const result = await upload("scanned-invoice.pdf", bytes);
      assert.equal(result.status, 201, JSON.stringify(result.data));
      scannedInvoice = await waitInvoice(result.data.id);
      assert.match(scannedInvoice.extractedText, /Example Foods/);
      assert.ok(
        scannedInvoice.suggestions.some((s) => s.billedQuantity === 10),
      );
      assert.equal(
        (
          await ok(`/api/v2/invoices/${scannedInvoice.id}/extract`, {
            method: "POST",
          })
        ).status,
        202,
      );
      await waitInvoice(scannedInvoice.id);
      const after = (await ok("/api/v2/state")).data;
      assert.deepEqual(after.balances, before.balances);
      assert.equal(after.movements.length, before.movements.length);
      const bad = new FormData();
      bad.set(
        "file",
        new Blob(["<script>alert(1)</script>"], { type: "application/pdf" }),
        "bad.pdf",
      );
      bad.set("requestId", randomUUID());
      assert.equal(
        (await request("/api/v2/invoices", { method: "POST", body: bad }))
          .status,
        422,
      );
    },
  );
  await t.test(
    "salesman role cannot access files, imports, approvals or private owner data",
    async () => {
      const current = (await ok("/api/v2/state")).data;
      let member = current.users.find(
        (u) => u.email === credentials.salesman.email,
      );
      if (!member) {
        const created = (
          await ok("/api/v2/team", {
            method: "POST",
            body: {
              ...credentials.salesman,
              role: "salesman",
              requestId: randomUUID(),
            },
          })
        ).data;
        member = { id: created.id };
      }
      await ok("/api/v2/auth", {
        method: "POST",
        body: { action: "login", ...credentials.salesman },
        role: "salesman",
      });
      assert.equal(
        (await request(`/api/v2/files/${invoice.fileId}`, { role: "salesman" }))
          .status,
        403,
      );
      assert.equal(
        (
          await request(`/api/v2/invoices/${invoice.id}/extract`, {
            method: "POST",
            role: "salesman",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/api/v2/import", {
            method: "POST",
            body: { csv: "Product\nExample" },
            role: "salesman",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/api/v2/action", {
            method: "POST",
            body: {
              action: "invoice.approve",
              data: { id: invoice.id, revision: invoice.revision },
              requestId: randomUUID(),
            },
            role: "salesman",
          })
        ).status,
        403,
      );
      assert.equal(
        (await request("/api/v2/export?kind=products", { role: "salesman" }))
          .status,
        403,
      );
      const scoped = (await ok("/api/v2/state", { role: "salesman" })).data;
      assert.equal(scoped.invoices.length, 0);
      assert.equal(scoped.audit.length, 0);
      assert.ok(
        scoped.warehouses.every((w) =>
          scoped.vehicles.some((v) => v.warehouseId === w.id),
        ),
      );
      assert.ok(
        scoped.balances.every(
          (b) =>
            b.locationType === "vehicle" &&
            scoped.vehicles.some((v) => v.id === b.locationId),
        ),
      );
      assert.equal(
        (
          await request("/api/v2/action", {
            method: "POST",
            body: {
              action: "product.save",
              data: { name: "Forbidden", category: "x" },
              requestId: randomUUID(),
            },
            role: "salesman",
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    "exports have complete packaging fields and logout revokes the server session",
    async () => {
      const exported = await ok("/api/v2/export?kind=products");
      assert.match(exported.headers.get("content-type"), /text\/csv/);
      assert.match(exported.data, /Packaging levels JSON/);
      assert.match(exported.data, /Price unit/);
      assert.match(exported.data, new RegExp(tag));
      const stock = await ok("/api/v2/export?kind=stock");
      assert.match(stock.data, /Base quantity/);
      assert.match(stock.data, /Mixed quantity/);
      assert.equal((await request("/api/v2/export?kind=unknown")).status, 400);
      assert.equal(
        (
          await request("/api/v2/import", {
            method: "POST",
            body: { csv: "Product\nBad" },
            origin: "https://attacker.test",
          })
        ).status,
        403,
      );
      const old = jars.salesman;
      await ok("/api/v2/auth", {
        method: "POST",
        body: { action: "logout" },
        role: "salesman",
      });
      jars.salesman = old;
      assert.equal(
        (await request("/api/v2/state", { role: "salesman" })).status,
        401,
      );
      await ok("/api/v2/auth", {
        method: "POST",
        body: { action: "login", ...credentials.salesman },
        role: "salesman",
      });
    },
  );
  await t.test(
    "report approval and exact revision CSV retain old packaging and numeric unit counts",
    async () => {
      let state = (await ok("/api/v2/state")).data;
      testWarehouse = state.warehouses.find(
        (w) => w.name === "Hardpiplya Godown",
      );
      const member = state.users.find(
        (u) => u.email === credentials.salesman.email,
      );
      for (const assignment of state.assignments.filter(
        (a) => a.salesmanId === member.id && !a.to,
      ))
        await action("assignment.save", {
          vehicleId: assignment.vehicleId,
          salesmanId: null,
          reason: "HTTP test switches to its new isolated vehicle",
        });
      const vehicle = (
        await action("vehicle.save", {
          name: `HTTP Vehicle ${tag}`,
          warehouseId: testWarehouse.id,
        })
      ).data;
      await action("assignment.save", {
        vehicleId: vehicle.id,
        salesmanId: member.id,
        reason: "HTTP test assignment",
      });
      const source = state.products.find((p) => p.id === productId);
      await action("product.save", {
        id: productId,
        name: source.name,
        category: source.category,
        active: true,
        minStock: 0,
        price: source.price,
        priceUnit: "piece",
        currency: "INR",
      });
      const levels = [
        { code: "box", label: "Box", factor: 144 },
        { code: "strip", label: "Strip", factor: 12 },
        { code: "piece", label: "Piece", factor: 1 },
      ];
      await action("packaging.save", {
        productId,
        baseUnit: "piece",
        levels,
        reason: "HTTP fixture 12 pieces per strip and 12 strips per box",
      });
      state = (await ok("/api/v2/state")).data;
      reportProduct = state.products.find((p) => p.id === productId);
      v1Packaging = reportProduct.packaging;
      const quantity = (quantity) => ({
        productId,
        packagingId: v1Packaging.id,
        unitCode: "piece",
        quantity,
      });
      await action("stock.receive", {
        warehouseId: testWarehouse.id,
        kind: "OPENING",
        reference: `HTTP-OPENING-${randomUUID()}`,
        lines: [quantity(350)],
        notes: "Isolated HTTP report fixture stock",
      });
      await action("transfer.create", {
        warehouseId: testWarehouse.id,
        vehicleId: vehicle.id,
        lines: [quantity(350)],
      });
      const assignment = state.assignments.find(
        (a) => a.vehicleId === vehicle.id && !a.to,
      );
      await ok("/api/v2/action", {
        method: "POST",
        role: "salesman",
        body: {
          action: "sale.create",
          data: {
            vehicleId: vehicle.id,
            assignmentId: assignment.id,
            lines: [quantity(21)],
            notes: "HTTP test sale",
          },
          requestId: randomUUID(),
        },
      });
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: state.settings.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const preview = (
        await ok(`/api/v2/report?vehicleId=${vehicle.id}&day=${day}`, {
          role: "salesman",
        })
      ).data;
      assert.equal(
        preview.lines.find((l) => l.productId === productId).closing,
        329,
      );
      const submit = (
        await ok("/api/v2/action", {
          method: "POST",
          role: "salesman",
          body: {
            action: "report.submit",
            data: {
              vehicleId: vehicle.id,
              day,
              notes: "HTTP snapshot",
              expectedSourceHash: preview.sourceHash,
            },
            requestId: randomUUID(),
          },
        })
      ).data;
      await action("report.approve", {
        id: submit.id,
        revision: submit.revision,
      });
      const v1 = (
        await ok(`/api/v2/report/${submit.id}?revision=${submit.revision}`)
      ).data;
      assert.equal(v1.status, "APPROVED");
      assert.equal(
        v1.lines.find((l) => l.productId === productId).formatted,
        "2 Box + 3 Strip + 5 Piece",
      );
      await action("packaging.save", {
        productId,
        baseUnit: "piece",
        levels: [
          { code: "box", label: "Box", factor: 100 },
          { code: "strip", label: "Strip", factor: 10 },
          { code: "piece", label: "Piece", factor: 1 },
        ],
        reason: "HTTP fixture changes display only to 10 by 10",
      });
      const unchanged = (
        await ok(`/api/v2/report/${submit.id}?revision=${submit.revision}`)
      ).data;
      assert.deepEqual(unchanged.lines, v1.lines);
      const response = await ok(
        `/api/v2/export?kind=reports&reportId=${submit.id}&revision=${submit.revision}&productId=${productId}`,
      );
      const parsed = parseCsv(response.data),
        header = parsed[0].cells,
        row = parsed[1].cells,
        get = (name) => row[header.indexOf(name)];
      assert.equal(get("Revision"), String(submit.revision));
      assert.equal(get("Closing base quantity"), "329");
      assert.equal(get("Remaining box count"), "2");
      assert.equal(get("Remaining strip count"), "3");
      assert.equal(get("Remaining piece count"), "5");
      assert.deepEqual(JSON.parse(get("Packaging levels JSON")), levels);
      const pdf = await ok(
        `/api/v2/report/${submit.id}/pdf?revision=${submit.revision}`,
        { raw: true },
      );
      assert.equal(pdf.headers.get("content-type"), "application/pdf");
      assert.match(pdf.headers.get("content-disposition"), /attachment/);
      assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
      assert.ok(pdf.data.length > 10_000);
      await writeFile(
        path.resolve(
          process.env.TEST_OUTPUT_DIR || "work",
          "report-exact-revision.pdf",
        ),
        pdf.data,
      );
      assert.equal(
        (
          await request(
            `/api/v2/report/${submit.id}/pdf?revision=${submit.revision}`,
            { role: null },
          )
        ).status,
        401,
      );
      assert.equal(
        (await request(`/api/v2/report/${submit.id}/pdf?revision=0`)).status,
        400,
      );
      const live = parseCsv(
        (
          await ok(
            `/api/v2/export?kind=stock&vehicleId=${vehicle.id}&productId=${productId}`,
          )
        ).data,
      );
      const cell = (name) => live[1].cells[live[0].cells.indexOf(name)];
      assert.equal(cell("Base quantity"), "329");
      assert.equal(cell("Remaining box count"), "3");
      assert.equal(cell("Remaining strip count"), "2");
      assert.equal(cell("Remaining piece count"), "9");
      assert.equal(
        (await request("/api/v2/export?kind=reports&revision=1")).status,
        400,
      );
      assert.equal(
        (await request("/api/v2/export?kind=stock&from=2026-02-30")).status,
        400,
      );
      assert.equal(
        (await request(`/api/v2/report/${submit.id}?revision=abc`)).status,
        400,
      );
    },
  );
  await t.test(
    "invoice history preserves reviewed revisions, decisions and linked correction records",
    async () => {
      const initial = (await ok(`/api/v2/invoices/${invoice.id}/history`)).data;
      assert.ok(initial.revisions.some((r) => r.revision === 1));
      const saved = (
        await action("invoice.update", {
          id: invoice.id,
          revision: invoice.revision,
          supplier: "HTTP Supplier",
          invoiceNumber: `HTTP-${tag}`,
          invoiceDate: "2026-10-04",
          warehouseId: testWarehouse.id,
          lines: [
            {
              description: "Reviewed Allu Bhumiya fixture",
              productId,
              packagingId: v1Packaging.id,
              unitCode: "piece",
              invoiceQuantity: 10,
              receivedQuantity: 10,
              reason:
                "Explicitly verified historical package version from the source invoice",
              evidence: "Fixture page 1 item 1",
            },
          ],
          reason: "HTTP review verifies received goods",
        })
      ).data;
      await action("invoice.ready", {
        id: invoice.id,
        revision: saved.revision,
      });
      await action("invoice.approve", {
        id: invoice.id,
        revision: saved.revision,
      });
      await action("stock.adjust", {
        locationId: testWarehouse.id,
        locationType: "warehouse",
        productId,
        delta: -1,
        sourceInvoiceId: invoice.id,
        reason: "HTTP linked correction for one damaged piece",
      });
      const history = (await ok(`/api/v2/invoices/${invoice.id}/history`)).data;
      assert.ok(history.revisions.some((r) => r.revision === saved.revision));
      assert.ok(history.decisions.some((d) => d.action === "invoice.approve"));
      assert.ok(history.corrections.some((c) => c.sourceDocumentId));
      assert.equal(
        (
          await request(`/api/v2/invoices/${invoice.id}/history`, {
            role: "salesman",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(`/api/v2/invoices/${invoice.id}/extract`, {
            method: "POST",
          })
        ).status,
        409,
      );
      const state = (await ok("/api/v2/state")).data;
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: state.settings.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(state.serverTime));
      const reconciliation = await ok(
        `/api/v2/export?kind=reconciliation&day=${day}&warehouseId=${testWarehouse.id}&productId=${productId}`,
      );
      const csv = parseCsv(reconciliation.data),
        get = (name) => csv[1].cells[csv[0].cells.indexOf(name)];
      assert.equal(get("Opening base"), "0");
      assert.equal(get("Receipts base"), "360");
      assert.equal(get("Outgoing loads base"), "350");
      assert.equal(get("Signed adjustments base"), "-1");
      assert.equal(get("Closing base"), "9");
      assert.equal(get("Equation balances"), "true");
      assert.equal(get("Ledger matches live"), "true");
      assert.equal(
        (
          await request(`/api/v2/export?kind=reconciliation&day=${day}`, {
            role: "salesman",
          })
        ).status,
        403,
      );
    },
  );
});
