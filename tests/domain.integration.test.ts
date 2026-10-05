import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Actor, QuantityInput, InvoiceLine } from "../lib/domain/types";
import { formatQuantity, toBase, validateLevels } from "../lib/domain/units";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith("_test"))
  throw new Error(
    "Set TEST_DATABASE_URL to a dedicated database whose name ends with _test. Tests erase only that database’s sanket schema.",
  );
process.env.DATABASE_URL = testUrl;
const { pool, migrate, query } = await import("../lib/server/database");
const {
  applyAction,
  getState,
  previewReport,
  getReportRevision,
  packagingHistory,
  setInvoiceExtraction,
} = await import("../lib/domain/service");
const { initializeBusiness } = await import("./business-fixture");
let lock: import("../lib/server/database").DbClient | undefined;
const owner: Actor = {
  id: randomUUID(),
  name: "Synthetic Test Owner",
  username: "test", email: "owner@domain.invalid",
  role: "owner",
  active: true,
};
const salesman: Actor = {
  id: randomUUID(),
  name: "Synthetic Salesman A",
  username: "test", email: "a@domain.invalid",
  role: "salesman",
  active: true,
};
const other: Actor = {
  id: randomUUID(),
  name: "Synthetic Salesman B",
  username: "test", email: "b@domain.invalid",
  role: "salesman",
  active: true,
};
let warehouse: string,
  dewas: string,
  vehicle: string,
  vehicle2: string,
  product: string,
  pack: string,
  reportId: string;
const call = (
  actor: Actor,
  action: string,
  data: unknown,
  key = randomUUID(),
) => applyAction(actor, action, data, key);
const line = (
  quantity: number,
  unitCode = "piece",
  productId = product,
  packagingId = pack,
): QuantityInput => ({ productId, packagingId, unitCode, quantity });
const reject = async (promise: Promise<unknown>, code: string) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof Error && "code" in e && e.code === code,
    `Expected ${code}`,
  );
const balance = async (type: string, id: string, p = product) =>
  Number(
    (
      await query(
        "SELECT quantity FROM sanket.stock_balances WHERE location_type=$1 AND location_id=$2 AND product_id=$3",
        [type, id, p],
      )
    )[0]?.quantity || 0,
  );
const day = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
before(async () => {
  lock = await pool.connect();
  await lock.query(
    "SELECT pg_advisory_lock(hashtext('sanket-domain-test-suite'))",
  );
  await query("DROP SCHEMA IF EXISTS sanket CASCADE");
  await migrate();
  for (const u of [owner, salesman, other])
    await query(
      "INSERT INTO sanket.users(id,name,email,role,active,password_hash) VALUES($1,$2,$3,$4,true,$5)",
      [u.id, u.name, u.email, u.role, "test-fixture-not-a-login"],
    );
  await initializeBusiness(owner);
  await initializeBusiness(owner);
  const state = await getState(owner);
  assert.equal(state.locations.length, 2);
  assert.equal(state.warehouses.length, 2);
  assert.equal(state.vehicles.length, 3);
  assert.equal(state.products.length, 0);
  assert.equal(state.balances.length, 0);
  warehouse = state.warehouses.find((w) => w.name === "Hardpiplya Godown")!.id;
  dewas = state.warehouses.find((w) => w.name === "Dewas Godown")!.id;
  const vs = state.vehicles.filter((v) => v.warehouseId === warehouse);
  vehicle = vs[0].id;
  vehicle2 = vs[1].id;
  await call(owner, "assignment.save", {
    vehicleId: vehicle,
    salesmanId: salesman.id,
  });
  await call(owner, "assignment.save", {
    vehicleId: vehicle2,
    salesmanId: other.id,
  });
  product = (
    await call(owner, "product.save", {
      name: "Synthetic Chips",
      category: "Test only",
      active: true,
      minStock: 0,
    })
  ).id!;
  pack = (
    await call(owner, "packaging.save", {
      productId: product,
      baseUnit: "piece",
      levels: [
        { code: "box", label: "Boxes", factor: 144 },
        { code: "strip", label: "Strips", factor: 12 },
        { code: "piece", label: "Pieces", factor: 1 },
      ],
      reason: "Synthetic initial packaging",
    })
  ).id!;
});
after(async () => {
  if (lock) {
    await lock.query(
      "SELECT pg_advisory_unlock(hashtext('sanket-domain-test-suite'))",
    );
    lock.release();
  }
  await pool.end();
});

test("exact mixed units, boundary round trips, custom hierarchy and invalid definitions", () => {
  const levels = [
    { code: "box", label: "Boxes", factor: 144 },
    { code: "strip", label: "Strips", factor: 12 },
    { code: "piece", label: "Pieces", factor: 1 },
  ];
  assert.equal(
    toBase(1, "box", { levels }) +
      toBase(2, "strip", { levels }) +
      toBase(3, "piece", { levels }),
    171,
  );
  assert.equal(formatQuantity(329, levels), "2 Boxes + 3 Strips + 5 Pieces");
  assert.equal(formatQuantity(288, levels), "2 Boxes");
  assert.equal(formatQuantity(72, levels), "6 Strips");
  assert.equal(formatQuantity(0, levels), "0 Pieces");
  for (const q of [0, 11, 12, 13, 143, 144, 145, 329, 350]) {
    let remainder = q;
    const total = levels.reduce((sum, l) => {
      const n = Math.floor(remainder / l.factor);
      remainder %= l.factor;
      return sum + n * l.factor;
    }, 0);
    assert.equal(total, q);
  }
  const custom = [
    { code: "carton", label: "Cartons", factor: 600 },
    { code: "box", label: "Boxes", factor: 100 },
    { code: "pack", label: "Packs", factor: 10 },
    { code: "piece", label: "Pieces", factor: 1 },
  ];
  assert.equal(validateLevels("piece", custom).length, 4);
  assert.equal(
    formatQuantity(715, custom),
    "1 Cartons + 1 Boxes + 1 Packs + 5 Pieces",
  );
  assert.throws(() =>
    validateLevels("piece", [
      { code: "box", label: "Box", factor: 145 },
      levels[1],
      levels[2],
    ]),
  );
  assert.throws(() =>
    validateLevels("piece", [{ code: "piece", label: "Piece", factor: 0 }]),
  );
  assert.throws(() =>
    validateLevels("piece", [{ code: "piece", label: "Piece", factor: 1.5 }]),
  );
  assert.throws(() => validateLevels("piece", [levels[2], levels[2]]));
  assert.throws(() => toBase(Number.MAX_SAFE_INTEGER, "box", { levels }));
});

test("invoice extraction and rejection never move stock; exact reviewed revision approval posts once under concurrency", async () => {
  const invoice = (
    await call(owner, "invoice.create", {
      fileId: randomUUID(),
      fileName: "synthetic-invoice.pdf",
      mime: "application/pdf",
      hash: "a".repeat(64),
    })
  ).id!;
  await setInvoiceExtraction(invoice, {
    extractionStatus: "COMPLETED",
    extractedText: "2 Boxes Synthetic Chips",
    suggestions: [],
    warnings: ["Synthetic test"],
  });
  assert.equal(await balance("warehouse", warehouse), 0);
  await reject(
    call(salesman, "invoice.approve", { id: invoice, revision: 1 }),
    "FORBIDDEN",
  );
  await reject(
    call(owner, "invoice.create", {
      fileId: randomUUID(),
      fileName: "renamed.pdf",
      mime: "application/pdf",
      hash: "a".repeat(64),
    }),
    "DUPLICATE_FILE",
  );
  const lines = [
    {
      description: "Synthetic Chips",
      productId: product,
      packagingId: pack,
      unitCode: "box",
      invoiceQuantity: 2,
      receivedQuantity: 2,
      reason: "",
      evidence: "Page 1, line 1",
    },
  ];
  await call(owner, "invoice.update", {
    id: invoice,
    revision: 1,
    supplier: "Synthetic Supplier",
    invoiceNumber: "SYN-1",
    invoiceDate: day(),
    warehouseId: warehouse,
    lines,
  });
  await reject(
    call(owner, "invoice.approve", { id: invoice, revision: 1 }),
    "STALE_REVISION",
  );
  await call(owner, "invoice.reject", {
    id: invoice,
    revision: 2,
    reason: "Check physical quantity",
  });
  assert.equal(await balance("warehouse", warehouse), 0);
  await call(owner, "invoice.ready", { id: invoice, revision: 2 });
  const results = await Promise.all([
    call(owner, "invoice.approve", { id: invoice, revision: 2 }),
    call(owner, "invoice.approve", { id: invoice, revision: 2 }),
  ]);
  assert.equal(results[0].reference, results[1].reference);
  assert.equal(await balance("warehouse", warehouse), 288);
  assert.equal(await balance("warehouse", dewas), 0);
  assert.equal(await balance("vehicle", vehicle), 0);
  assert.equal(
    Number(
      (
        await query(
          "SELECT COUNT(*) FROM sanket.stock_documents WHERE kind='PURCHASE_RECEIPT'",
        )
      )[0].count,
    ),
    1,
  );
  await reject(
    call(owner, "invoice.update", {
      id: invoice,
      revision: 2,
      supplier: "Synthetic Supplier",
      invoiceNumber: "SYN-1",
      invoiceDate: day(),
      warehouseId: warehouse,
      lines,
    }),
    "INVOICE_POSTED",
  );
});

