import type { Packaging, UnitLevel } from "./types";
import { insist } from "./errors";
export const MAX_QUANTITY = Number.MAX_SAFE_INTEGER;
export function integer(value: number, allowZero = true): number {
  insist(
    Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1),
    "INVALID_QUANTITY",
    "Quantities must be nonnegative whole numbers within the supported range.",
  );
  return value;
}
export function validateLevels(
  baseUnit: string,
  input: UnitLevel[],
): UnitLevel[] {
  insist(
    typeof baseUnit === "string" && baseUnit.trim().length > 0,
    "INVALID_BASE_UNIT",
    "Choose a canonical smallest stock unit.",
  );
  insist(
    Array.isArray(input) && input.length > 0 && input.length <= 10,
    "INVALID_PACKAGING",
    "Configure between one and ten unit levels.",
  );
  const seen = new Set<string>();
  const levels = input.map((level) => {
    insist(
      /^[a-zA-Z][a-zA-Z0-9_-]{0,29}$/.test(level.code) && !!level.label.trim(),
      "INVALID_UNIT",
      "Each unit needs an unambiguous code and label.",
    );
    insist(
      !seen.has(level.code.toLowerCase()),
      "DUPLICATE_UNIT",
      "Unit codes must be unique.",
    );
    seen.add(level.code.toLowerCase());
    integer(level.factor, false);
    return {
      code: level.code,
      label: level.label.trim(),
      factor: level.factor,
    };
  });
  // A divisibility chain makes greedy decomposition exact and canonical in O(levels).
  insist(
    levels[levels.length - 1].factor === 1,
    "MISSING_BASE",
    "The smallest unit must have factor 1.",
  );
  insist(
    levels[levels.length - 1].code === baseUnit,
    "BASE_MISMATCH",
    "The smallest unit code must equal the canonical base unit.",
  );
  for (let i = 0; i < levels.length - 1; i++)
    insist(
      levels[i].factor > levels[i + 1].factor &&
        levels[i].factor % levels[i + 1].factor === 0,
      "INVALID_HIERARCHY",
      "Order units largest first, each an exact multiple of the next.",
    );
  return levels;
}
export function toBase(
  quantity: number,
  code: string,
  packaging: Pick<Packaging, "levels">,
): number {
  integer(quantity);
  const level = packaging.levels.find((unit) => unit.code === code);
  insist(
    level,
    "UNKNOWN_UNIT",
    "The selected unit is not part of this packaging version.",
  );
  return integer(quantity * level.factor);
}
export function breakdown(
  quantity: number,
  levels: UnitLevel[],
): { code: string; label: string; count: number; factor: number }[] {
  integer(quantity);
  let remainder = quantity;
  return levels.map((level) => {
    const count = Math.floor(remainder / level.factor);
    remainder %= level.factor;
    return { ...level, count };
  });
}
export function formatQuantity(
  quantity: number,
  packaging: Pick<Packaging, "levels" | "baseUnit"> | UnitLevel[] | null,
): string {
  integer(quantity);
  const levels = Array.isArray(packaging) ? packaging : packaging?.levels;
  if (!levels?.length) return `${quantity} base units`;
  const parts = breakdown(quantity, levels).filter((part) => part.count > 0);
  return parts.length
    ? parts.map((part) => `${part.count} ${part.label}`).join(" + ")
    : `0 ${levels[levels.length - 1].label}`;
}
export const formatMixedUnits = formatQuantity;
