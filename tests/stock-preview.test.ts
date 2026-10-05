import test from "node:test";
import assert from "node:assert/strict";
import { displayQuantity, stockPreviewError } from "../app/v2/stock-preview";
import type { Product, QuantityInput, Balance } from "../lib/domain/types";
const product: Product = {
  id: "p",
  name: "Chips",
  sku: "",
  category: "snacks",
  active: true,
  ready: true,
  minStock: 0,
  price: null,
  priceUnit: null,
  currency: "INR",
  createdAt: "",
  packaging: {
    id: "v1",
    version: 1,
    baseUnit: "PIECE",
    createdAt: "",
    reason: "",
    levels: [
      { code: "BOX", label: "Box", factor: 24 },
      { code: "PIECE", label: "Piece", factor: 1 },
    ],
  },
};
const line = (quantity: number): QuantityInput => ({
  productId: "p",
  packagingId: "v1",
  unitCode: "PIECE",
  quantity,
});
const balances: Balance[] = [
  {
    locationId: "warehouse",
    locationType: "warehouse",
    productId: "p",
    quantity: 25,
  },
];
test("overdrawn load and duplicate lines show a shortage instead of formatting negative stock", () => {
  assert.match(
    stockPreviewError([line(26)], [product], balances, "warehouse", "vehicle"),
    /insufficient source stock/,
  );
  assert.match(
    stockPreviewError([line(13), line(13)], [product], balances, "warehouse"),
    /insufficient source stock/,
  );
  assert.equal(
    stockPreviewError([line(25)], [product], balances, "warehouse", "vehicle"),
    "",
  );
  assert.match(
    stockPreviewError([line(1)], [product], [], "warehouse"),
    /available 0 Piece/,
  );
});
test("temporary invalid inputs and overflow never crash quantity rendering or pass review", () => {
  for (const n of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.doesNotThrow(() => displayQuantity(n, product.packaging));
    assert.match(
      stockPreviewError([line(n)], [product], balances, "warehouse"),
      /positive whole-number/,
    );
  }
  assert.equal(displayQuantity(0, product.packaging), "0 Piece");
  assert.equal(displayQuantity(25, product.packaging), "1 Box + 1 Piece");
  assert.match(
    stockPreviewError([line(Number.MAX_SAFE_INTEGER), line(1)], [product], []),
    /supported range/,
  );
  const full: Balance[] = [
    {
      locationId: "vehicle",
      locationType: "vehicle",
      productId: "p",
      quantity: Number.MAX_SAFE_INTEGER,
    },
  ];
  assert.match(
    stockPreviewError([line(1)], [product], full, undefined, "vehicle"),
    /destination balance/,
  );
  assert.match(
    stockPreviewError([{ ...line(1), packagingId: "old" }], [product], []),
    /packaging changed/,
  );
});