test("transfer, sale, duplicate key, changed payload, oversell and linked correction preserve exact stock", async () => {
  await call(owner, "transfer.create", {
    warehouseId: warehouse,
    vehicleId: vehicle,
    lines: [line(2, "box")],
  });
  assert.equal(await balance("warehouse", warehouse), 0);
  assert.equal(await balance("vehicle", vehicle), 288);
  const key = randomUUID(),
    payload = { vehicleId: vehicle, lines: [line(18, "strip")] };
  const sale = await call(salesman, "sale.create", payload, key);
  assert.equal(await balance("vehicle", vehicle), 72);
  assert.deepEqual(await call(salesman, "sale.create", payload, key), sale);
  await reject(
    call(salesman, "sale.create", { ...payload, lines: [line(1)] }, key),
    "IDEMPOTENCY_CONFLICT",
  );
  await reject(
    call(salesman, "sale.create", { vehicleId: vehicle, lines: [line(73)] }),
    "INSUFFICIENT_STOCK",
  );
  assert.equal(await balance("vehicle", vehicle), 72);
  await reject(
    call(other, "sale.create", { vehicleId: vehicle, lines: [line(1)] }),
    "FORBIDDEN",
  );
  const correction = await call(salesman, "sale.correct", {
    saleId: sale.id,
    lines: [line(17, "strip")],
    reason: "Correct entered quantity",
  });
  assert.equal(await balance("vehicle", vehicle), 84);
  assert.notEqual(correction.id, sale.id);
  await reject(
    call(salesman, "sale.correct", {
      saleId: sale.id,
      lines: [line(17, "strip")],
      reason: "Repeat reversal",
    }),
    "ALREADY_CORRECTED",
  );
  assert.equal(await balance("vehicle", vehicle), 84);
  const state = await getState(salesman);
  assert.equal(state.vehicles.length, 1);
  assert.equal(state.users.length, 1);
  assert.equal(state.invoices.length, 0);
  assert.equal(state.audit.length, 0);
  assert.equal(
    state.balances.filter((b) => b.locationType === "warehouse").length,
    0,
  );
});

test("reports reject, resubmit, exact approval, immutable snapshots, day seals, reopen and no inventory movement", async () => {
  const count = Number(
    (await query("SELECT COUNT(*) FROM sanket.stock_movements"))[0].count,
  );
  let preview = await previewReport(salesman, day(), vehicle);
  assert.equal(preview.lines[0].closing, 84);
  assert.equal(preview.lines[0].loaded, 288);
  assert.equal(preview.lines[0].sold - preview.lines[0].reversed, 204);
  const submitted = await call(salesman, "report.submit", {
    vehicleId: vehicle,
    day: day(),
    notes: "Synthetic report",
    expectedSourceHash: preview.sourceHash,
  });
  reportId = submitted.id!;
  await reject(
    call(salesman, "report.approve", { id: reportId, revision: 1 }),
    "FORBIDDEN",
  );
  await reject(
    call(salesman, "sale.create", { vehicleId: vehicle, lines: [line(1)] }),
    "DAY_SEALED",
  );
  await reject(getReportRevision(other, reportId), "FORBIDDEN");
  await call(owner, "report.reject", {
    id: reportId,
    revision: 1,
    reason: "Please verify quantities",
  });
  assert.equal(
    (await getReportRevision(salesman, reportId, 1)).status,
    "REJECTED",
  );
  preview = await previewReport(salesman, day(), vehicle);
  await call(salesman, "report.submit", {
    vehicleId: vehicle,
    day: day(),
    notes: "Verified",
    expectedSourceHash: preview.sourceHash,
  });
  await reject(
    call(owner, "report.approve", { id: reportId, revision: 1 }),
    "STALE_REVISION",
  );
  await call(owner, "report.approve", { id: reportId, revision: 2 });
  await call(owner, "report.approve", { id: reportId, revision: 2 });
  const approved = await getReportRevision(salesman, reportId, 2);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.lines[0].formatted, "7 Strips");
  assert.equal(approved.decidedBy, owner.name);
  assert.equal(
    Number(
      (await query("SELECT COUNT(*) FROM sanket.stock_movements"))[0].count,
    ),
    count,
  );
  await reject(
    query(
      "UPDATE sanket.report_revisions SET snapshot='{}' WHERE report_id=$1",
      [reportId],
    ),
    "P0001",
  );
  await call(owner, "report.reopen", {
    id: reportId,
    revision: 2,
    reason: "Owner requests fresh packaging review",
  });
  assert.equal(
    (await getReportRevision(owner, reportId, 2)).status,
    "REOPENED",
  );
});

test("packaging changes keep base balances and historical ratios; stale input rejected; refreshed report uses new version", async () => {
  await call(owner, "stock.adjust", {
    locationType: "vehicle",
    locationId: vehicle2,
    productId: product,
    delta: 350,
    reason: "Synthetic boundary stock",
  });
  assert.equal(await balance("vehicle", vehicle2), 350);
  assert.equal(
    formatQuantity(350, (await packagingHistory(owner, product))[0]),
    "2 Boxes + 5 Strips + 2 Pieces",
  );
  const old = pack;
  pack = (
    await call(owner, "packaging.save", {
      productId: product,
      baseUnit: "piece",
      levels: [
        { code: "box", label: "Boxes", factor: 100 },
        { code: "strip", label: "Strips", factor: 10 },
        { code: "piece", label: "Pieces", factor: 1 },
      ],
      reason: "Supplier changed pack size",
    })
  ).id!;
  assert.equal(await balance("vehicle", vehicle2), 350);
  assert.equal(
    formatQuantity(350, (await packagingHistory(owner, product))[0]),
    "3 Boxes + 5 Strips",
  );
  assert.equal(
    (await getReportRevision(owner, reportId, 2)).lines[0].levels[0].factor,
    144,
  );
  assert.equal(
    (await previewReport(salesman, day(), vehicle)).lines[0].levels[0].factor,
    100,
  );
  await reject(
    call(other, "sale.create", {
      vehicleId: vehicle2,
      lines: [line(1, "box", product, old)],
    }),
    "STALE_PACKAGING",
  );
  const history = await getState(owner);
  assert.equal(
    history.sales.find((s) => s.lines.length)?.lines[0].levels[0].factor,
    144,
  );
  await reject(
    call(owner, "packaging.save", {
      productId: product,
      baseUnit: "unit",
      levels: [{ code: "unit", label: "Units", factor: 1 }],
      reason: "Illegal change",
    }),
    "BASE_IMMUTABLE",
  );
});

