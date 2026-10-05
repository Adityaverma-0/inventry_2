import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
const base = "http://127.0.0.1:5174";
const credentials = JSON.parse(
  await readFile(
    process.env.TEST_CREDENTIALS_PATH || "work/test-credentials.json",
    "utf8",
  ),
);
const cookies = {};
async function req(path, body, role = "owner") {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      ...(cookies[role] ? { Cookie: cookies[role] } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cookie = r.headers.get("set-cookie");
  if (cookie) cookies[role] = cookie.split(";")[0];
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}
async function ok(path, body, role) {
  const r = await req(path, body, role);
  assert.ok(
    r.status >= 200 && r.status < 300,
    `${path}: ${r.status} ${JSON.stringify(r.data)}`,
  );
  return r.data;
}
const act = (action, data, role = "owner", requestId = randomUUID()) =>
  ok("/api/v2/action", { action, data, requestId }, role);
test("stock requests and printable sale invoices use real authenticated HTTP routes", async () => {
  assert.equal(
    (await req("/api/v2/warehouse-stock", undefined, "anonymous")).status,
    401,
  );
  assert.equal(
    (await req(`/api/v2/sales/${randomUUID()}/invoice`, undefined, "anonymous"))
      .status,
    401,
  );
  await ok("/api/v2/auth", { action: "login", ...credentials.owner });
  const tag = randomUUID().slice(0, 8),
    worker = {
      name: `Warehouse Test ${tag}`,
      email: `warehouse-${tag}@sanket.test`,
      password: randomBytes(24).toString("base64url"),
    };
  const member = await ok("/api/v2/team", {
    ...worker,
    role: "salesman",
    requestId: randomUUID(),
  });
  const location = await act("location.save", {
    name: `Warehouse HTTP ${tag}`,
  });
  const warehouse = await act("warehouse.save", {
    name: `Warehouse HTTP ${tag}`,
    locationId: location.id,
  });
  const van = await act("vehicle.save", {
    name: `Vehicle HTTP ${tag}`,
    warehouseId: warehouse.id,
  });
  const assigned = await act("assignment.save", {
    vehicleId: van.id,
    salesmanId: member.id,
  });
  const product = await act("product.save", {
    name: `Invoice product ${tag}`,
    category: "Test",
    price: "120.00",
    priceUnit: "BOX",
  });
  const pack = await act("packaging.save", {
    productId: product.id,
    baseUnit: "PIECE",
    levels: [
      { code: "BOX", label: "Box", factor: 12 },
      { code: "PIECE", label: "Piece", factor: 1 },
    ],
    reason: "HTTP fixture packaging",
  });
  const line = (n) => ({
    productId: product.id,
    packagingId: pack.id,
    unitCode: "PIECE",
    quantity: n,
  });
  await act("stock.receive", {
    warehouseId: warehouse.id,
    kind: "MANUAL_RECEIPT",
    reference: randomUUID(),
    notes: "Isolated HTTP fixture",
    lines: [line(100)],
  });
  await ok("/api/v2/auth", { action: "login", ...worker }, "worker");
  const scope = {
    vehicleId: van.id,
    assignmentId: assigned.id,
    reason: "Stock checked by fixture",
  };
  const allocation = await act(
    "inventory-request.create",
    { ...scope, kind: "ALLOCATION", lines: [line(40)] },
    "worker",
  );
  assert.equal(
    (
      await req(
        "/api/v2/action",
        {
          action: "inventory-request.approve",
          data: { id: allocation.id, reason: "Forbidden" },
          requestId: randomUUID(),
        },
        "worker",
      )
    ).status,
    403,
  );
  const overview = await ok(
    `/api/v2/warehouse-stock?vehicleId=${van.id}`,
    undefined,
    "worker",
  );
  assert.ok(overview.rows.every((r) => r.warehouseId === warehouse.id));
  assert.equal(
    overview.rows.find((r) => r.productId === product.id).available,
    100,
  );
  await act("inventory-request.approve", {
    id: allocation.id,
    reason: "Warehouse count confirmed",
  });
  const key = randomUUID(),
    saleData = {
      vehicleId: van.id,
      assignmentId: assigned.id,
      lines: [line(5)],
      customer: {
        name: "Invoice HTTP Customer",
        phone: "",
        address: "",
        gstin: "",
      },
    };
  const sale = await act("sale.create", saleData, "worker", key);
  assert.equal((await act("sale.create", saleData, "worker", key)).id, sale.id);
  const invoice = await ok(
    `/api/v2/sales/${sale.id}/invoice`,
    undefined,
    "worker",
  );
  assert.equal(invoice.totals[0].amount, "50.00");
  assert.equal((await fetch(`${base}/sales-invoice/${sale.id}`)).status, 200);
  await ok(
    "/api/v2/auth",
    { action: "login", ...credentials.salesman },
    "other",
  );
  assert.equal(
    (await req(`/api/v2/sales/${sale.id}/invoice`, undefined, "other")).status,
    404,
  );
  assert.equal(
    (
      await req(
        `/api/v2/warehouse-stock?vehicleId=${van.id}`,
        undefined,
        "other",
      )
    ).status,
    403,
  );
  const returnId = randomUUID(),
    payload = { ...scope, kind: "RETURN", lines: [line(20)] };
  const unloading = await act(
    "inventory-request.create",
    payload,
    "worker",
    returnId,
  );
  assert.equal(
    (await act("inventory-request.create", payload, "worker", returnId)).id,
    unloading.id,
  );
  await act("inventory-request.approve", {
    id: unloading.id,
    reason: "Twenty units unloaded",
  });
  const updated = await ok(
    `/api/v2/warehouse-stock?vehicleId=${van.id}`,
    undefined,
    "worker",
  );
  assert.equal(
    updated.rows.find((r) => r.productId === product.id).available,
    80,
  );
  assert.equal(
    updated.journey.find((r) => r.productId === product.id).current,
    15,
  );
  const before = JSON.stringify(updated.journey);
  await ok(`/api/v2/sales/${sale.id}/invoice`, undefined, "worker");
  await ok(`/api/v2/sales/${sale.id}/invoice`, undefined, "worker");
  assert.equal(
    JSON.stringify(
      (
        await ok(
          `/api/v2/warehouse-stock?vehicleId=${van.id}`,
          undefined,
          "worker",
        )
      ).journey,
    ),
    before,
  );
  const rejected = await act(
    "inventory-request.create",
    { ...scope, kind: "ALLOCATION", lines: [line(2)] },
    "worker",
  );
  await act("inventory-request.reject", {
    id: rejected.id,
    reason: "Enough stock already",
  });
  assert.equal(
    (
      await ok(
        `/api/v2/warehouse-stock?vehicleId=${van.id}`,
        undefined,
        "worker",
      )
    ).requests.find((r) => r.id === rejected.id).status,
    "REJECTED",
  );
  const pending = await act(
    "inventory-request.create",
    { ...scope, kind: "ALLOCATION", lines: [line(3)] },
    "worker",
  );
  assert.ok((await ok("/api/v2/state")).pendingStockRequests >= 1);
  await writeFile(
    process.env.TEST_UI_CREDENTIALS_PATH || "work/warehouse-ui-fixture.json",
    JSON.stringify({
      worker,
      vanId: van.id,
      productId: product.id,
      saleId: sale.id,
      pendingId: pending.id,
    }),
    { mode: 0o600 },
  );
});
