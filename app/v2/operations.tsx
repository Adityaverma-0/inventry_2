"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { stockPreviewError } from "./stock-preview";
import { Download, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import type {
  Product,
  QuantityInput,
  Sale,
  Transfer,
  TransactionLine,
} from "@/lib/domain/types";
import {
  api,
  activeVehicleDay,
  dateTime,
  outboxPut,
  requestId,
  useMutation,
  useHistory,
  type OutboxEntry,
} from "./client";
import {
  HistoryPagination,
  Badge,
  Button,
  DataTable,
  Empty,
  ErrorNotice,
  Field,
  formatLevels,
  Input,
  Modal,
  Panel,
  ProductName,
  quantity,
  SearchInput,
  useApp,
} from "./ui";
export function QuantityEditor({
  lines,
  onChange,
  products,
  locationId,
}: {
  lines: QuantityInput[];
  onChange: (lines: QuantityInput[]) => void;
  products: Product[];
  locationId?: string;
}) {
  const { state } = useApp();
  const lookup = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const balance = useMemo(
    () =>
      new Map(
        state.balances
          .filter((b) => b.locationId === locationId)
          .map((b) => [b.productId, b.quantity]),
      ),
    [state.balances, locationId],
  );
  function update(i: number, patch: Partial<QuantityInput>) {
    onChange(lines.map((l, j) => (i === j ? { ...l, ...patch } : l)));
  }
  return (
    <div>
      {lines.map((line, i) => {
        const p = lookup.get(line.productId);
        const factor =
          p?.packaging?.levels.find((l) => l.code === line.unitCode)?.factor ||
          1;
        return (
          <div key={i}>
            <div className="sd-line-editor">
              <Field label={`Product ${i + 1}`}>
                <select
                  value={line.productId}
                  required
                  onChange={(e) => {
                    const p = lookup.get(e.target.value);
                    update(i, {
                      productId: e.target.value,
                      packagingId: p?.packaging?.id || "",
                      unitCode: p?.packaging?.baseUnit || "",
                    });
                  }}
                >
                  <option value="">Choose a product</option>
                  {products
                    .filter((p) => p.active && p.ready)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{" "}
                        {locationId
                          ? `· ${balance.get(p.id) || 0} base units`
                          : ""}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Quantity">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={line.quantity || ""}
                  onChange={(e) =>
                    update(i, { quantity: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Unit">
                <select
                  value={line.unitCode}
                  required
                  onChange={(e) => update(i, { unitCode: e.target.value })}
                >
                  <option value="">Unit</option>
                  {p?.packaging?.levels.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                className="sd-icon-button"
                type="button"
                aria-label={`Remove product line ${i + 1}`}
                onClick={() => onChange(lines.filter((_, j) => j !== i))}
              >
                <Trash2 size={17} />
              </button>
            </div>
            {p && (
              <div className="sd-line-summary">
                {line.quantity * factor} {p.packaging?.baseUnit} ·{" "}
                {quantity(line.quantity * factor, p)} · configuration v
                {p.packaging?.version}
                {locationId
                  ? ` · available ${quantity(balance.get(p.id) || 0, p)}`
                  : ""}
              </div>
            )}
          </div>
        );
      })}
      <Button
        type="button"
        variant="secondary"
        onClick={() =>
          onChange([
            ...lines,
            { productId: "", packagingId: "", unitCode: "", quantity: 1 },
          ])
        }
      >
        <Plus size={14} />
        Add product line
      </Button>
      {!products.some((p) => p.ready && p.active) && (
        <div className="sd-notice sd-warning">
          There are no operationally ready products. Configure product packaging
          before continuing.
        </div>
      )}
    </div>
  );
}
function StockReview({
  lines,
  sourceId,
  destinationId,
}: {
  lines: QuantityInput[];
  sourceId?: string;
  destinationId?: string;
}) {
  const { state } = useApp();
  const products = useMemo(
    () => new Map(state.products.map((p) => [p.id, p])),
    [state.products],
  );
  const combined = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) {
      const p = products.get(l.productId);
      const f =
        p?.packaging?.levels.find((u) => u.code === l.unitCode)?.factor || 0;
      m.set(l.productId, (m.get(l.productId) || 0) + l.quantity * f);
    }
    return [...m];
  }, [lines, products]);
  const error = stockPreviewError(
    lines,
    state.products,
    state.balances,
    sourceId,
    destinationId,
  );
  if (error) return <ErrorNotice error={error} />;
  return (
    <DataTable
      headers={[
        "Product",
        "Quantity effect",
        ...(sourceId ? ["Source after"] : []),
        ...(destinationId ? ["Destination after"] : []),
      ]}
      rows={combined.map(([id, n]) => {
        const p = products.get(id);
        return [
          p?.name,
          // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
          <div>
            {quantity(n, p)}
            <small className="sd-sub">
              {n} base units · v{p?.packaging?.version}
            </small>
          </div>,
          ...(sourceId
            ? [
                quantity(
                  (state.balances.find(
                    (b) => b.locationId === sourceId && b.productId === id,
                  )?.quantity || 0) - n,
                  p,
                ),
              ]
            : []),
          ...(destinationId
            ? [
                quantity(
                  (state.balances.find(
                    (b) => b.locationId === destinationId && b.productId === id,
                  )?.quantity || 0) + n,
                  p,
                ),
              ]
            : []),
        ];
      })}
    />
  );
}
export function InventoryPage() {
  const { state } = useApp();
  const owner = state.user.role === "owner";
  const [location, setLocation] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("stock");
  const [form, setForm] = useState<"receipt" | "adjust" | null>(null);
  const products = useMemo(
    () => new Map(state.products.map((p) => [p.id, p])),
    [state.products],
  );
  const locationNames = useMemo(
    () =>
      new Map(
        [...state.warehouses, ...state.vehicles].map((l) => [l.id, l.name]),
      ),
    [state.warehouses, state.vehicles],
  );
  const filtered = state.balances.filter(
    (b) =>
      (!location || b.locationId === location) &&
      products
        .get(b.productId)
        ?.name.toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="sd-toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search stock by product…"
        />
        <select
          aria-label="Stock location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        >
          <option value="">All authorised stock locations</option>
          {(owner
            ? [...state.warehouses, ...state.vehicles]
            : state.vehicles
          ).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {owner && (
          <>
            <Button variant="secondary" onClick={() => setForm("adjust")}>
              <SlidersHorizontal size={14} />
              Adjust stock
            </Button>
            <Button onClick={() => setForm("receipt")}>
              <Plus size={15} />
              Receive stock
            </Button>
          </>
        )}
        <a
          className="sd-btn sd-secondary"
          href={`/api/v2/export?kind=stock&locationId=${location}`}
        >
          <Download size={14} />
          CSV
        </a>
      </div>
      <div className="sd-tabs">
        <button
          className={tab === "stock" ? "active" : ""}
          onClick={() => setTab("stock")}
        >
          Current stock
        </button>
        <button
          className={tab === "movements" ? "active" : ""}
          onClick={() => setTab("movements")}
        >
          Movement ledger
        </button>
      </div>
      <Panel
        title={
          tab === "stock" ? "Live committed stock" : "Stock movement history"
        }
        subtitle={
          tab === "stock"
            ? "Current packaging versions · normalized larger units and remainders"
            : "Signed changes in canonical base units · no mixed-product quantity totals"
        }
      >
        {tab === "stock" ? (
          <DataTable
            headers={[
              "Product",
              "Location",
              "Current quantity",
              "Base quantity",
              "Threshold",
              "Status",
            ]}
            rows={filtered.map((b) => {
              const p = products.get(b.productId);
              return [
                // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
                <ProductName product={p} />,
                // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
                <div>
                  {locationNames.get(b.locationId)}
                  <small className="sd-sub">{b.locationType}</small>
                </div>,
                // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
                <div>
                  {quantity(b.quantity, p)}
                  <small className="sd-sub">
                    Configuration v{p?.packaging?.version || "—"}
                  </small>
                </div>,
                `${b.quantity} ${p?.packaging?.baseUnit || ""}`,
                p?.minStock || "—",
                // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
                <Badge tone={p && p.minStock > b.quantity ? "amber" : "green"}>
                  {p && p.minStock > b.quantity
                    ? "Low stock"
                    : b.quantity
                      ? "Available"
                      : "No stock"}
                </Badge>,
              ];
            })}
            empty="No committed stock at this location"
          />
        ) : (
          <DataTable
            headers={[
              "Date / actor",
              "Product",
              "Location",
              "Movement",
              "Base-unit change",
              "Reference / note",
            ]}
            rows={state.movements
              .filter(
                (m) =>
                  (!location || m.locationId === location) &&
                  products
                    .get(m.productId)
                    ?.name.toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((m) => [
                // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
                <div>
                  {dateTime(m.createdAt, state.settings.timezone)}
                  <small className="sd-sub">{m.actorName}</small>
                </div>,
                products.get(m.productId)?.name,
                locationNames.get(m.locationId),
                // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
                <Badge>{m.kind}</Badge>,
                `${m.quantity > 0 ? "+" : ""}${m.quantity} ${products.get(m.productId)?.packaging?.baseUnit || "base units"}`,
                // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
                <div className="sd-mono">
                  {m.reference}
                  <small className="sd-sub">{m.note}</small>
                </div>,
              ])}
          />
        )}
      </Panel>
      {form === "receipt" && <ReceiptForm onClose={() => setForm(null)} />}{" "}
      {form === "adjust" && <AdjustmentForm onClose={() => setForm(null)} />}
    </>
  );
}
function ReceiptForm({ onClose }: { onClose: () => void }) {
  const { state, refresh, notify, online } = useApp();
  const [warehouseId, setWarehouse] = useState(
    state.warehouses.find((w) => w.active)?.id || "",
  );
  const [lines, setLines] = useState<QuantityInput[]>([
    { productId: "", packagingId: "", unitCode: "", quantity: 1 },
  ]);
  const [review, setReview] = useState(false);
  const reviewError = stockPreviewError(
    lines,
    state.products,
    state.balances,
    undefined,
    warehouseId,
  );
  const [kind, setKind] = useState("MANUAL_RECEIPT");
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  const mutation = useMutation(refresh);
  return (
    <Modal
      open
      onClose={onClose}
      title={review ? "Review stock receipt" : "Receive warehouse stock"}
      description="Use purchase invoices for invoice-backed deliveries. Opening and manual entries require your approval."
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!review) {
            setReview(true);
            return;
          }
          if (reviewError) return;
          try {
            const r = await mutation.run("stock.receive", {
              warehouseId,
              kind,
              lines,
              notes,
              reference,
            });
            notify(r.message || "Stock received");
            onClose();
          } catch {}
        }}
      >
        {!review ? (
          <>
            <div className="sd-form" style={{ marginBottom: 22 }}>
              <Field label="Destination godown">
                <select
                  value={warehouseId}
                  onChange={(e) => setWarehouse(e.target.value)}
                  required
                >
                  {state.warehouses
                    .filter((w) => w.active)
                    .map((w) => (
                      <option value={w.id} key={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Receipt type">
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="MANUAL_RECEIPT">
                    Manual receipt (no supplier invoice)
                  </option>
                  <option value="OPENING">Approved opening stock</option>
                </select>
              </Field>
            </div>
            <QuantityEditor
              lines={lines}
              onChange={setLines}
              products={state.products}
            />
            <div className="sd-form" style={{ marginTop: 20 }}>
              <Field
                label={
                  kind === "MANUAL_RECEIPT"
                    ? "Original delivery reference (required)"
                    : "Opening-stock reference (required)"
                }
                hint={
                  kind === "MANUAL_RECEIPT"
                    ? "Enter the original delivery-note or supplier invoice number exactly as issued. The same reference cannot receive stock twice in one godown. Use Purchase Invoices for invoice-backed deliveries; do not create a different reference for the same goods."
                    : "Enter a unique opening-stock approval reference for this godown."
                }
              >
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={
                    kind === "MANUAL_RECEIPT"
                      ? "Original delivery / invoice number"
                      : "Opening-stock approval reference"
                  }
                  required
                  pattern=".*\S.*"
                  title="Enter a reference containing at least one non-space character."
                />
              </Field>
              <Field label="Reason / notes">
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  required
                />
              </Field>
            </div>
          </>
        ) : (
          <>
            <div className="sd-notice">
              Approve {kind === "OPENING" ? "opening stock" : "manual receipt"}{" "}
              into{" "}
              <strong>
                {state.warehouses.find((w) => w.id === warehouseId)?.name}
              </strong>
              . Reference: {reference}. {notes}
            </div>
            <StockReview lines={lines} destinationId={warehouseId} />
            <label className="sd-check" style={{ marginTop: 20 }}>
              <input type="checkbox" required />I verified received quantities
              and this delivery has not been entered elsewhere.
            </label>
          </>
        )}
        <ErrorNotice error={mutation.error} />
        <div className="sd-form-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => (review ? setReview(false) : onClose())}
          >
            {review ? "Back" : "Cancel"}
          </Button>
          <Button
            busy={mutation.busy}
            disabled={!online || !lines.length || (review && !!reviewError)}
          >
            {review ? "Approve & receive stock" : "Review receipt"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function AdjustmentForm({ onClose }: { onClose: () => void }) {
  const { state, refresh, notify, online } = useApp();
  const mutation = useMutation(refresh);
  const [location, setLocation] = useState(state.warehouses[0]?.id || "");
  const [product, setProduct] = useState("");
  const [delta, setDelta] = useState(0);
  const p = state.products.find((p) => p.id === product);
  const balance =
    state.balances.find(
      (b) => b.locationId === location && b.productId === product,
    )?.quantity || 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="Audited stock adjustment"
      description="Enter a signed change in canonical base units. This posts a separate stock movement."
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await mutation.run("stock.adjust", {
              locationId: location,
              locationType: state.warehouses.some((w) => w.id === location)
                ? "warehouse"
                : "vehicle",
              productId: product,
              delta,
              reason: f.get("reason"),
              sourceInvoiceId: f.get("sourceInvoiceId") || undefined,
            });
            notify("Adjustment posted");
            onClose();
          } catch {}
        }}
      >
        <div className="sd-form">
          <Field label="Stock location">
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              required
            >
              {[...state.warehouses, ...state.vehicles].map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Product">
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              required
            >
              <option value="">Choose product</option>
              {state.products
                .filter((p) => p.ready)
                .map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field
            label={`Signed change (${p?.packaging?.baseUnit || "base units"})`}
            hint="For example, −3 removes 3 base units."
          >
            <Input
              type="number"
              step={1}
              value={delta}
              onChange={(e) => setDelta(Number(e.target.value))}
              required
            />
          </Field>
          <div className="sd-full">
            <Field
              label="Original invoice receipt (optional)"
              hint="Select the posted receipt when this adjustment corrects an invoice. Its original record is preserved."
            >
              <select name="sourceInvoiceId" key={location + product}>
                <option value="">No linked invoice receipt</option>
                {state.invoices
                  .filter(
                    (i) =>
                      i.status === "APPROVED_POSTED" &&
                      i.warehouseId === location &&
                      i.lines.some((l) => l.productId === product),
                  )
                  .map((i) => (
                    <option value={i.id} key={i.id}>
                      {i.supplier} · {i.invoiceNumber} · {i.receiptReference}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <Field label="Reason">
            <Input
              name="reason"
              required
              placeholder="Physical count, damage, or linked correction"
            />
          </Field>
        </div>
        <div className="sd-notice">
          Current: {quantity(balance, p)} → projected:{" "}
          {quantity(balance + delta, p)}
        </div>
        <label className="sd-check">
          <input type="checkbox" required />I reviewed and approve this quantity
          change.
        </label>
        <ErrorNotice error={mutation.error} />
        <div className="sd-form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={mutation.busy}
            disabled={!online || !delta || balance + delta < 0}
          >
            Post adjustment
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function LoadsPage() {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Transfer | null>(null);
  const [vehicle, setVehicle] = useState("");
  const history = useHistory<Transfer>(
    "transfers",
    { vehicleId: vehicle },
    state.serverTime,
  );
  return (
    <>
      <div className="sd-toolbar">
        <select
          aria-label="Filter vehicle"
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
        >
          <option value="">All vehicles</option>
          {state.vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <Button onClick={() => setOpen(true)}>
          <Plus size={15} />
          Create load
        </Button>
      </div>
      <Panel
        title="Transfer history"
        subtitle="Home-godown loads · posted quantities conserved across both locations"
      >
        <DataTable
          headers={[
            "Reference",
            "Posted",
            "From godown",
            "To vehicle",
            "Products",
            "Action",
          ]}
          rows={history.items
            .filter((t) => !vehicle || t.vehicleId === vehicle)
            .map((t) => [
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <span className="sd-mono">{t.reference}</span>,
              dateTime(t.createdAt),
              state.warehouses.find((w) => w.id === t.warehouseId)?.name,
              state.vehicles.find((v) => v.id === t.vehicleId)?.name,
              t.lines.length,
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <Button variant="secondary" onClick={() => setSelected(t)}>
                View load
              </Button>,
            ])}
        />
        <HistoryPagination {...history} />
      </Panel>
      {open && <LoadForm onClose={() => setOpen(false)} />}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={`Load ${selected?.reference || ""}`}
        wide
      >
        {selected && (
          <>
            <p className="sd-legend">
              {dateTime(selected.createdAt)} · posted by {selected.actorName}
            </p>
            <SnapshotLines lines={selected.lines} />
          </>
        )}
      </Modal>
    </>
  );
}
function LoadForm({ onClose }: { onClose: () => void }) {
  const { state, refresh, notify, online } = useApp();
  const [vehicleId, setVehicle] = useState(
    state.vehicles.find((v) => v.active)?.id || "",
  );
  const warehouseId =
    state.vehicles.find((v) => v.id === vehicleId)?.warehouseId || "";
  const [lines, setLines] = useState<QuantityInput[]>([
    { productId: "", packagingId: "", unitCode: "", quantity: 1 },
  ]);
  const [review, setReview] = useState(false);
  const reviewError = stockPreviewError(
    lines,
    state.products,
    state.balances,
    warehouseId,
    vehicleId,
  );
  const mutation = useMutation(refresh);
  return (
    <Modal
      open
      onClose={onClose}
      title={review ? "Review vehicle load" : "Create vehicle load"}
      description="Loading deducts the home godown and adds the same quantities to the vehicle in one operation."
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!review) {
            setReview(true);
            return;
          }
          if (reviewError) return;
          try {
            const r = await mutation.run("transfer.create", {
              warehouseId,
              vehicleId,
              lines,
            });
            notify(`Load posted · ${r.reference || ""}`);
            onClose();
          } catch {}
        }}
      >
        {!review ? (
          <>
            <div className="sd-form" style={{ marginBottom: 25 }}>
              <Field label="Destination vehicle">
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicle(e.target.value)}
                  required
                >
                  {state.vehicles
                    .filter((v) => v.active)
                    .map((v) => (
                      <option value={v.id} key={v.id}>
                        {v.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Source home godown">
                <Input
                  readOnly
                  value={
                    state.warehouses.find((w) => w.id === warehouseId)?.name ||
                    "No home godown"
                  }
                />
              </Field>
            </div>
            <QuantityEditor
              lines={lines}
              onChange={setLines}
              products={state.products}
              locationId={warehouseId}
            />
          </>
        ) : (
          <>
            <div className="sd-notice">
              {state.warehouses.find((w) => w.id === warehouseId)?.name} →{" "}
              {state.vehicles.find((v) => v.id === vehicleId)?.name}
            </div>
            <StockReview
              lines={lines}
              sourceId={warehouseId}
              destinationId={vehicleId}
            />
          </>
        )}
        <ErrorNotice error={mutation.error} />
        <div className="sd-form-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => (review ? setReview(false) : onClose())}
          >
            {review ? "Back" : "Cancel"}
          </Button>
          <Button
            disabled={
              !online ||
              !warehouseId ||
              !lines.length ||
              (review && !!reviewError)
            }
            busy={mutation.busy}
          >
            {review ? "Confirm & post load" : "Review load"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function SaleFormPage() {
  const { state, navigate } = useApp();
  return state.vehicles.length ? (
    <Panel
      title="New quantity sale"
      subtitle="Stock deducts when the server confirms the sale."
    >
      <SaleForm onClose={() => navigate("sales")} />
    </Panel>
  ) : (
    <Panel>
      <Empty
        title="No assigned vehicle"
        description="Ask your administrator to assign an active vehicle before posting a sale."
      />
    </Panel>
  );
}
export function SalesPage() {
  const { state, navigate } = useApp();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Sale | null>(null);
  const [correcting, setCorrecting] = useState<Sale | null>(null);
  const [search, setSearch] = useState("");
  const [day, setDay] = useState("");
  const [vehicle, setVehicle] = useState("");
  const history = useHistory<Sale>(
    "sales",
    { vehicleId: vehicle, from: day, to: day, search },
    state.serverTime,
  );
  return (
    <>
      <div className="sd-toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Invoice, customer or salesman…"
        />
        <Input
          type="date"
          aria-label="Sale business date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
        <select
          aria-label="Vehicle filter"
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
        >
          <option value="">All authorised vehicles</option>
          {state.vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          onClick={() => {
            setSearch("");
            setDay("");
            setVehicle("");
          }}
        >
          Clear filters
        </Button>
        <Button
          onClick={() =>
            state.user.role === "salesman"
              ? navigate("new-sale")
              : setOpen(true)
          }
        >
          <Plus size={15} />
          New sale
        </Button>
      </div>
      <Panel
        title={state.user.role === "owner" ? "Sales history" : "My sales"}
        subtitle="Historical quantities retain the packaging used at posting."
      >
        <DataTable
          headers={[
            "Reference / date",
            "Vehicle",
            "Salesman",
            "Lines",
            "Status",
            "Action",
          ]}
          rows={history.items
            .filter(
              (s) =>
                (!day || s.day === day) &&
                (!vehicle || s.vehicleId === vehicle),
            )
            .map((s) => [
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <div className="sd-mono">
                {s.reference}
                <small className="sd-sub">
                  {s.invoiceNumber} ·{" "}
                  {s.customerName || "Customer not recorded"}
                </small>
                <small className="sd-sub">{s.day}</small>
              </div>,
              state.vehicles.find((v) => v.id === s.vehicleId)?.name,
              s.salesmanName,
              s.lines.length,
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <Badge>{s.status}</Badge>,
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <Button variant="secondary" onClick={() => setSelected(s)}>
                View sale
              </Button>,
            ])}
        />
        <HistoryPagination {...history} />
      </Panel>
      <Modal open={open} onClose={() => setOpen(false)} title="New sale" wide>
        <SaleForm onClose={() => setOpen(false)} />
      </Modal>
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={`Sale ${selected?.reference || ""}`}
        wide
      >
        {selected && (
          <>
            <div className="sd-report-meta">
              <p>
                {selected.salesmanName} · {dateTime(selected.createdAt)}
                <br />
                {selected.notes || "No additional notes"}
              </p>
              <Badge>{selected.status}</Badge>
            </div>
            <SnapshotLines lines={selected.lines} />
            {(selected.replacesId || selected.replacedById) && (
              <div className="sd-notice">
                This record is linked to a correction. Original and replacement
                records are retained.
              </div>
            )}
            <div className="sd-form-actions">
              <a
                className="sd-btn sd-secondary"
                href={`/sales-invoice/${selected.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open / Print Invoice
              </a>
              {selected.status === "POSTED" && (
                <Button
                  onClick={() => {
                    setCorrecting(selected);
                    setSelected(null);
                  }}
                >
                  Correct / void sale
                </Button>
              )}
            </div>
          </>
        )}
      </Modal>
      {correcting && (
        <CorrectionForm sale={correcting} onClose={() => setCorrecting(null)} />
      )}
    </>
  );
}
function SaleForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { state, refresh, notify, online } = useApp();
  const [vehicleId, setVehicle] = useState(
    state.vehicles.find((v) => v.active)?.id || "",
  );
  const [lines, setLines] = useState<QuantityInput[]>([
    { productId: "", packagingId: "", unitCode: "", quantity: 1 },
  ]);
  const [customer, setCustomer] = useState({
    name: "",
    phone: "",
    address: "",
    gstin: "",
  });
  const [notes, setNotes] = useState("");
  const [review, setReview] = useState(false);
  const reviewError = stockPreviewError(
    lines,
    state.products,
    state.balances,
    vehicleId,
    undefined,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(requestId);
  const day = activeVehicleDay(state, vehicleId);
  const [attempt, setAttempt] = useState(false);
  const [tax, setTax] = useState("");
  const [discount, setDiscount] = useState("");

  const calculatedSubtotal = useMemo(() => {
    let sum = 0;
    for (const l of lines) {
      if (!l.productId || !l.quantity || !l.unitCode) continue;
      const p = state.products.find(x => x.id === l.productId);
      if (!p || !p.price || !p.packaging) continue;
      const factor = p.packaging.levels.find(level => level.code === l.unitCode)?.factor;
      const priceFactor = p.packaging.levels.find(level => level.code === p.priceUnit)?.factor;
      if (!factor || !priceFactor) continue;

      const baseQuantity = l.quantity * factor;
      const priceValue = Number(p.price);
      sum += (priceValue * baseQuantity) / priceFactor;
    }
    return sum;
  }, [lines, state.products]);

  const calculatedGrandTotal = useMemo(() => {
    return Math.max(0, calculatedSubtotal + Number(tax || 0) - Number(discount || 0));
  }, [calculatedSubtotal, tax, discount]);

  const assignmentId = state.assignments.find(
    (a) => a.vehicleId === vehicleId && !a.to,
  )?.id;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const printInvoice =
          (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
          "print";
        if (!review) {
          setReview(true);
          return;
        }
        if (reviewError) return;
        setBusy(true);
        setError("");
        const entry: OutboxEntry = {
          id,
          userId: state.user.id,
          data: { vehicleId, assignmentId, day, lines, notes, customer, tax: tax || undefined, discount: discount || undefined },
          createdAt: new Date().toISOString(),
          state: "Pending",
          error: "",
        };
        try {
          await outboxPut(entry);
          setAttempt(true);
          if (!online) {
            notify(
              "Sale saved on this device. It has not changed server stock. Open Sync Center when connected.",
            );
            onClose();
            return;
          }
          try {
            const r = await api<{
              id: string;
              reference?: string;
              message: string;
            }>("/action", {
              action: "sale.create",
              data: entry.data,
              requestId: id,
            });
            await outboxPut({
              ...entry,
              state: "Confirmed",
              reference: r.reference,
            });
            await refresh();
            notify(`Sale confirmed${r.reference ? " · " + r.reference : ""}`);
            onClose();
            if (printInvoice) router.push(`/sales-invoice/${r.id}`);
          } catch (e) {
            await outboxPut({
              ...entry,
              state: "Failed",
              error:
                e instanceof Error ? e.message : "Server outcome is uncertain",
            });
            throw e;
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Unable to save sale");
        } finally {
          setBusy(false);
        }
      }}
    >
      {!review ? (
        <>
          <div className="sd-form" style={{ marginBottom: 20 }}>
            <Field label="Vehicle">
              <select
                value={vehicleId}
                onChange={(e) => setVehicle(e.target.value)}
                required
              >
                {state.vehicles
                  .filter((v) => v.active)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Business date">
              <Input readOnly value={`${day} · ${state.settings.timezone}`} />
            </Field>
          </div>
          <QuantityEditor
            lines={lines}
            onChange={setLines}
            products={state.products}
            locationId={vehicleId}
          />
          <div className="sd-form" style={{ marginTop: 20 }}>
            {(["name", "phone", "address", "gstin"] as const).map((key) => (
              <Field key={key} label={`Customer ${key} (optional)`}>
                <Input
                  maxLength={1000}
                  value={customer[key]}
                  onChange={(e) =>
                    setCustomer({ ...customer, [key]: e.target.value })
                  }
                />
              </Field>
            ))}
          </div>
          <div className="sd-form" style={{ marginTop: 20 }}>
            <Field label="Discount Amount (₹)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
            <Field label="Tax Amount (₹)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
              />
            </Field>
          </div>
          <div className="sd-notice" style={{ marginTop: 15 }}>
            <strong>Subtotal: </strong> ₹{calculatedSubtotal.toFixed(2)} <br/>
            <strong>Grand Total: </strong> ₹{calculatedGrandTotal.toFixed(2)}
          </div>
          <div style={{ marginTop: 20 }}>
            <Field label="Notes (optional)">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </Field>
          </div>
        </>
      ) : (
        <>
          <div className="sd-notice">
            {state.vehicles.find((v) => v.id === vehicleId)?.name} · {day}
            <br />
            {online
              ? "Review quantities before confirming the sale."
              : "Offline preview. Displayed availability may be stale; stock is checked on sync."}
          </div>
          <StockReview lines={lines} sourceId={vehicleId} />
          {customer.name && (
            <p>
              Customer: {customer.name} · {customer.phone}
            </p>
          )}
          {notes && <p style={{ marginTop: 15 }}>{notes}</p>}
        </>
      )}
      <ErrorNotice error={error} />
      {attempt && error && (
        <div className="sd-notice sd-warning">
          This request is preserved in Sync Center. Retry there using the same
          request; avoid entering this sale again.
        </div>
      )}
      <div className="sd-form-actions">
        {review && online && (
          <Button
            type="submit"
            value="print"
            variant="secondary"
            busy={busy}
            disabled={!lines.length || !vehicleId || attempt || !!reviewError}
          >
            Confirm & Print Invoice
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={() => (review && !attempt ? setReview(false) : onClose())}
        >
          {review && !attempt ? "Back" : "Close"}
        </Button>
        <Button
          busy={busy}
          disabled={
            !lines.length || !vehicleId || attempt || (review && !!reviewError)
          }
        >
          {review
            ? online
              ? "Confirm & post sale"
              : "Save pending sale on device"
            : "Review sale"}
        </Button>
      </div>
    </form>
  );
}
export function SnapshotLines({ lines }: { lines: TransactionLine[] }) {
  return (
    <DataTable
      headers={[
        "Product",
        "Entered quantity",
        "Base equivalent",
        "Packaging at posting",
      ]}
      rows={lines.map((l) => [
        l.productName,
        `${l.quantity} ${l.levels.find((u) => u.code === l.unitCode)?.label || l.unitCode}`,
        // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
        <div>
          {l.baseQuantity} {l.baseUnit}
          <small className="sd-sub">
            {formatLevels(l.baseQuantity, l.levels, l.baseUnit)}
          </small>
        </div>,
        // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
        <span className="sd-legend">
          {l.levels.map((u) => `${u.label} = ${u.factor}`).join(" · ")}
        </span>,
      ])}
    />
  );
}
function CorrectionForm({
  sale,
  onClose,
}: {
  sale: Sale;
  onClose: () => void;
}) {
  const { state, refresh, notify, online } = useApp();
  const [voidSale, setVoid] = useState(false);
  const [lines, setLines] = useState<QuantityInput[]>([
    { productId: "", packagingId: "", unitCode: "", quantity: 1 },
  ]);
  const mutation = useMutation(refresh);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Correct ${sale.reference}`}
      description="The original remains in history. Its quantities are reversed and replacement quantities posted together."
      wide
    >
      <SnapshotLines lines={sale.lines} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await mutation.run("sale.correct", {
              saleId: sale.id,
              lines: voidSale ? [] : lines,
              reason: f.get("reason"),
              void: voidSale,
            });
            notify("Sale correction posted");
            onClose();
          } catch {}
        }}
      >
        <label className="sd-check" style={{ margin: "22px 0" }}>
          <input
            type="checkbox"
            checked={voidSale}
            onChange={(e) => setVoid(e.target.checked)}
          />
          Void this sale entirely (no replacement)
        </label>
        {!voidSale && (
          <>
            <div className="sd-notice">
              Enter the complete corrected sale using current packaging. Review
              any changed ratios against the original above.
            </div>
            <QuantityEditor
              lines={lines}
              onChange={setLines}
              products={state.products}
            />
          </>
        )}
        <Field label="Required correction reason">
          <textarea name="reason" rows={2} required />
        </Field>
        <label className="sd-check" style={{ marginTop: 15 }}>
          <input type="checkbox" required />I confirm the replacement quantities
          and reason.
        </label>
        <ErrorNotice error={mutation.error} />
        <div className="sd-form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={mutation.busy}
            disabled={!online || (!voidSale && !lines.length)}
          >
            {voidSale ? "Confirm void" : "Post linked correction"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