test("competing sales, duplicate line aggregation, assignment/day conflicts, all-or-nothing and ledger reconciliation", async () => {
  const p = (
    await call(owner, "product.save", {
      name: "Synthetic Concurrency Product",
      category: "Test only",
      active: true,
      minStock: 0,
    })
  ).id!;
  const pk = (
    await call(owner, "packaging.save", {
      productId: p,
      baseUnit: "piece",
      levels: [{ code: "piece", label: "Pieces", factor: 1 }],
      reason: "Synthetic single unit",
    })
  ).id!;
  await call(owner, "stock.adjust", {
    locationType: "vehicle",
    locationId: vehicle2,
    productId: p,
    delta: 100,
    reason: "Synthetic concurrency stock",
  });
  const concurrent = await Promise.allSettled([
    call(other, "sale.create", {
      vehicleId: vehicle2,
      lines: [line(60, "piece", p, pk)],
    }),
    call(other, "sale.create", {
      vehicleId: vehicle2,
      lines: [line(60, "piece", p, pk)],
    }),
  ]);
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await balance("vehicle", vehicle2, p), 40);
  await reject(
    call(other, "sale.create", {
      vehicleId: vehicle2,
      lines: [line(21, "piece", p, pk), line(20, "piece", p, pk)],
    }),
    "INSUFFICIENT_STOCK",
  );
  const before = await balance("vehicle", vehicle2);
  await reject(
    call(other, "sale.create", {
      vehicleId: vehicle2,
      lines: [line(1), line(41, "piece", p, pk)],
    }),
    "INSUFFICIENT_STOCK",
  );
  assert.equal(await balance("vehicle", vehicle2), before);
  assert.equal(await balance("vehicle", vehicle2, p), 40);
  await reject(
    call(other, "sale.create", {
      vehicleId: vehicle2,
      assignmentId: randomUUID(),
      lines: [line(1)],
    }),
    "ASSIGNMENT_CHANGED",
  );
  await reject(
    call(other, "sale.create", {
      vehicleId: vehicle2,
      day: "2000-01-01",
      lines: [line(1)],
    }),
    "STALE_DAY",
  );
  const mismatch = await query(
    `SELECT b.* FROM sanket.stock_balances b LEFT JOIN (SELECT location_type,location_id,product_id,SUM(quantity) AS total FROM sanket.stock_movements GROUP BY location_type,location_id,product_id) m USING(location_type,location_id,product_id) WHERE b.quantity<>COALESCE(m.total,0)`,
  );
  assert.equal(mismatch.length, 0);
});

test("catalogue import preserves unresolved source values without stock and remains atomic", async () => {
  const source = {
    name: "Allu Bhumiya",
    category: "snaks",
    active: true,
    minStock: 0,
    price: "200.00",
    priceUnit: null,
    currency: "INR",
    rawImport: {
      Product: "Allu Bhumiya",
      Category: "snaks",
      Packaging: "1",
      Warehouse: "0",
      "Selling price": "200.00",
      "Min stock": "0",
      Status: "true",
    },
  };
  const key = randomUUID(),
    payload = { products: [source], importHash: "f".repeat(64) };
  const result = await call(owner, "product.import", payload, key);
  assert.deepEqual(await call(owner, "product.import", payload, key), result);
  const p = (await getState(owner)).products.find(
    (p) => p.name === "Allu Bhumiya",
  )!;
  assert.equal(p.ready, false);
  assert.equal(p.packaging, null);
  assert.equal(p.price, "200.00");
  assert.equal(p.priceUnit, null);
  assert.equal(p.rawImport?.Packaging, "1");
  assert.equal(await balance("warehouse", warehouse, p.id), 0);
  await reject(call(owner, "product.import", payload), "DUPLICATE_RECORD");
  await reject(
    call(owner, "product.import", {
      products: [{ ...source, name: "Must roll back" }, source],
      importHash: "e".repeat(64),
    }),
    "DUPLICATE_RECORD",
  );
  assert.equal(
    (await getState(owner)).products.some((p) => p.name === "Must roll back"),
    false,
  );
});

test("invalid invoice line, duplicate supplier number and review changes cannot partly post", async () => {
  const make = async (hash: string, number: string, lines: InvoiceLine[]) => {
    const id = (
      await call(owner, "invoice.create", {
        fileId: randomUUID(),
        fileName: `synthetic-${number}.pdf`,
        mime: "application/pdf",
        hash,
      })
    ).id!;
    await call(owner, "invoice.update", {
      id,
      revision: 1,
      supplier: "Synthetic Supplier",
      invoiceNumber: number,
      invoiceDate: day(),
      warehouseId: dewas,
      lines,
    });
    return id;
  };
  const good = {
    description: "Synthetic Chips",
    productId: product,
    packagingId: pack,
    unitCode: "box",
    invoiceQuantity: 1,
    receivedQuantity: 1,
    reason: "",
    evidence: "Synthetic line",
  };
  const bad = {
    ...good,
    description: "Unmatched line",
    productId: randomUUID(),
  };
  const invalid = await make("b".repeat(64), "SYN-INVALID", [good, bad]);
  await reject(
    call(owner, "invoice.ready", { id: invalid, revision: 2 }),
    "HISTORICAL_PACKAGING_REASON",
  );
  assert.equal(await balance("warehouse", dewas), 0);
  const changed = await make("c".repeat(64), "SYN-CHANGED", [good]);
  await call(owner, "invoice.ready", { id: changed, revision: 2 });
  await call(owner, "invoice.update", {
    id: changed,
    revision: 2,
    supplier: "Synthetic Supplier",
    invoiceNumber: "SYN-CHANGED",
    invoiceDate: day(),
    warehouseId: dewas,
    lines: [good],
  });
  await reject(
    call(owner, "invoice.approve", { id: changed, revision: 2 }),
    "STALE_REVISION",
  );
  await reject(
    call(owner, "invoice.approve", { id: changed, revision: 3 }),
    "INVOICE_NOT_READY",
  );
  assert.equal(await balance("warehouse", dewas), 0);
  await reject(make("d".repeat(64), "SYN-1", [good]), "DUPLICATE_RECORD");
});

test("concurrent approve and reject produce one decision; historical date seal does not seal tomorrow", async () => {
  const preview = await previewReport(salesman, day(), vehicle);
  const s = await call(salesman, "report.submit", {
    vehicleId: vehicle,
    day: day(),
    notes: "Final review",
    expectedSourceHash: preview.sourceHash,
  });
  const raced = await Promise.allSettled([
    call(owner, "report.approve", { id: s.id, revision: s.revision }),
    call(owner, "report.reject", {
      id: s.id,
      revision: s.revision,
      reason: "Concurrent alternative decision",
    }),
  ]);
  assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
  const saved = await getReportRevision(owner, s.id!, Number(s.revision));
  assert.ok(["APPROVED", "REJECTED"].includes(saved.status));
  // Synthetic fixtures deliberately move only test timestamps to exercise a later business date.
  await query("UPDATE sanket.daily_reports SET day=day-1 WHERE id=$1", [s.id]);
  await call(salesman, "sale.create", { vehicleId: vehicle, lines: [line(1)] });
  assert.equal(await balance("vehicle", vehicle), 83);
});

test("source hash review, ownership history, database snapshot immutability and deactivation enforcement", async () => {
  const preview = await previewReport(other, day(), vehicle2);
  await call(other, "sale.create", { vehicleId: vehicle2, lines: [line(1)] });
  await reject(
    call(other, "report.submit", {
      vehicleId: vehicle2,
      day: day(),
      notes: "Stale preview",
      expectedSourceHash: preview.sourceHash,
    }),
    "STALE_REPORT",
  );
  await reject(
    query("UPDATE sanket.packaging SET levels='[]' WHERE id=$1", [pack]),
    "P0001",
  );
  await reject(
    query(
      "DELETE FROM sanket.stock_movements WHERE id=(SELECT id FROM sanket.stock_movements LIMIT 1)",
    ),
    "P0001",
  );
  await call(owner, "assignment.save", {
    vehicleId: vehicle2,
    salesmanId: null,
    reason: "Synthetic end assignment",
  });
  await reject(
    call(other, "sale.create", { vehicleId: vehicle2, lines: [line(1)] }),
    "FORBIDDEN",
  );
  await query("UPDATE sanket.users SET active=false WHERE id=$1", [other.id]);
  await reject(getState(other), "SESSION_REVOKED");
  await query("UPDATE sanket.users SET active=true WHERE id=$1", [other.id]);
  const third: Actor = {
    id: randomUUID(),
    name: "Synthetic replacement salesman",
    username: "test", email: "replacement@domain.invalid",
    role: "salesman",
    active: true,
  };
  await query(
    "INSERT INTO sanket.users(id,name,email,role,active,password_hash) VALUES($1,$2,$3,$4,true,$5)",
    [third.id, third.name, third.email, third.role, "test-fixture-not-a-login"],
  );
  await call(owner, "assignment.save", {
    vehicleId: vehicle2,
    salesmanId: third.id,
    reason: "Synthetic replacement",
  });
  await reject(previewReport(third, day(), vehicle2), "OWNER_REPORT_REQUIRED");
});

