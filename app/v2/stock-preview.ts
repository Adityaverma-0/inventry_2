import { formatQuantity } from "../../lib/domain/units";
import type {
  Balance,
  Product,
  QuantityInput,
  UnitLevel,
} from "../../lib/domain/types";

// Form fields can be temporarily empty, fractional or out of range while typing.
// Keep strict domain validation on the server; never throw during a React render.
export function displayQuantity(
  value: number,
  packaging: { levels: UnitLevel[]; baseUnit: string } | null,
): string {
  if (!Number.isSafeInteger(value) || value < 0)
    return "Enter a valid whole-number quantity";
  return formatQuantity(value, packaging);
}

export function stockPreviewError(
  lines: QuantityInput[],
  products: Product[],
  balances: Balance[],
  sourceId?: string,
  destinationId?: string,
): string {
  if (!lines.length) return "Add at least one product.";
  const catalogue = new Map(products.map((p) => [p.id, p]));
  const totals = new Map<string, number>();
  for (const line of lines) {
    const product = catalogue.get(line.productId);
    if (!product?.active || !product.ready || !product.packaging)
      return "Choose an active product with confirmed packaging.";
    if (line.packagingId !== product.packaging.id)
      return `${product.name}: packaging changed. Select the product again.`;
    const unit = product.packaging.levels.find((u) => u.code === line.unitCode);
    if (!unit) return `${product.name}: choose a configured unit.`;
    const quantity = line.quantity * unit.factor;
    const total = (totals.get(product.id) || 0) + quantity;
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isSafeInteger(quantity) ||
      !Number.isSafeInteger(total)
    )
      return `${product.name}: enter a positive whole-number quantity within the supported range.`;
    totals.set(product.id, total);
  }
  const stock = new Map(
    balances.map((b) => [`${b.locationId}:${b.productId}`, b.quantity]),
  );
  for (const [id, total] of totals) {
    const product = catalogue.get(id)!;
    if (sourceId) {
      const available = stock.get(`${sourceId}:${id}`) || 0;
      if (total > available)
        return `${product.name}: insufficient source stock. Requested ${displayQuantity(total, product.packaging)}; available ${displayQuantity(available, product.packaging)}. Reduce the quantity or receive stock into the source godown first.`;
    }
    if (
      destinationId &&
      !Number.isSafeInteger((stock.get(`${destinationId}:${id}`) || 0) + total)
    )
      return `${product.name}: the destination balance would exceed the supported range.`;
  }
  return "";
}
