export type DenominationKey =
  | "NOTE_500"
  | "NOTE_200"
  | "NOTE_100"
  | "NOTE_50"
  | "NOTE_20"
  | "NOTE_10"
  | "COIN_10"
  | "COIN_5"
  | "COIN_2"
  | "COIN_1";

export type DenominationConfig = {
  key: DenominationKey;
  label: string;
  value: number; // in rupees
  type: "note" | "coin";
};

export const DENOMINATIONS: readonly DenominationConfig[] = [
  { key: "NOTE_500", label: "₹500 note", value: 500, type: "note" },
  { key: "NOTE_200", label: "₹200 note", value: 200, type: "note" },
  { key: "NOTE_100", label: "₹100 note", value: 100, type: "note" },
  { key: "NOTE_50", label: "₹50 note", value: 50, type: "note" },
  { key: "NOTE_20", label: "₹20 note", value: 20, type: "note" },
  { key: "NOTE_10", label: "₹10 note", value: 10, type: "note" },
  { key: "COIN_10", label: "₹10 coin", value: 10, type: "coin" },
  { key: "COIN_5", label: "₹5 coin", value: 5, type: "coin" },
  { key: "COIN_2", label: "₹2 coin", value: 2, type: "coin" },
  { key: "COIN_1", label: "₹1 coin", value: 1, type: "coin" },
];

export type CashBreakdown = Record<string, number>; // count mapped by DenominationKey

export function calculateBreakdownTotal(breakdown: CashBreakdown): number {
  let totalPaise = 0;
  for (const denom of DENOMINATIONS) {
    const count = breakdown[denom.key] || 0;
    if (count > 0) {
      totalPaise += count * denom.value * 100;
    }
  }
  return totalPaise;
}

export function summariseBreakdown(breakdown: CashBreakdown) {
  let noteCount = 0;
  let coinCount = 0;
  for (const denom of DENOMINATIONS) {
    const count = breakdown[denom.key] || 0;
    if (count > 0) {
      if (denom.type === "note") noteCount += count;
      else coinCount += count;
    }
  }
  return { noteCount, coinCount };
}

export function validateBreakdown(breakdown: CashBreakdown): void {
  for (const key of Object.keys(breakdown)) {
    const config = DENOMINATIONS.find((d) => d.key === key);
    if (!config) throw new Error("Invalid denomination key");
    const count = breakdown[key];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 9999) {
      throw new Error(`Invalid count for ${key}`);
    }
  }
}

export function compareWithExpectedCash(
  actualPaise: number,
  expectedPaise: number
): { status: "MATCH" | "SHORT" | "EXCESS"; difference: number } {
  const diff = actualPaise - expectedPaise;
  if (diff === 0) return { status: "MATCH", difference: 0 };
  if (diff < 0) return { status: "SHORT", difference: Math.abs(diff) };
  return { status: "EXCESS", difference: diff };
}