test("receipt corrections remain linked, prevent negative godown stock after loading, preserve approved invoice", async () => {
  const invoice = (await getState(owner)).invoices.find(
    (i) => i.invoiceNumber === "SYN-1",
  )!;
  await reject(
    call(owner, "stock.adjust", {
      locationType: "warehouse",
      locationId: warehouse,
      productId: product,
      delta: -1,
      sourceInvoiceId: invoice.id,
      reason: "Synthetic shortage after loading",
    }),
    "INSUFFICIENT_STOCK",
  );
  assert.equal(await balance("warehouse", warehouse), 0);
  await reject(
    call(owner, "stock.adjust", {
      locationType: "warehouse",
      locationId: dewas,
      productId: product,
      delta: 1,
      sourceInvoiceId: invoice.id,
      reason: "Wrong godown correction",
    }),
    "RECEIPT_SCOPE",
  );
  const correction = await call(owner, "stock.adjust", {
    locationType: "warehouse",
    locationId: warehouse,
    productId: product,
    delta: 2,
    sourceInvoiceId: invoice.id,
    reason: "Synthetic extra goods discovered",
  });
  const doc = (
    await query(
      "SELECT source_invoice_id,source_document_id FROM sanket.stock_documents WHERE id=$1",
      [correction.id],
    )
  )[0];
  assert.equal(doc.source_invoice_id, invoice.id);
  assert.ok(doc.source_document_id);
  assert.equal(await balance("warehouse", warehouse), 2);
  await reject(
    query("UPDATE sanket.invoices SET invoice_number=$2 WHERE id=$1", [
      invoice.id,
      "tampered",
    ]),
    "P0001",
  );
  await reject(
    query("UPDATE sanket.stock_documents SET lines='[]' WHERE id=$1", [
      correction.id,
    ]),
    "P0001",
  );
});

test("paginated history applies role scoping and filters; reconciliation equations match ledger and saved report references", async () => {
  const { getHistory } = await import("../lib/domain/history");
  const { getWarehouseReconciliation } =
    await import("../lib/domain/reconciliation");
  const page = await getHistory(owner, {
    kind: "sales",
    page: 1,
    pageSize: 1,
    vehicleId: vehicle,
    productId: product,
    from: day(),
    to: day(),
  });
  assert.equal(page.items.length, 1);
  assert.ok(page.total > 1);
  assert.equal(page.hasMore, true);
  const second = await getHistory(owner, {
    kind: "sales",
    page: 2,
    pageSize: 1,
    vehicleId: vehicle,
  });
  assert.notDeepEqual(page.items, second.items);
  assert.equal(
    (await getHistory(salesman, { kind: "sales", vehicleId: vehicle2 })).total,
    0,
  );
  await reject(getHistory(salesman, { kind: "invoices" }), "FORBIDDEN");
  await reject(
    getHistory(owner, { kind: "sales", pageSize: 9999 }),
    "VALIDATION",
  );
  const stock = (await getWarehouseReconciliation(owner, day(), warehouse))[0];
  const chips = stock.lines.find((l) => l.productId === product)!;
  assert.equal(chips.opening, 0);
  assert.equal(chips.receipts, 288);
  assert.equal(chips.outgoing, 288);
  assert.equal(chips.adjustments, 2);
  assert.equal(chips.closing, 2);
  assert.equal(chips.equationBalances, true);
  assert.equal(chips.ledgerMatchesLive, true);
  await reject(
    getWarehouseReconciliation(salesman, day(), warehouse),
    "FORBIDDEN",
  );
  const saved = await getReportRevision(owner, reportId, 2);
  assert.ok(saved.transactionReferences!.some((t) => t.kind === "TRANSFER"));
  assert.ok(saved.transactionReferences!.some((t) => t.kind === "SALE"));
  assert.ok(saved.decisionHistory!.some((d) => d.decision === "APPROVED"));
  assert.ok(saved.decisionHistory!.some((d) => d.decision === "REOPENED"));
  assert.equal(saved.approval?.actor, owner.name);
});

test("outbox cancellation tombstones exclude late posting and resolve cancellation-versus-sale races", async () => {
  const { lookupSaleRequest, cancelSaleRequest } =
    await import("../lib/domain/requests");
  const payload = { vehicleId: vehicle, lines: [line(1)] },
    key = randomUUID();
  const before = await balance("vehicle", vehicle);
  assert.equal((await lookupSaleRequest(salesman, key)).state, "NOT_FOUND");
  assert.equal(
    (await cancelSaleRequest(salesman, key, payload)).state,
    "CANCELLED",
  );
  assert.equal((await lookupSaleRequest(salesman, key)).state, "CANCELLED");
  await reject(
    call(salesman, "sale.create", payload, key),
    "REQUEST_CANCELLED",
  );
  assert.equal(await balance("vehicle", vehicle), before);
  await reject(
    cancelSaleRequest(salesman, key, { ...payload, notes: "Changed" }),
    "IDEMPOTENCY_CONFLICT",
  );
  assert.equal((await lookupSaleRequest(owner, key)).state, "NOT_FOUND");
  const raceKey = randomUUID();
  const raced = await Promise.allSettled([
    call(salesman, "sale.create", payload, raceKey),
    cancelSaleRequest(salesman, raceKey, payload),
  ]);
  const state = await lookupSaleRequest(salesman, raceKey);
  assert.ok(["CONFIRMED", "CANCELLED"].includes(state.state));
  assert.equal(
    await balance("vehicle", vehicle),
    state.state === "CONFIRMED" ? before - 1 : before,
  );
  assert.equal(raced[1].status, "fulfilled");
  if (state.state === "CONFIRMED")
    assert.equal(
      (await cancelSaleRequest(salesman, raceKey, payload)).state,
      "CONFIRMED",
    );
  else
    await reject(
      call(salesman, "sale.create", payload, raceKey),
      "REQUEST_CANCELLED",
    );
});

