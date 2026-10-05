import type { Product } from "../domain/types.ts";
import type { ProductMatch } from "./types.ts";

export function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
const tokens = (value: string) =>
  new Set(normalize(value).split(/\s+/).filter(Boolean));
const singular = (value: string) => normalize(value).replace(/s$/, "");
/** An inverted token index bounds comparisons to products sharing evidence. No automatic mapping. */
export function createProductMatcher(products: Product[]) {
  const byId = new Map(products.filter((p) => p.active).map((p) => [p.id, p]));
  const inverted = new Map<string, Set<string>>();
  const names = new Map<string, Set<string>>();
  for (const p of byId.values()) {
    const ts = tokens(`${p.name} ${p.sku}`);
    names.set(p.id, ts);
    for (const token of ts) {
      if (!inverted.has(token)) inverted.set(token, new Set());
      inverted.get(token)!.add(p.id);
    }
  }
  return (
    description: string,
    unit: string | null = null,
    code: string | null = null,
  ): ProductMatch[] => {
    const query = tokens(`${description} ${code || ""}`),
      candidateIds = new Set<string>();
    for (const token of query)
      for (const id of inverted.get(token) || []) candidateIds.add(id);
    const result: ProductMatch[] = [];
    for (const id of candidateIds) {
      const p = byId.get(id)!,
        pt = names.get(id)!;
      const overlap = [...query].filter((x) => pt.has(x)).length;
      const exactName = normalize(p.name) === normalize(description);
      const exactSku = Boolean(
        code && p.sku && normalize(code) === normalize(p.sku),
      );
      const numbers = [...tokens(p.name)].filter((t) => /^\d+$/.test(t));
      const conflict = numbers.some(
        (t) => [...query].some((q) => /^\d+$/.test(q)) && !query.has(t),
      );
      let score = exactSku
        ? 0.99
        : exactName
          ? 0.96
          : Math.min(0.86, (2 * overlap) / (query.size + pt.size));
      const reasons = [
        exactSku
          ? "Exact supplied SKU."
          : exactName
            ? "Exact normalized name."
            : `${overlap} shared name/SKU tokens.`,
      ];
      if (conflict) {
        score *= 0.45;
        reasons.push(
          "Numeric pack/variant tokens differ; check the product variant.",
        );
      }
      const units =
        p.packaging?.levels.filter(
          (l) =>
            unit &&
            [l.code, l.label].some((v) => singular(v) === singular(unit)),
        ) || [];
      if (unit && units.length !== 1)
        reasons.push("Invoice unit has no unique configured match.");
      if (!p.ready) reasons.push("Product packaging setup is incomplete.");
      result.push({
        productId: id,
        name: p.name,
        score: Math.round(score * 100) / 100,
        confidence: score >= 0.95 ? "high" : score >= 0.65 ? "medium" : "low",
        reasons,
        unitCode: units.length === 1 ? units[0].code : null,
        packagingId: p.packaging?.id || null,
      });
    }
    result.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    if (result.length > 1 && result[0].score - result[1].score < 0.08) {
      result[0].confidence = "low";
      result[0].reasons.push(
        "Several products have similar scores; administrator selection is required.",
      );
    }
    return result.slice(0, 5);
  };
}
