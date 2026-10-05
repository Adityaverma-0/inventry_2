"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Download,
  FileSpreadsheet,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import type { Packaging, Product } from "@/lib/domain/types";
import { api, dateTime, requestId, useMutation } from "./client";
import {
  Badge,
  Button,
  DataTable,
  ErrorNotice,
  Field,
  formatLevels,
  Input,
  Modal,
  Panel,
  SearchInput,
  useApp,
} from "./ui";
export function ProductsPage() {
  const { state, refresh, notify } = useApp();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [packing, setPacking] = useState<Product | null>(null);
  const mutation = useMutation(refresh);
  const categories = [...new Set(state.products.map((p) => p.category))].sort();
  const shown = useMemo(
    () =>
      state.products.filter(
        (p) =>
          `${p.name} ${p.sku}`.toLowerCase().includes(search.toLowerCase()) &&
          (!category || p.category === category) &&
          (!status ||
            (status === "ready"
              ? p.ready
              : status === "setup"
                ? !p.ready
                : !p.active)),
      ),
    [state.products, search, category, status],
  );
  return (
    <>
      <div className="sd-toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search products or SKU…"
        />
        <select
          aria-label="Category filter"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select
          aria-label="Readiness filter"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All products</option>
          <option value="ready">Ready to use</option>
          <option value="setup">Needs setup</option>
          <option value="inactive">Inactive</option>
        </select>
        <Button variant="secondary" onClick={() => setImporting(true)}>
          <Upload size={14} />
          Import CSV
        </Button>
        <a className="sd-btn sd-secondary" href="/api/v2/export?kind=products">
          <Download size={14} />
          Export
        </a>
        <Button onClick={() => setEditing(null)}>
          <Plus size={15} />
          Add product
        </Button>
      </div>
      <Panel
        title="Product catalogue"
        subtitle={`${shown.length} products · catalogue data does not overwrite inventory`}
      >
        <DataTable
          headers={[
            "Product / SKU",
            "Category",
            "Packaging",
            "Selling price",
            "Min stock",
            "Status",
            "Actions",
          ]}
          rows={shown.map((p) => [
            // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
            <div>
              <strong>{p.name}</strong>
              <small className="sd-sub">
                {p.sku || "Internal ID: " + p.id.slice(0, 8)}
              </small>
            </div>,
            p.category,
            // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
            <div>
              {p.packaging ? (
                <>
                  <span className="sd-legend">
                    {p.packaging.levels
                      .map(
                        (l) =>
                          `1 ${l.label} = ${l.factor} ${p.packaging!.baseUnit}`,
                      )
                      .join(" · ")}
                  </span>
                  <small className="sd-sub">
                    Version {p.packaging.version}
                  </small>
                </>
              ) : (
                <Badge tone="amber">Packaging setup required</Badge>
              )}
            </div>,
            p.price ? (
              <div>
                {p.currency} {p.price}
                <small className="sd-sub">
                  {p.priceUnit
                    ? `per ${p.priceUnit}`
                    : "Price unit unconfirmed"}
                </small>
              </div>
            ) : (
              "—"
            ),
            // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
            <div>
              {p.minStock}
              <small className="sd-sub">Base units · per location</small>
            </div>,
            // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
            <div className="sd-stack" style={{ gap: 5 }}>
              <Badge>{p.active ? "Active" : "Inactive"}</Badge>
              <Badge tone={p.ready ? "green" : "amber"}>
                {p.ready ? "Ready" : "Setup required"}
              </Badge>
            </div>,
            // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
            <div className="sd-row-actions">
              <Button variant="ghost" onClick={() => setEditing(p)}>
                Edit
              </Button>
              <Button variant="secondary" onClick={() => setPacking(p)}>
                Packaging
              </Button>
            </div>,
          ])}
          empty="Your catalogue starts here"
        />
        {state.products.length === 0 && (
          <p style={{ textAlign: "center", fontSize: 12 }}>
            Import your product CSV or add your first product. No stock is
            created by adding a catalogue item.
          </p>
        )}
      </Panel>
      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? "Edit product" : "Add product"}
      >
        <form
          key={editing?.id || "new"}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await mutation.run("product.save", {
                id: editing?.id,
                name: f.get("name"),
                sku: f.get("sku"),
                category: f.get("category"),
                active: f.get("active") === "on",
                minStock: Number(f.get("minStock")),
                price: f.get("price") || null,
                priceUnit: f.get("priceUnit") || null,
                currency: f.get("currency") || "INR",
              });
              notify("Product saved");
              setEditing(undefined);
            } catch {}
          }}
        >
          <div className="sd-form">
            <Field label="Product name">
              <Input name="name" defaultValue={editing?.name} required />
            </Field>
            <Field label="SKU (optional)">
              <Input name="sku" defaultValue={editing?.sku} />
            </Field>
            <Field label="Category">
              <Input
                name="category"
                defaultValue={editing?.category}
                list="category-list"
                required
              />
              <datalist id="category-list">
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </datalist>
            </Field>
            <Field
              label="Minimum stock"
              hint="Integer base units at each stock location."
            >
              <Input
                name="minStock"
                type="number"
                min={0}
                step={1}
                defaultValue={editing?.minStock ?? 0}
                required
              />
            </Field>
            <Field label="Selling price (optional)">
              <Input
                name="price"
                type="number"
                min="0"
                step="0.01"
                defaultValue={editing?.price || ""}
              />
            </Field>
            <Field label="Currency">
              <Input
                name="currency"
                maxLength={3}
                defaultValue={editing?.currency || "INR"}
                required
              />
            </Field>
            <Field
              label="Price unit"
              hint="Leave unresolved until you explicitly confirm the price basis."
            >
              {editing?.packaging ? (
                <select
                  name="priceUnit"
                  defaultValue={editing?.priceUnit || ""}
                >
                  <option value="">Unconfirmed</option>
                  {editing.packaging.levels.map((l) => (
                    <option value={l.code} key={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  name="priceUnit"
                  defaultValue={editing?.priceUnit || ""}
                  placeholder="e.g. PIECE, only if confirmed"
                />
              )}
            </Field>
            <label className="sd-check">
              <input
                name="active"
                type="checkbox"
                defaultChecked={editing?.active ?? true}
              />
              Active in catalogue
            </label>
          </div>
          <div className="sd-notice">
            Packaging is configured separately. Incomplete products cannot be
            used for stock operations.
          </div>
          <ErrorNotice error={mutation.error} />
          <div className="sd-form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(undefined)}
            >
              Cancel
            </Button>
            <Button busy={mutation.busy}>Save product</Button>
          </div>
        </form>
      </Modal>
      {packing && (
        <PackagingEditor product={packing} onClose={() => setPacking(null)} />
      )}
      <Modal
        open={importing}
        onClose={() => setImporting(false)}
        title="Import product catalogue"
        description="Upload, map, review and confirm. Catalogue import does not change stock."
        wide
      >
        <ImportWizard onClose={() => setImporting(false)} />
      </Modal>
    </>
  );
}
export function PackagingPage() {
  const { state } = useApp();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  return (
    <>
      <div className="sd-toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Find a product to configure…"
        />
      </div>
      <div className="sd-notice">
        Configure exact integer ratios for each product. Activating a new
        version preserves base stock and all historical transaction conversions.
      </div>
      <Panel>
        <DataTable
          headers={[
            "Product",
            "Smallest unit",
            "Active hierarchy",
            "Version",
            "Action",
          ]}
          rows={state.products
            .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
            .map((p) => [
              p.name,
              p.packaging?.baseUnit || "Not configured",
              p.packaging?.levels
                .map((l) => `${l.label} (${l.factor})`)
                .join(" → ") || <Badge tone="amber">Setup required</Badge>,
              p.packaging?.version || "—",
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <Button variant="secondary" onClick={() => setSelected(p)}>
                <Boxes size={14} />
                {p.packaging ? "Edit & view history" : "Configure"}
              </Button>,
            ])}
        />
      </Panel>
      {selected && (
        <PackagingEditor product={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
type LevelEdit = { code: string; label: string; ratio: number };
function PackagingEditor({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const { refresh, notify, online } = useApp();
  const initial = product.packaging
    ? [...product.packaging.levels]
        .sort((a, b) => a.factor - b.factor)
        .map((l, i, a) => ({
          code: l.code,
          label: l.label,
          ratio: i ? l.factor / a[i - 1].factor : 1,
        }))
    : [
        { code: "PIECE", label: "Piece", ratio: 1 },
        { code: "STRIP", label: "Strip", ratio: 12 },
        { code: "BOX", label: "Box", ratio: 12 },
      ];
  const [levels, setLevels] = useState<LevelEdit[]>(initial);
  const [preview, setPreview] = useState(350);
  const [history, setHistory] = useState<Packaging[]>([]);
  const [historyError, setHistoryError] = useState("");
  const mutation = useMutation(refresh);
  useEffect(() => {
    api<Packaging[] | { versions: Packaging[] }>(
      `/products/${product.id}/packaging`,
    )
      .then((r) => setHistory(Array.isArray(r) ? r : r.versions))
      .catch((e) => setHistoryError(e.message));
  }, [product.id]);
  const derived = useMemo(
    () =>
      levels
        .reduce<{ code: string; label: string; factor: number }[]>(
          (result, l, i) => [
            ...result,
            {
              code: l.code.trim(),
              label: l.label.trim(),
              factor: i ? result[i - 1].factor * l.ratio : 1,
            },
          ],
          [],
        )
        .reverse(),
    [levels],
  );
  const valid =
    derived.every((l) => Number.isSafeInteger(l.factor) && l.factor > 0) &&
    new Set(derived.map((l) => l.code)).size === derived.length;
  function update(i: number, key: keyof LevelEdit, value: string | number) {
    setLevels((a) => a.map((l, j) => (i === j ? { ...l, [key]: value } : l)));
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`${product.name} · packaging`}
      description="Define the smallest unit first, then each larger level as a multiple of the level below."
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await mutation.run("packaging.save", {
              productId: product.id,
              baseUnit: levels[0].code,
              levels: derived,
              ...(product.price !== null
                ? {
                    priceBasis: {
                      price: String(f.get("packagingPrice") || ""),
                      unitCode: String(f.get("packagingPriceUnit") || ""),
                      currency: product.currency,
                    },
                  }
                : {}),
              reason: f.get("reason"),
            });
            notify(
              "New packaging version activated. Stock quantities are unchanged.",
            );
            onClose();
          } catch {}
        }}
      >
        <div className="sd-grid sd-grid-equal">
          <div>
            <span className="sd-eyebrow">
              UNIT HIERARCHY · SMALLEST TO LARGEST
            </span>
            {levels.map((l, i) => (
              <div className="sd-invoice-line" key={i}>
                <div className="sd-form">
                  <Field
                    label={i === 0 ? "Canonical base-unit code" : "Unit code"}
                  >
                    <Input
                      value={l.code}
                      onChange={(e) =>
                        update(
                          i,
                          "code",
                          e.target.value.toUpperCase().replace(/\s/g, "_"),
                        )
                      }
                      required
                      readOnly={i === 0 && !!product.packaging}
                    />
                  </Field>
                  <Field label="Display label">
                    <Input
                      value={l.label}
                      onChange={(e) => update(i, "label", e.target.value)}
                      required
                    />
                  </Field>
                  {i > 0 && (
                    <>
                      <Field
                        label={`1 ${l.label || "unit"} contains`}
                        hint={`${levels[i - 1].label || "smaller units"} per ${l.label || "unit"}`}
                      >
                        <Input
                          type="number"
                          min={2}
                          step={1}
                          value={l.ratio}
                          onChange={(e) =>
                            update(i, "ratio", Number(e.target.value))
                          }
                          required
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setLevels((a) => a.filter((_, j) => j !== i))
                        }
                      >
                        <Trash2 size={15} />
                        Remove level
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setLevels((a) => [...a, { code: "", label: "", ratio: 2 }])
              }
            >
              <Plus size={14} />
              Add larger unit
            </Button>
          </div>
          <div>
            <Panel
              title="Live conversion preview"
              subtitle="A quantity equivalent, not a count of sealed packs"
            >
              <Field label={`Quantity in ${levels[0]?.label || "base units"}`}>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={preview}
                  onChange={(e) => setPreview(Number(e.target.value))}
                />
              </Field>
              <div
                className="sd-notice sd-success"
                style={{ fontSize: 18, marginTop: 18 }}
              >
                {valid
                  ? formatLevels(preview, derived, levels[0].label)
                  : "Enter valid whole-number ratios"}
              </div>
              {derived.map((l) => (
                <p className="sd-legend" key={l.code}>
                  1 {l.label} = {l.factor} {levels[0].label}
                </p>
              ))}
            </Panel>
            <div className="sd-notice">
              {product.packaging
                ? `Active version ${product.packaging.version} remains attached to past transactions. Saving creates version ${product.packaging.version + 1}. The canonical base-unit code is fixed.`
                : "Verify these example ratios against the actual product. Nothing is activated until you save."}
            </div>
            {product.price !== null && (
              <Panel
                title="Selling price"
                subtitle="Confirm the amount and which packaging unit it prices. Saved together with this version."
              >
                <p className="sd-legend">
                  Currently {product.currency} {product.price} per{" "}
                  {product.priceUnit || "unconfirmed unit"}.
                </p>
                {product.priceUnit &&
                  !derived.some((l) => l.code === product.priceUnit) && (
                    <div className="sd-notice sd-warning">
                      The saved price unit “{product.priceUnit}” is not in this
                      hierarchy. Select the correct unit below. Quantities
                      belong in the conversion fields, not the price unit.
                    </div>
                  )}
                <Field label={`Selling price (${product.currency})`}>
                  <Input
                    name="packagingPrice"
                    type="number"
                    min="0"
                    max="99999999999999.99"
                    step="0.01"
                    defaultValue={product.price}
                    required
                  />
                </Field>
                <Field
                  label="Price applies to"
                  hint="Choose deliberately; the price is not automatically converted when packaging changes."
                >
                  <select
                    name="packagingPriceUnit"
                    key={derived.map((l) => l.code).join("|")}
                    defaultValue={
                      derived.some((l) => l.code === product.priceUnit)
                        ? product.priceUnit!
                        : ""
                    }
                    required
                  >
                    <option value="">Select a price unit</option>
                    {derived
                      .filter((l) => l.code)
                      .map((l, i) => (
                        <option key={`${l.code}-${i}`} value={l.code}>
                          {l.label} ({l.code})
                        </option>
                      ))}
                  </select>
                </Field>
              </Panel>
            )}
            <Field label="Reason for activation">
              <textarea
                name="reason"
                rows={3}
                required
                placeholder="Explain the confirmed pack size or ratio change"
              />
            </Field>
          </div>
        </div>
        <ErrorNotice error={mutation.error} />
        <div className="sd-form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || !online} busy={mutation.busy}>
            Activate new version
          </Button>
        </div>
      </form>
      <Panel
        title="Version history"
        subtitle="Read-only conversion records"
        className="sd-location-list"
      >
        <ErrorNotice error={historyError} />
        <DataTable
          headers={["Version", "Effective from", "Hierarchy", "Reason"]}
          rows={history.map((v) => [
            v.version,
            dateTime(v.createdAt),
            v.levels.map((l) => `${l.label}: ${l.factor}`).join(" · "),
            v.reason,
          ])}
        />
      </Panel>
    </Modal>
  );
}
type ImportIssue = { code: string; severity: string; message: string };
type ImportRow = {
  rowNumber: number;
  raw: Record<string, string>;
  product: {
    name: string;
    category: string;
    price: string | null;
    minStock: number;
    active: boolean;
  };
  packagingRaw: string;
  sourceStockQuantity: number | null;
  issues: ImportIssue[];
  candidates: { id: string; name: string; reason: string }[];
};
type ImportPreview = {
  headers: string[];
  mapping: Record<string, string>;
  rows: ImportRow[];
  errors: unknown[];
  warnings: unknown[];
};
type ImportDecision = {
  rowNumber: number;
  action: "create" | "update" | "skip";
  productId?: string;
  confirmPrice?: boolean;
  currency?: string;
  priceUnit?: string;
  confirmMinimumStock?: boolean;
};
function ImportWizard({ onClose }: { onClose: () => void }) {
  const { refresh, notify, online } = useApp();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<ImportDecision[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(1);
  const [key] = useState(requestId);
  const [summary, setSummary] = useState<unknown>(null);
  async function parse(text: string, map?: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      const p = await api<ImportPreview>("/import", {
        csv: text,
        mapping: map,
        confirm: false,
      });
      setPreview(p);
      setMapping(p.mapping);
      setDecisions(
        p.rows.map((r) => ({
          rowNumber: r.rowNumber,
          action: r.candidates.length ? "skip" : "create",
          confirmPrice: false,
          confirmMinimumStock: false,
          currency: "INR",
          priceUnit: "",
        })),
      );
      setStep(2);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV parsing failed");
    } finally {
      setBusy(false);
    }
  }
  function decide(row: number, patch: Partial<ImportDecision>) {
    setDecisions((d) =>
      d.map((v) => (v.rowNumber === row ? { ...v, ...patch } : v)),
    );
  }
  return (
    <>
      <div className="sd-tabs">
        {["Upload", "Map columns", "Review & confirm", "Summary"].map(
          (s, i) => (
            <button
              key={s}
              className={step === i + 1 ? "active" : ""}
              disabled={i + 1 > step || step === 4}
              onClick={() => setStep(i + 1)}
            >
              {i + 1}. {s}
            </button>
          ),
        )}
      </div>
      {step === 1 && (
        <div className="sd-file-drop">
          <FileSpreadsheet size={31} />
          <h3>Choose your product CSV</h3>
          <p>
            UTF-8 CSV with a header row. Original values and row numbers are
            preserved.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Product CSV file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                const text = await file.text();
                setCsv(text);
                await parse(text);
              }
            }}
          />
        </div>
      )}
      {step === 2 && preview && (
        <>
          <div className="sd-form">
            {Object.entries({
              name: "Product name",
              category: "Category",
              packaging: "Raw packaging",
              warehouseQuantity: "Source stock quantity (reference only)",
              price: "Selling price",
              minStock: "Minimum stock",
              active: "Active status",
              sku: "SKU (optional)",
              currency: "Currency (optional)",
              priceUnit: "Price unit (optional)",
            }).map(([key, label]) => (
              <Field label={label} key={key}>
                <select
                  value={mapping[key] || ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [key]: e.target.value }))
                  }
                >
                  <option value="">Not mapped</option>
                  {preview.headers.map((h) => (
                    <option value={h} key={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <div className="sd-notice">
            The source Warehouse column is a quantity, not a warehouse ID.
            Catalogue import never posts these quantities to live inventory.
          </div>
          <div className="sd-form-actions">
            <Button
              busy={busy}
              onClick={async () => {
                await parse(csv, mapping);
                setStep(3);
              }}
            >
              Preview mapped rows
            </Button>
          </div>
        </>
      )}
      {step === 3 && preview && (
        <>
          <p className="sd-legend">
            {preview.rows.length} source rows. Review duplicate candidates,
            source values and unresolved packaging before confirmation.
          </p>
          {preview.rows.map((r) => {
            const d = decisions.find((d) => d.rowNumber === r.rowNumber)!;
            return (
              <div className="sd-invoice-line" key={r.rowNumber}>
                <div className="sd-panel-head">
                  <div>
                    <h3>
                      Row {r.rowNumber} · {r.product.name}
                    </h3>
                    <p>
                      {r.product.category} · source packaging “{r.packagingRaw}”
                      · source stock {r.sourceStockQuantity ?? "unknown"}
                    </p>
                  </div>
                  <Badge tone="amber">Packaging setup required</Badge>
                </div>
                <div className="sd-form">
                  <Field label="Import decision">
                    <select
                      value={
                        d.action === "update"
                          ? `update:${d.productId}`
                          : d.action
                      }
                      onChange={(e) =>
                        decide(
                          r.rowNumber,
                          e.target.value.startsWith("update:")
                            ? {
                                action: "update",
                                productId: e.target.value.split(":")[1],
                              }
                            : {
                                action: e.target.value as "create" | "skip",
                                productId: undefined,
                              },
                        )
                      }
                    >
                      <option value="skip">Skip row</option>
                      {!r.candidates.length && (
                        <option value="create">
                          Create draft catalogue item
                        </option>
                      )}
                      {r.candidates.map((c) => (
                        <option key={c.id} value={`update:${c.id}`}>
                          Update {c.name} · {c.reason}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Preserved selling price">
                    <Input readOnly value={r.product.price || ""} />
                  </Field>
                  <Field label="Explicit price unit">
                    <Input
                      placeholder="Leave blank until confirmed"
                      value={d.priceUnit || ""}
                      onChange={(e) =>
                        decide(r.rowNumber, { priceUnit: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Currency">
                    <Input
                      value={d.currency || "INR"}
                      onChange={(e) =>
                        decide(r.rowNumber, { currency: e.target.value })
                      }
                    />
                  </Field>
                  <label className="sd-check">
                    <input
                      type="checkbox"
                      checked={!!d.confirmPrice}
                      onChange={(e) =>
                        decide(r.rowNumber, { confirmPrice: e.target.checked })
                      }
                    />
                    I confirm this price basis
                  </label>
                  <label className="sd-check">
                    <input
                      type="checkbox"
                      checked={!!d.confirmMinimumStock}
                      onChange={(e) =>
                        decide(r.rowNumber, {
                          confirmMinimumStock: e.target.checked,
                        })
                      }
                    />
                    Minimum {r.product.minStock} applies in base units per
                    location
                  </label>
                </div>
                {r.issues.map((issue, i) => (
                  <div
                    key={i}
                    className={`sd-notice ${issue.severity === "error" ? "sd-error" : "sd-warning"}`}
                  >
                    {issue.message}
                  </div>
                ))}
                <details>
                  <summary className="sd-text-link">
                    View original source values
                  </summary>
                  <pre className="sd-extracted">
                    {JSON.stringify(r.raw, null, 2)}
                  </pre>
                </details>
              </div>
            );
          })}
          <ErrorNotice
            error={
              preview.errors.length
                ? preview.errors
                    .map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
                    .join(" · ")
                : ""
            }
          />
          <div className="sd-form-actions">
            <Button variant="secondary" onClick={() => setStep(2)}>
              Back to mapping
            </Button>
            <Button
              disabled={!online || !decisions.some((d) => d.action !== "skip")}
              busy={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await api("/import", {
                    csv,
                    mapping,
                    confirm: true,
                    decisions,
                    requestId: key,
                  });
                  setSummary(result);
                  setStep(4);
                  await refresh();
                  notify("Catalogue import complete");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Import failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm catalogue import
            </Button>
          </div>
        </>
      )}
      {step === 4 && (
        <>
          <div className="sd-notice sd-success">
            Your confirmed catalogue decisions have been saved. Configure
            packaging before posting stock.
          </div>
          <p>
            {String(
              (summary as { message?: string })?.message ||
                "Catalogue rows processed successfully.",
            )}
          </p>
          <DataTable
            headers={["Import result", "Rows"]}
            rows={Object.entries(
              (summary as { summary?: Record<string, unknown> })?.summary || {},
            ).map(([label, value]) => [
              label.replaceAll("_", " "),
              String(value),
            ])}
          />
          <div className="sd-form-actions">
            <Button onClick={onClose}>Done</Button>
          </div>
        </>
      )}
      <ErrorNotice error={error} />
    </>
  );
}