test("business-date opening plus multiple loads reconciles and next-day owner corrections preserve the approved as-of closing", async (t) => {
  const worker: Actor = {
    id: randomUUID(),
    name: "Synthetic date worker",
    username: "test", email: "date@domain.invalid",
    role: "salesman",
    active: true,
  };
  await query(
    "INSERT INTO sanket.users(id,name,email,role,active,password_hash) VALUES($1,$2,$3,$4,true,$5)",
    [
      worker.id,
      worker.name,
      worker.email,
      worker.role,
      "test-fixture-not-a-login",
    ],
  );
  const van = (
    await call(owner, "vehicle.save", {
      name: "Synthetic date vehicle",
      warehouseId: warehouse,
      active: true,
    })
  ).id!;
  await call(owner, "assignment.save", {
    vehicleId: van,
    salesmanId: worker.id,
  });
  await query(
    "UPDATE sanket.assignments SET starts_at=now()-interval '2 days' WHERE vehicle_id=$1",
    [van],
  );
  const p = (
    await call(owner, "product.save", {
      name: "Synthetic day reconciliation product",
      category: "Test only",
      active: true,
      minStock: 0,
    })
  ).id!;
  const pk = (
    await call(owner, "packaging.save", {
      productId: p,
      baseUnit: "piece",
      levels: [
        { code: "box", label: "Boxes", factor: 144 },
        { code: "strip", label: "Strips", factor: 12 },
        { code: "piece", label: "Pieces", factor: 1 },
      ],
      reason: "Synthetic dates fixture",
    })
  ).id!;
  const originalNow = Date.now(),
    originalDay = day();
  t.mock.timers.enable({ apis: ["Date"], now: originalNow - 86400000 });
  try {
    await call(owner, "stock.adjust", {
      locationType: "vehicle",
      locationId: van,
      productId: p,
      delta: 60,
      reason: "Synthetic previous day carry",
    });
  } finally {
    t.mock.timers.reset();
  }
  await call(owner, "stock.receive", {
    warehouseId: warehouse,
    kind: "MANUAL_RECEIPT",
    lines: [line(24, "strip", p, pk)],
    notes: "Synthetic loading stock",
    reference: "SYN-DAY-LOADING-STOCK",
  });
  await call(owner, "transfer.create", {
    warehouseId: warehouse,
    vehicleId: van,
    lines: [line(12, "strip", p, pk)],
  });
  await call(owner, "transfer.create", {
    warehouseId: warehouse,
    vehicleId: van,
    lines: [line(12, "strip", p, pk)],
  });
  const sale = await call(worker, "sale.create", {
    vehicleId: van,
    lines: [line(18, "strip", p, pk)],
  });
  const preview = await previewReport(worker, originalDay, van);
  const r = preview.lines.find((l) => l.productId === p)!;
  assert.equal(r.opening, 60);
  assert.equal(r.loaded, 288);
  assert.equal(r.sold, 216);
  assert.equal(r.closing, 132);
  assert.equal(r.formatted, "11 Strips");
  const submitted = await call(worker, "report.submit", {
    vehicleId: van,
    day: originalDay,
    notes: "Five strips plus 24 loaded less 18 sold",
    expectedSourceHash: preview.sourceHash,
  });
  await call(owner, "report.approve", {
    id: submitted.id,
    revision: submitted.revision,
  });
  t.mock.timers.enable({ apis: ["Date"], now: originalNow + 86400000 });
  try {
    await reject(
      call(worker, "sale.correct", {
        saleId: sale.id,
        lines: [line(17, "strip", p, pk)],
        reason: "Older date correction",
      }),
      "FORBIDDEN",
    );
    await call(owner, "sale.correct", {
      saleId: sale.id,
      lines: [line(17, "strip", p, pk)],
      reason: "Owner authorizes later quantity amendment",
    });
    assert.equal(await balance("vehicle", van, p), 144);
    const saved = await getReportRevision(
      worker,
      submitted.id!,
      Number(submitted.revision),
    );
    assert.equal(saved.status, "APPROVED");
    assert.equal(saved.lines[0].closing, 132);
    const asOf = await previewReport(owner, originalDay, van);
    assert.equal(asOf.lines[0].closing, 132);
    assert.equal(asOf.amendments?.length, 1);
    const next = await previewReport(worker, day(), van);
    assert.equal(next.lines[0].opening, 132);
    assert.equal(next.lines[0].closing, 144);
  } finally {
    t.mock.timers.reset();
  }
});

test("vehicle relocation cannot silently move stock and past sales retain original home godown", async () => {
  await reject(
    call(owner, "vehicle.save", {
      id: vehicle,
      name: "Hardpiplya Vehicle 1",
      warehouseId: dewas,
      active: true,
    }),
    "VEHICLE_HAS_STOCK",
  );
  const rows = (await getState(owner)).sales.filter(
    (s) => s.vehicleId === vehicle,
  );
  assert.ok(rows.length > 0);
  assert.ok(rows.every((s) => s.warehouseId === warehouse));
  await reject(
    call(owner, "stock.adjust", {
      locationType: "warehouse",
      locationId: warehouse,
      productId: product,
      delta: 1,
      day: "2000-01-01",
      reason: "Cannot backdate adjustment",
    }),
    "STALE_DAY",
  );
  await reject(
    call(owner, "product.save", {
      name: "Invalid price precision",
      category: "Test only",
      price: 0.001,
      minStock: 0,
      active: true,
    }),
    "VALIDATION",
  );
});

test("delivery references prevent manual/invoice double receipt in either sequence with normalized warehouse-scoped matching", async () => {
  const initialWarehouse = await balance("warehouse", warehouse),
    initialDewas = await balance("warehouse", dewas);
  const payload = {
    warehouseId: warehouse,
    kind: "MANUAL_RECEIPT",
    lines: [line(2)],
    notes: "Synthetic unique delivery",
    reference: "  Delivery   Reference  42  ",
  };
  const key = randomUUID();
  const first = await call(owner, "stock.receive", payload, key);
  assert.equal(await balance("warehouse", warehouse), initialWarehouse + 2);
  assert.deepEqual(await call(owner, "stock.receive", payload, key), first);
  assert.equal(await balance("warehouse", warehouse), initialWarehouse + 2);
  await reject(
    call(owner, "stock.receive", {
      ...payload,
      reference: "delivery reference 42",
    }),
    "DUPLICATE_DELIVERY",
  );
  assert.equal(await balance("warehouse", warehouse), initialWarehouse + 2);
  await call(owner, "stock.receive", {
    ...payload,
    warehouseId: dewas,
    reference: "DELIVERY REFERENCE 42",
  });
  assert.equal(await balance("warehouse", dewas), initialDewas + 2);
  const { reference: omitted, ...missing } = payload;
  void omitted;
  await reject(call(owner, "stock.receive", missing), "VALIDATION");
  const make = async (number: string, hash: string) => {
    const id = (
      await call(owner, "invoice.create", {
        fileId: randomUUID(),
        fileName: `${number}.pdf`,
        mime: "application/pdf",
        hash,
      })
    ).id!;
    await call(owner, "invoice.update", {
      id,
      revision: 1,
      supplier: "Synthetic Duplicate Delivery Supplier",
      invoiceNumber: number,
      invoiceDate: day(),
      warehouseId: warehouse,
      lines: [
        {
          description: "Synthetic Chips",
          productId: product,
          packagingId: pack,
          unitCode: "piece",
          invoiceQuantity: 3,
          receivedQuantity: 3,
          reason: "",
          evidence: "Synthetic evidence",
        },
      ],
    });
    await call(owner, "invoice.ready", { id, revision: 2 });
    return id;
  };
  const manualFirst = await make("delivery reference 42", "1".repeat(64));
  await reject(
    call(owner, "invoice.approve", { id: manualFirst, revision: 2 }),
    "DUPLICATE_DELIVERY",
  );
  assert.equal(await balance("warehouse", warehouse), initialWarehouse + 2);
  const invoiceFirst = await make("INVOICE  SECOND   43", "2".repeat(64));
  const approved = await call(owner, "invoice.approve", {
    id: invoiceFirst,
    revision: 2,
  });
  assert.equal(await balance("warehouse", warehouse), initialWarehouse + 5);
  await reject(
    call(owner, "stock.receive", {
      ...payload,
      reference: "invoice second 43",
    }),
    "DUPLICATE_DELIVERY",
  );
  await reject(
    call(owner, "stock.receive", {
      ...payload,
      reference: approved.reference!.toLowerCase(),
    }),
    "DUPLICATE_DELIVERY",
  );
  assert.equal(await balance("warehouse", warehouse), initialWarehouse + 5);
  const race = await Promise.allSettled([
    call(owner, "stock.receive", {
      ...payload,
      reference: "Concurrent delivery",
    }),
    call(owner, "stock.receive", {
      ...payload,
      reference: " concurrent   DELIVERY ",
    }),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await balance("warehouse", warehouse), initialWarehouse + 7);
});

test("invoice and audit text search filters the entire result set before pagination and treats wildcards literally", async () => {
  const { getHistory } = await import("../lib/domain/history");
  for (let i = 0; i < 3; i++)
    await call(owner, "invoice.create", {
      fileId: randomUUID(),
      fileName: `Search Needle 100%_proof ${i}.pdf`,
      mime: "application/pdf",
      hash: String(3 + i).repeat(64),
    });
  await call(owner, "invoice.create", {
    fileId: randomUUID(),
    fileName: "Unrelated newest file.pdf",
    mime: "application/pdf",
    hash: "6".repeat(64),
  });
  const page = await getHistory(owner, {
    kind: "invoices",
    search: " needle 100%_proof ",
    page: 1,
    pageSize: 1,
  });
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 1);
  assert.equal(page.hasMore, true);
  const second = await getHistory(owner, {
    kind: "invoices",
    search: "NEEDLE 100%_proof",
    page: 2,
    pageSize: 1,
  });
  assert.equal(second.total, 3);
  assert.notDeepEqual(page.items, second.items);
  const literal = await getHistory(owner, {
    kind: "invoices",
    search: "%",
    pageSize: 200,
  });
  assert.equal(literal.total, 3);
  const audits = await getHistory(owner, {
    kind: "audit",
    search: "100%_proof",
    page: 1,
    pageSize: 1,
  });
  assert.equal(audits.total, 3);
  assert.equal(audits.hasMore, true);
  await reject(
    getHistory(salesman, { kind: "audit", search: "needle" }),
    "FORBIDDEN",
  );
});

