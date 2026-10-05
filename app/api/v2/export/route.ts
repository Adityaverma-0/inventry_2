import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/security";
import { errorResponse } from "@/lib/server/responses";
import {
  getExportState,
  getReportRevision,
  getWarehouseReconciliation,
} from "@/lib/domain/service";
import { formatQuantity, breakdown } from "@/lib/domain/units";
import { stringifyCsv } from "@/lib/documents/csv";

type Cell = string | number | boolean | null | undefined;
export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request),
      state = await getExportState(actor),
      p = request.nextUrl.searchParams;
    const kind = p.get("kind") || "stock",
      from = p.get("from") || "",
      to = p.get("to") || "";
    const validDay = (v: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v;
    if ([from, to].some((v) => v && !validDay(v)) || (from && to && from > to))
      throw new HttpError("Choose a valid date range.");
    if (
      p.has("revision") &&
      (!p.get("reportId") ||
        !/^\d+$/.test(p.get("revision") || "") ||
        Number(p.get("revision")) < 1 ||
        !Number.isSafeInteger(Number(p.get("revision"))))
    )
      throw new HttpError("Choose a report and a positive revision number.");
    const dayOf = (value: string) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: state.settings.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value));
    const dates = (value: string) => {
      const d = value.length === 10 ? value : dayOf(value);
      return (!from || d >= from) && (!to || d <= to);
    };
    const match = (key: string, value: string) =>
      !p.get(key) || p.get(key) === value;
    const products = new Map(state.products.map((v) => [v.id, v])),
      vehicles = new Map(state.vehicles.map((v) => [v.id, v])),
      warehouses = new Map(state.warehouses.map((v) => [v.id, v]));
    const locationOf = (type: string, id: string) =>
      type === "warehouse"
        ? warehouses.get(id)?.locationId
        : warehouses.get(vehicles.get(id)?.warehouseId || "")?.locationId;
    const locationMatch = (type: string, id: string) =>
      match("locationId", locationOf(type, id) || "") &&
      (type === "vehicle"
        ? match("vehicleId", id) &&
          match("warehouseId", vehicles.get(id)?.warehouseId || "")
        : !p.get("vehicleId") && match("warehouseId", id));
    const productMatch = (id: string) =>
      match("productId", id) &&
      match("category", products.get(id)?.category || "");
    const documentScope = (vehicleId: string, warehouseId: string) =>
      match("vehicleId", vehicleId) &&
      match("warehouseId", warehouseId) &&
      match("locationId", warehouses.get(warehouseId)?.locationId || "");
    let rows: Cell[][];
    if (kind === "products") {
      if (actor.role !== "owner")
        throw new HttpError("Only admin can export the catalogue.", 403);
      rows = [
        [
          "Product ID",
          "SKU",
          "Product",
          "Category",
          "Status",
          "Selling price",
          "Currency",
          "Price unit",
          "Min stock",
          "Base unit",
          "Packaging levels JSON",
          "Packaging version",
          "Raw packaging",
        ],
        ...state.products
          .filter((v) => productMatch(v.id))
          .map((v) => [
            v.id,
            v.sku,
            v.name,
            v.category,
            v.active,
            v.price,
            v.currency,
            v.priceUnit,
            v.minStock,
            v.packaging?.baseUnit,
            JSON.stringify(v.packaging?.levels || []),
            v.packaging?.version,
            v.rawImport?.Packaging || "",
          ]),
      ];
    } else if (kind === "stock") {
      const balances = new Map(
        state.balances.map((v) => [
          `${v.locationType}:${v.locationId}:${v.productId}`,
          v.quantity,
        ]),
      );
      const places = [
        ...(actor.role === "owner"
          ? state.warehouses.map((v) => ({
              id: v.id,
              name: v.name,
              type: "warehouse",
            }))
          : []),
        ...state.vehicles.map((v) => ({
          id: v.id,
          name: v.name,
          type: "vehicle",
        })),
      ].filter((v) => locationMatch(v.type, v.id));
      const codes = [
        ...new Set(
          state.products
            .filter((v) => productMatch(v.id))
            .flatMap((v) => v.packaging?.levels.map((l) => l.code) || []),
        ),
      ].sort();
      rows = [
        [
          "Location",
          "Stock type",
          "Stock location",
          "Product ID",
          "SKU",
          "Product",
          "Category",
          "Base quantity",
          "Mixed quantity",
          "Base unit",
          "Packaging version",
          "Generated at",
          "Packaging levels JSON",
          ...codes.map((code) => `Remaining ${code} count`),
        ],
      ];
      for (const place of places)
        for (const product of state.products.filter((v) =>
          productMatch(v.id),
        )) {
          const qty =
            balances.get(`${place.type}:${place.id}:${product.id}`) || 0;
          const parts = breakdown(qty, product.packaging?.levels || []);
          rows.push([
            state.locations.find(
              (v) => v.id === locationOf(place.type, place.id),
            )?.name,
            place.type,
            place.name,
            product.id,
            product.sku,
            product.name,
            product.category,
            qty,
            formatQuantity(qty, product.packaging),
            product.packaging?.baseUnit,
            product.packaging?.version,
            state.serverTime,
            JSON.stringify(product.packaging?.levels || []),
            ...codes.map(
              (code) => parts.find((p) => p.code === code)?.count ?? "",
            ),
          ]);
        }
    } else if (kind === "sales") {
      rows = [
        [
          "Reference",
          "Business day",
          "Vehicle",
          "Salesman",
          "Status",
          "Product",
          "Entered quantity",
          "Unit",
          "Base quantity",
          "Packaging ID",
          "Created at",
          "Replaces",
          "Replaced by",
          "Historical godown ID",
          "Historical godown",
        ],
      ];
      for (const sale of state.sales.filter(
        (v) =>
          dates(v.day) &&
          documentScope(
            v.vehicleId,
            v.warehouseId || vehicles.get(v.vehicleId)?.warehouseId || "",
          ) &&
          match("salesmanId", v.salesmanId),
      ))
        for (const line of sale.lines.filter((l) => productMatch(l.productId)))
          rows.push([
            sale.reference,
            sale.day,
            vehicles.get(sale.vehicleId)?.name,
            sale.salesmanName,
            sale.status,
            line.productName,
            line.quantity,
            line.unitCode,
            line.baseQuantity,
            line.packagingId,
            sale.createdAt,
            sale.replacesId,
            sale.replacedById,
            sale.warehouseId || vehicles.get(sale.vehicleId)?.warehouseId || "",
            warehouses.get(
              sale.warehouseId ||
                vehicles.get(sale.vehicleId)?.warehouseId ||
                "",
            )?.name ||
              sale.warehouseId ||
              "",
          ]);
    } else if (kind === "movements") {
      rows = [
        [
          "Movement ID",
          "Created at",
          "Reference",
          "Kind",
          "Stock type",
          "Stock location",
          "Product",
          "Signed base quantity",
          "Actor",
          "Reason",
        ],
      ];
      for (const m of state.movements.filter(
        (v) =>
          dates(v.createdAt) &&
          locationMatch(v.locationType, v.locationId) &&
          productMatch(v.productId),
      ))
        rows.push([
          m.id,
          m.createdAt,
          m.reference,
          m.kind,
          m.locationType,
          (m.locationType === "warehouse" ? warehouses : vehicles).get(
            m.locationId,
          )?.name,
          products.get(m.productId)?.name,
          m.quantity,
          m.actorName,
          m.note,
        ]);
    } else if (kind === "transfers") {
      rows = [
        [
          "Reference",
          "Created at",
          "From godown",
          "To vehicle",
          "Actor",
          "Product",
          "Entered quantity",
          "Unit",
          "Base quantity",
          "Packaging ID",
        ],
      ];
      for (const t of state.transfers.filter(
        (v) => dates(v.createdAt) && documentScope(v.vehicleId, v.warehouseId),
      ))
        for (const l of t.lines.filter((v) => productMatch(v.productId)))
          rows.push([
            t.reference,
            t.createdAt,
            warehouses.get(t.warehouseId)?.name,
            vehicles.get(t.vehicleId)?.name,
            t.actorName,
            l.productName,
            l.quantity,
            l.unitCode,
            l.baseQuantity,
            l.packagingId,
          ]);
    } else if (kind === "invoices") {
      if (actor.role !== "owner")
        throw new HttpError("Only admin can export purchase invoices.", 403);
      rows = [
        [
          "Invoice ID",
          "Revision",
          "Supplier",
          "Invoice number",
          "Invoice date",
          "Warehouse",
          "Status",
          "Extraction",
          "Receipt reference",
          "Approved by",
          "Approved at",
          "Decision reason",
        ],
      ];
      for (const i of state.invoices.filter(
        (v) =>
          dates(v.createdAt) &&
          match("warehouseId", v.warehouseId) &&
          match("status", v.status),
      ))
        rows.push([
          i.id,
          i.revision,
          i.supplier,
          i.invoiceNumber,
          i.invoiceDate,
          warehouses.get(i.warehouseId)?.name,
          i.status,
          i.extractionStatus,
          i.receiptReference,
          i.approvedBy,
          i.approvedAt,
          i.decisionReason,
        ]);
    } else if (kind === "reconciliation") {
      if (!p.get("day") && from && to && from !== to)
        throw new HttpError(
          "Godown reconciliation uses one business day. Select its day explicitly.",
        );
      const day = p.get("day") || to || from || dayOf(state.serverTime);
      if (!validDay(day))
        throw new HttpError("Choose a valid reconciliation day.");
      const reports = await getWarehouseReconciliation(
        actor,
        day,
        p.get("warehouseId") || undefined,
      );
      const codes = [
        ...new Set(
          reports.flatMap((r) =>
            r.lines.flatMap((l) => l.levels.map((u) => u.code)),
          ),
        ),
      ].sort();
      rows = [
        [
          "Godown",
          "Business day",
          "Product ID",
          "Product",
          "Opening base",
          "Receipts base",
          "Outgoing loads base",
          "Returns base",
          "Signed adjustments base",
          "Closing base",
          "Closing quantity",
          "Base unit",
          "Packaging ID",
          "Packaging levels JSON",
          "Equation balances",
          "Live base quantity",
          "Ledger matches live",
          "Quantity basis",
          "Conversion basis",
          "Generated at",
          ...codes.map((code) => `Remaining ${code} count`),
        ],
      ];
      for (const report of reports.filter((r) =>
        locationMatch("warehouse", r.warehouseId),
      ))
        for (const line of report.lines.filter((l) =>
          productMatch(l.productId),
        )) {
          const parts = breakdown(line.closing, line.levels);
          rows.push([
            report.warehouseName,
            report.day,
            line.productId,
            line.productName,
            line.opening,
            line.receipts,
            line.outgoing,
            line.returns,
            line.adjustments,
            line.closing,
            line.formatted,
            line.baseUnit,
            line.packagingId,
            JSON.stringify(line.levels),
            line.equationBalances,
            line.liveBalance,
            line.ledgerMatchesLive,
            report.quantityBasis,
            report.conversionBasis,
            report.generatedAt,
            ...codes.map(
              (code) => parts.find((p) => p.code === code)?.count ?? "",
            ),
          ]);
        }
    } else if (kind === "reports") {
      const reports = p.get("reportId")
        ? [
            await getReportRevision(
              actor,
              p.get("reportId")!,
              p.has("revision") ? Number(p.get("revision")) : undefined,
            ),
          ]
        : state.reports;
      const codes = [
        ...new Set(
          reports.flatMap((r) =>
            r.lines.flatMap((l) => l.levels.map((u) => u.code)),
          ),
        ),
      ].sort();
      rows = [
        [
          "Report ID",
          "Business name (saved)",
          "Godown (saved)",
          "Location (saved)",
          "Timezone (saved)",
          "Revision",
          "Business day",
          "Vehicle",
          "Salesman",
          "Approval status",
          "Product",
          "Opening",
          "Loaded",
          "Sold",
          "Reversed",
          "Adjustments",
          "Closing base quantity",
          "Closing mixed quantity",
          "Packaging ID",
          "Decided at",
          "Decision reason",
          "Source hash",
          "Packaging levels JSON",
          ...codes.map((code) => `Remaining ${code} count`),
        ],
      ];
      for (const report of reports.filter(
        (v) =>
          dates(v.day) &&
          locationMatch("vehicle", v.vehicleId) &&
          match("salesmanId", v.salesmanId) &&
          match("status", v.status),
      ))
        for (const line of report.lines.filter((l) =>
          productMatch(l.productId),
        ))
          rows.push([
            report.id,
            report.businessName || "Not captured",
            report.warehouseName || "Not captured",
            report.locationName || "Not captured",
            report.timezone || "Not captured",
            report.revision,
            report.day,
            report.vehicleName,
            report.salesmanName,
            report.status,
            line.productName,
            line.opening,
            line.loaded,
            line.sold,
            line.reversed,
            line.adjustments,
            line.closing,
            line.formatted,
            line.packagingId,
            report.decidedAt,
            report.decisionReason,
            report.sourceHash,
            JSON.stringify(line.levels),
            ...codes.map(
              (code) =>
                breakdown(line.closing, line.levels).find(
                  (v) => v.code === code,
                )?.count ?? "",
            ),
          ]);
    } else throw new HttpError("Unknown export type.");
    return new Response(stringifyCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sanket-${kind}-${dayOf(state.serverTime)}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
