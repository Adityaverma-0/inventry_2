import assert from "node:assert";
import test from "node:test";
import {
  calculateBreakdownTotal,
  compareWithExpectedCash,
  summariseBreakdown,
  validateBreakdown
} from "../lib/domain/cashDenominations.ts"; // using extension because it's mts depending on ts? Actually usually requires no extension or .js

test("Cash Denomination Logic", () => {
  // 1 x Rs 500 note gives Rs 500.00
  let total = calculateBreakdownTotal({ "NOTE_500": 1 });
  assert.strictEqual(total, 50000); // in paise

  // Mixed example: 2x200 + 3x100 + 1x50 + 4x10coin + 1x5 + 2x2 + 1x1 = 800
  const mixed = {
    "NOTE_200": 2, // 400
    "NOTE_100": 3, // 300
    "NOTE_50": 1,  // 50
    "COIN_10": 4,  // 40
    "COIN_5": 1,   // 5
    "COIN_2": 2,   // 4
    "COIN_1": 1    // 1
  };
  total = calculateBreakdownTotal(mixed);
  assert.strictEqual(total, 80000);

  const summary = summariseBreakdown(mixed);
  assert.strictEqual(summary.noteCount, 6);
  assert.strictEqual(summary.coinCount, 8);

  const diffMatch = compareWithExpectedCash(total, 80000);
  assert.strictEqual(diffMatch.status, "MATCH");

  const diffShort = compareWithExpectedCash(75000, 80000);
  assert.strictEqual(diffShort.status, "SHORT");
  assert.strictEqual(diffShort.difference, 5000);

  const diffExcess = compareWithExpectedCash(85000, 80000);
  assert.strictEqual(diffExcess.status, "EXCESS");
  assert.strictEqual(diffExcess.difference, 5000);

  assert.throws(() => validateBreakdown({ "NOTE_INVALID": 1 }), /Invalid denomination key/);
  assert.throws(() => validateBreakdown({ "NOTE_500": -1 }), /Invalid count for NOTE_500/);
});