test("saved report identity survives business, godown and location renaming", async () => {
  const originalSettings = (await getState(owner)).settings;
  const locationId = (
    await call(owner, "location.save", { name: "Snapshot Town" })
  ).id!;
  const warehouseId = (
    await call(owner, "warehouse.save", { name: "Snapshot Godown", locationId })
  ).id!;
  const vehicleId = (
    await call(owner, "vehicle.save", { name: "Snapshot Van", warehouseId })
  ).id!;
  const preview = await previewReport(owner, day(), vehicleId);
  assert.equal(preview.businessName, originalSettings.businessName);
  assert.equal(preview.warehouseName, "Snapshot Godown");
  assert.equal(preview.locationName, "Snapshot Town");
  assert.equal(preview.timezone, "Asia/Kolkata");
  const submitted = await call(owner, "report.submit", {
    vehicleId,
    day: day(),
    notes: "Verify saved identity",
    expectedSourceHash: preview.sourceHash,
  });
  await call(owner, "report.approve", {
    id: submitted.id,
    revision: submitted.revision,
  });
  try {
    await call(owner, "settings.save", {
      ...originalSettings,
      businessName: "Renamed Business",
    });
    await call(owner, "location.save", {
      id: locationId,
      name: "Renamed Town",
    });
    await call(owner, "warehouse.save", {
      id: warehouseId,
      locationId,
      name: "Renamed Godown",
    });
    const saved = await getReportRevision(
      owner,
      submitted.id!,
      Number(submitted.revision),
    );
    assert.equal(saved.businessName, originalSettings.businessName);
    assert.equal(saved.warehouseId, warehouseId);
    assert.equal(saved.warehouseName, "Snapshot Godown");
    assert.equal(saved.locationId, locationId);
    assert.equal(saved.locationName, "Snapshot Town");
    assert.equal(saved.timezone, "Asia/Kolkata");
    const current = await previewReport(owner, day(), vehicleId);
    assert.equal(current.businessName, "Renamed Business");
    assert.equal(current.warehouseName, "Renamed Godown");
    assert.equal(current.locationName, "Renamed Town");
  } finally {
    await call(owner, "settings.save", originalSettings);
  }
});

test("packaging activation explicitly resolves the price unit atomically without changing stock", async () => {
  const id = (
    await call(owner, "product.save", {
      name: "Price basis regression",
      category: "Test",
      price: "0.00",
      priceUnit: "20",
      currency: "INR",
    })
  ).id!;
  const data = {
    productId: id,
    baseUnit: "PIECE",
    levels: [
      { code: "BOX", label: "Box", factor: 24 },
      { code: "PIECE", label: "Piece", factor: 1 },
    ],
    reason: "Confirm price unit",
  };
  await reject(call(owner, "packaging.save", data), "PRICE_UNIT");
  await reject(
    call(owner, "packaging.save", {
      ...data,
      priceBasis: { price: "20.00", unitCode: "MISSING", currency: "INR" },
    }),
    "PRICE_UNIT",
  );
  let current = (await getState(owner)).products.find((p) => p.id === id)!;
  assert.equal(current.priceUnit, "20");
  assert.equal(current.packaging, null);
  assert.equal(Number(current.price), 0);
  const key = randomUUID();
  const result = await call(
    owner,
    "packaging.save",
    {
      ...data,
      priceBasis: { price: "20.00", unitCode: "BOX", currency: "INR" },
    },
    key,
  );
  assert.deepEqual(
    await call(
      owner,
      "packaging.save",
      {
        ...data,
        priceBasis: { price: "20.00", unitCode: "BOX", currency: "INR" },
      },
      key,
    ),
    result,
  );
  current = (await getState(owner)).products.find((p) => p.id === id)!;
  assert.equal(current.priceUnit, "BOX");
  assert.equal(Number(current.price), 20);
  assert.equal(current.packaging?.version, 1);
  assert.equal(
    (await getState(owner)).balances.filter((b) => b.productId === id).length,
    0,
  );
  await reject(
    call(salesman, "packaging.save", {
      ...data,
      priceBasis: { price: "10", unitCode: "PIECE", currency: "INR" },
    }),
    "FORBIDDEN",
  );
});

test("approved partial/full returns, held stock, allocations, discrepancies and concurrent retries preserve both ledgers", async () => {
  const { getWarehouseStock } = await import("../lib/domain/stock-requests");
  const worker: Actor = {
    id: randomUUID(),
    name: "Return Fixture Salesman",
    username: "test", email: "returns@domain.invalid",
    role: "salesman",
    active: true,
  };
  await query(
    "INSERT INTO sanket.users(id,name,email,role,password_hash) VALUES($1,$2,$3,$4,'fixture')",
    [worker.id, worker.name, worker.email, worker.role],
  );
  const loc = (
    await call(owner, "location.save", { name: "Returns Test Town" })
  ).id!;
  const wh = (
    await call(owner, "warehouse.save", {
      name: "Returns Test Warehouse",
      locationId: loc,
    })
  ).id!;
  const van = (
    await call(owner, "vehicle.save", {
      name: "Returns Test Vehicle",
      warehouseId: wh,
    })
  ).id!;
  const assignment = (
    await call(owner, "assignment.save", {
      vehicleId: van,
      salesmanId: worker.id,
    })
  ).id!;
  const p = (
    await call(owner, "product.save", {
      name: "Returns Product",
      category: "Test",
      price: "12.00",
      priceUnit: "box",
    })
  ).id!;
  const pk = (
    await call(owner, "packaging.save", {
      productId: p,
      baseUnit: "piece",
      levels: [
        { code: "box", label: "Box", factor: 12 },
        { code: "piece", label: "Piece", factor: 1 },
      ],
      reason: "Test units",
    })
  ).id!;
  const l = (quantity: number) => line(quantity, "piece", p, pk);
  await call(owner, "stock.receive", {
    warehouseId: wh,
    kind: "MANUAL_RECEIPT",
    reference: randomUUID(),
    notes: "Fixture stock",
    lines: [l(100)],
  });
  await call(owner, "transfer.create", {
    warehouseId: wh,
    vehicleId: van,
    assignmentId: assignment,
    lines: [l(40)],
  });
  const payload = (kind: string, qty = 0) => ({
    kind,
    vehicleId: van,
    assignmentId: assignment,
    lines: qty ? [l(qty)] : [],
    reason: "Physical stock reviewed",
  });
  const beforeMoves = Number(
    (await query("SELECT count(*) FROM sanket.stock_movements"))[0].count,
  );
  const hold = await call(worker, "inventory-request.create", payload("HOLD"));
  assert.equal(
    Number(
      (await query("SELECT count(*) FROM sanket.stock_movements"))[0].count,
    ),
    beforeMoves,
  );
  assert.equal(
    (await getWarehouseStock(worker, van)).requests.find(
      (r) => r.id === hold.id,
    )?.status,
    "COMPLETED",
  );
  const key = randomUUID();
  const [a, b] = await Promise.all([
    call(worker, "inventory-request.create", payload("RETURN", 25), key),
    call(worker, "inventory-request.create", payload("RETURN", 25), key),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(await balance("vehicle", van, p), 40);
  assert.equal(await balance("warehouse", wh, p), 60);
  await reject(
    call(worker, "inventory-request.approve", {
      id: a.id,
      reason: "Not an owner",
    }),
    "FORBIDDEN",
  );
  await reject(
    call(other, "inventory-request.create", payload("RETURN", 1)),
    "FORBIDDEN",
  );
  await reject(getWarehouseStock(other, van), "FORBIDDEN");
  const approveKey = randomUUID();
  const decisions = await Promise.all([
    call(
      owner,
      "inventory-request.approve",
      { id: a.id, reason: "Unloaded verified" },
      approveKey,
    ),
    call(
      owner,
      "inventory-request.approve",
      { id: a.id, reason: "Unloaded verified" },
      approveKey,
    ),
  ]);
  assert.equal(decisions[0].documentId, decisions[1].documentId);
  assert.equal(await balance("vehicle", van, p), 15);
  assert.equal(await balance("warehouse", wh, p), 85);
  await reject(
    call(owner, "inventory-request.approve", {
      id: a.id,
      reason: "Duplicate confirmation",
    }),
    "ALREADY_DECIDED",
  );
  const stock = await getWarehouseStock(worker, van);
  assert.equal(stock.rows.find((r) => r.productId === p)?.available, 85);
  assert.equal(stock.rows.find((r) => r.productId === p)?.allocated, 15);
  assert.equal(stock.rows.find((r) => r.productId === p)?.total, 100);
  assert.ok(stock.rows.every((r) => r.warehouseId === wh));
  assert.equal(
    stock.requests
      .find((r) => r.id === a.id)
      ?.completionStock?.find((r) => r.productId === p)?.quantity,
    15,
  );
  const rejected = await call(
    worker,
    "inventory-request.create",
    payload("ALLOCATION", 5),
  );
  await call(owner, "inventory-request.reject", {
    id: rejected.id,
    reason: "Not needed today",
  });
  assert.equal(await balance("vehicle", van, p), 15);
  const full = await call(
    worker,
    "inventory-request.create",
    payload("RETURN", 15),
  );
  await call(owner, "inventory-request.approve", {
    id: full.id,
    reason: "All remaining stock counted",
  });
  assert.equal(await balance("vehicle", van, p), 0);
  assert.equal(await balance("warehouse", wh, p), 100);
  await reject(
    call(worker, "inventory-request.create", payload("RETURN", 1)),
    "INSUFFICIENT_STOCK",
  );
  await reject(
    call(worker, "inventory-request.create", payload("ALLOCATION", 101)),
    "INSUFFICIENT_STOCK",
  );
  const r1 = await call(
    worker,
    "inventory-request.create",
    payload("ALLOCATION", 70),
  );
  const r2 = await call(
    worker,
    "inventory-request.create",
    payload("ALLOCATION", 70),
  );
  const race = await Promise.allSettled(
    [r1, r2].map((r) =>
      call(owner, "inventory-request.approve", {
        id: r.id,
        reason: "Load checked",
      }),
    ),
  );
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await balance("warehouse", wh, p), 30);
  assert.equal(await balance("vehicle", van, p), 70);
  const adjustment = await call(worker, "inventory-request.create", {
    ...payload("ADJUSTMENT"),
    productId: p,
    packagingId: pk,
    delta: -2,
  });
  await call(owner, "inventory-request.approve", {
    id: adjustment.id,
    reason: "Two damaged pieces counted",
  });
  assert.equal(await balance("vehicle", van, p), 68);
  const stale = await call(
    worker,
    "inventory-request.create",
    payload("RETURN", 1),
  );
  await call(owner, "assignment.save", {
    vehicleId: van,
    salesmanId: null,
    reason: "End assignment",
  });
  await reject(
    call(owner, "inventory-request.approve", {
      id: stale.id,
      reason: "Stale assignment",
    }),
    "ASSIGNMENT_CHANGED",
  );
  const history = await getWarehouseStock(worker);
  assert.equal(history.rows.length, 0);
  assert.ok(history.requests.some((r) => r.id === stale.id));
  await call(owner, "inventory-request.reject", {
    id: stale.id,
    reason: "Assignment ended",
  });
  const assignment2 = (
    await call(owner, "assignment.save", {
      vehicleId: van,
      salesmanId: worker.id,
    })
  ).id!;
  const pending = await call(worker, "inventory-request.create", {
    ...payload("RETURN", 1),
    assignmentId: assignment2,
  });
  const preview = await previewReport(owner, day(), van);
  const submitted = await call(owner, "report.submit", {
    vehicleId: van,
    day: day(),
    expectedSourceHash: preview.sourceHash,
    notes: "Seal date test",
  });
  await reject(
    call(owner, "inventory-request.approve", {
      id: pending.id,
      reason: "Sealed date",
    }),
    "DAY_SEALED",
  );
  await call(owner, "report.approve", {
    id: submitted.id,
    revision: submitted.revision,
  });
  await call(owner, "report.reopen", {
    id: submitted.id,
    revision: submitted.revision,
    reason: "Resolve pending unload",
  });
  await call(owner, "inventory-request.approve", {
    id: pending.id,
    reason: "Reopened date unload",
  });
  const afterReport = await previewReport(owner, day(), van);
  assert.equal(afterReport.lines.find((l) => l.productId === p)?.closing, 67);
  const { getWarehouseReconciliation } =
    await import("../lib/domain/reconciliation");
  const reconciliation = await getWarehouseReconciliation(owner, day(), wh);
  assert.equal(
    reconciliation[0].lines.find((l) => l.productId === p)?.equationBalances,
    true,
  );
  assert.equal(
    reconciliation[0].lines.find((l) => l.productId === p)?.ledgerMatchesLive,
    true,
  );
  assert.equal(
    reconciliation[0].lines.find((l) => l.productId === p)?.returns,
    41,
  );
  await assert.rejects(
    query("UPDATE sanket.stock_requests SET reason='rewritten' WHERE id=$1", [
      a.id,
    ]),
    /immutable/,
  );
});

test("sales invoice snapshots use confirmed price units, immutable customer data and read-only authorized reprints", async () => {
  const { getSalesInvoice, lineAmount } =
    await import("../lib/domain/sales-invoices");
  assert.equal(lineAmount("1.00", 1, 3), "0.33");
  assert.equal(lineAmount("0.01", 1, 2), "0.01");
  const worker: Actor = {
    id: randomUUID(),
    name: "Invoice Fixture Worker",
    username: "test", email: "invoice-fixture@domain.invalid",
    role: "salesman",
    active: true,
  };
  await query(
    "INSERT INTO sanket.users(id,name,email,role,password_hash) VALUES($1,$2,$3,$4,'fixture')",
    [worker.id, worker.name, worker.email, worker.role],
  );
  const wh = warehouse;
  const van = (
    await call(owner, "vehicle.save", {
      name: "Invoice Fixture Van",
      warehouseId: wh,
    })
  ).id!;
  const assignment = (
    await call(owner, "assignment.save", {
      vehicleId: van,
      salesmanId: worker.id,
    })
  ).id!;
  const p = (
    await call(owner, "product.save", {
      name: "Priced Invoice Fixture",
      category: "Test",
      price: "25.00",
      priceUnit: "box",
    })
  ).id!;
  const pk = (
    await call(owner, "packaging.save", {
      productId: p,
      baseUnit: "piece",
      levels: [
        { code: "box", label: "Box", factor: 12 },
        { code: "piece", label: "Piece", factor: 1 },
      ],
      reason: "Price units",
    })
  ).id!;
  const l = (n: number) => line(n, "piece", p, pk);
  await call(owner, "stock.receive", {
    warehouseId: wh,
    kind: "MANUAL_RECEIPT",
    reference: randomUUID(),
    notes: "Invoice fixture",
    lines: [l(30)],
  });
  await call(owner, "transfer.create", {
    warehouseId: wh,
    vehicleId: van,
    assignmentId: assignment,
    lines: [l(30)],
  });
  const saleData = {
    vehicleId: van,
    assignmentId: assignment,
    lines: [l(5)],
    customer: {
      name: "Fixture Customer",
      phone: "123",
      address: "Example",
      gstin: "",
    },
  };
  const key = randomUUID();
  const first = await call(worker, "sale.create", saleData, key),
    replay = await call(worker, "sale.create", saleData, key);
  assert.equal(first.id, replay.id);
  assert.equal(await balance("vehicle", van, p), 25);
  const invoice = await getSalesInvoice(worker, first.id!);
  assert.equal(invoice.lines[0].total, "10.42");
  assert.equal(invoice.lines[0].priceUnit, "box");
  assert.equal(invoice.customer.name, "Fixture Customer");
  assert.equal(invoice.completePricing, true);
  const count = Number(
    (await query("SELECT count(*) FROM sanket.stock_movements"))[0].count,
  );
  await getSalesInvoice(worker, first.id!);
  await getSalesInvoice(owner, first.id!);
  assert.equal(
    Number(
      (await query("SELECT count(*) FROM sanket.stock_movements"))[0].count,
    ),
    count,
  );
  await reject(getSalesInvoice(other, first.id!), "NOT_FOUND");
  await call(owner, "product.save", {
    id: p,
    name: "Renamed Invoice Fixture",
    category: "Test",
    price: "99.00",
    priceUnit: "box",
  });
  assert.deepEqual(await getSalesInvoice(worker, first.id!), invoice);
  const { getHistory } = await import("../lib/domain/history");
  assert.equal(
    (await getHistory(worker, { kind: "sales", search: invoice.invoiceNumber }))
      .total,
    1,
  );
  assert.equal(
    (await getHistory(worker, { kind: "sales", search: "Fixture Customer" }))
      .total,
    1,
  );
  assert.equal(
    (await getHistory(other, { kind: "sales", search: invoice.invoiceNumber }))
      .total,
    0,
  );
  await assert.rejects(
    query("UPDATE sanket.sales_invoices SET snapshot='{}' WHERE sale_id=$1", [
      first.id,
    ]),
    /Immutable/,
  );
  const corrected = await call(worker, "sale.correct", {
    saleId: first.id,
    assignmentId: assignment,
    lines: [l(3)],
    reason: "Correct quantity",
  });
  assert.equal((await getSalesInvoice(worker, first.id!)).status, "CORRECTED");
  assert.equal(
    (await getSalesInvoice(worker, first.id!)).replacedById,
    corrected.id,
  );
  assert.equal(await balance("vehicle", van, p), 27);
  assert.equal(
    (await getSalesInvoice(worker, corrected.id!)).customer.name,
    "Fixture Customer",
  );
  await call(owner, "product.save", {
    id: p,
    name: "Unpriced Invoice Fixture",
    category: "Test",
    price: null,
  });
  const unpriced = await call(worker, "sale.create", {
    vehicleId: van,
    assignmentId: assignment,
    lines: [l(1)],
  });
  assert.equal(
    (await getSalesInvoice(worker, unpriced.id!)).completePricing,
    false,
  );
  assert.equal(
    (await getSalesInvoice(worker, unpriced.id!)).lines[0].total,
    null,
  );
});

test("pending returns recheck sold stock, changed packaging and discontinued products without partial posting", async () => {
  const { getWarehouseStock } = await import("../lib/domain/stock-requests");
  const state = await getState(owner);
  const worker = state.users.find((u) => u.email === "returns@domain.invalid")!;
  const van = state.vehicles.find((v) => v.name === "Returns Test Vehicle")!;
  const assignment = state.assignments.find(
    (a) => a.vehicleId === van.id && !a.to,
  )!;
  const p = state.products.find((p) => p.name === "Returns Product")!;
  const l = (n: number) => line(n, "piece", p.id, p.packaging!.id);
  const request = (n: number) => ({
    kind: "RETURN",
    vehicleId: van.id,
    assignmentId: assignment.id,
    lines: [l(n)],
    reason: "Verify actual unloading",
  });
  const pending = await call(worker, "inventory-request.create", request(60));
  await call(worker, "sale.create", {
    vehicleId: van.id,
    assignmentId: assignment.id,
    lines: [l(10)],
  });
  const before = await balance("warehouse", van.warehouseId, p.id);
  const docCount = Number(
    (await query("SELECT count(*) FROM sanket.stock_documents"))[0].count,
  );
  await reject(
    call(owner, "inventory-request.approve", {
      id: pending.id,
      reason: "Cannot unload sold quantities",
    }),
    "INSUFFICIENT_STOCK",
  );
  assert.equal(await balance("warehouse", van.warehouseId, p.id), before);
  assert.equal(await balance("vehicle", van.id, p.id), 57);
  assert.equal(
    Number(
      (await query("SELECT count(*) FROM sanket.stock_documents"))[0].count,
    ),
    docCount,
  );
  assert.equal(
    (await getWarehouseStock(worker, van.id)).requests.find(
      (r) => r.id === pending.id,
    )?.status,
    "PENDING",
  );
  await call(owner, "inventory-request.reject", {
    id: pending.id,
    reason: "Quantity changed after sale",
  });
  const stale = await call(worker, "inventory-request.create", request(1));
  await call(owner, "packaging.save", {
    productId: p.id,
    baseUnit: "piece",
    levels: [
      { code: "box", label: "Box", factor: 24 },
      { code: "piece", label: "Piece", factor: 1 },
    ],
    reason: "Changed box configuration",
  });
  await reject(
    call(owner, "inventory-request.approve", {
      id: stale.id,
      reason: "Old packaging request",
    }),
    "STALE_PACKAGING",
  );
  await call(owner, "inventory-request.reject", {
    id: stale.id,
    reason: "Review with current packaging",
  });
  const refreshed = (await getState(owner)).products.find(
    (x) => x.id === p.id,
  )!;
  const inactive = await call(worker, "inventory-request.create", {
    ...request(1),
    lines: [line(1, "piece", p.id, refreshed.packaging!.id)],
  });
  await call(owner, "product.save", {
    id: p.id,
    name: p.name,
    category: p.category,
    active: false,
  });
  await reject(
    call(owner, "inventory-request.approve", {
      id: inactive.id,
      reason: "Discontinued stock",
    }),
    "PRODUCT_NOT_READY",
  );
  assert.equal(await balance("vehicle", van.id, p.id), 57);
});

test("legacy invoice retrieval preserves original quantities and never invents historical prices", async () => {
  const { transaction } = await import("../lib/server/database");
  const { createDocument, move } = await import("../lib/domain/common");
  const { getSalesInvoice } = await import("../lib/domain/sales-invoices");
  const state = await getState(owner);
  const worker = state.users.find(
    (u) => u.email === "invoice-fixture@domain.invalid",
  )!;
  const van = state.vehicles.find((v) => v.name === "Invoice Fixture Van")!;
  const assignment = state.assignments.find(
    (a) => a.vehicleId === van.id && !a.to,
  )!;
  const p = state.products.find((p) => p.name === "Unpriced Invoice Fixture")!;
  // Fixture reproduces pre-enhancement sale posting, without a sales-invoice snapshot.
  const legacy = await transaction(async (db) => {
    const doc = await createDocument(db, worker, {
      kind: "SALE",
      warehouseId: van.warehouseId,
      vehicleId: van.id,
      salesmanId: worker.id,
      salesmanName: worker.name,
      assignmentId: assignment.id,
      day: day(),
      lines: [
        {
          ...line(1, "piece", p.id, p.packaging!.id),
          productName: p.name,
          baseQuantity: 1,
          baseUnit: "piece",
          levels: p.packaging!.levels,
        },
      ],
    });
    await move(db, worker, doc, [
      {
        productId: p.id,
        quantity: -1,
        locationType: "vehicle",
        locationId: van.id,
        kind: "SALE",
      },
    ]);
    return doc;
  });
  await call(owner, "product.save", {
    id: p.id,
    name: "Price added later",
    category: p.category,
    price: "999.00",
    priceUnit: "box",
  });
  const snapshot = await getSalesInvoice(worker, legacy.id);
  assert.equal(snapshot.historical, true);
  assert.equal(snapshot.lines[0].quantity, 1);
  assert.equal(snapshot.lines[0].price, null);
  const { getHistory } = await import("../lib/domain/history");
  assert.equal(
    (
      await getHistory(worker, {
        kind: "sales",
        search: snapshot.invoiceNumber,
      })
    ).total,
    1,
  );
  assert.equal(
    (
      await query(
        "SELECT count(*) FROM sanket.sales_invoices WHERE sale_id=$1",
        [legacy.id],
      )
    )[0].count,
    "0",
  );
});
