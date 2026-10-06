"use client";
import { useEffect, useMemo, useState } from "react";
import type { QuantityInput } from "@/lib/domain/types";
import type {
  StockRequest,
  WarehouseStockView,
} from "@/lib/domain/stock-requests";
import {
  ApiError,
  api,
  businessDay,
  dateTime,
  requestId,
  useMutation,
} from "./client";
import {
  Badge,
  Button,
  DataTable,
  ErrorNotice,
  Field,
  Input,
  Modal,
  Panel,
  SearchInput,
  quantity,
  useApp,
} from "./ui";
import { QuantityEditor } from "./operations";
import { stockPreviewError } from "./stock-preview";

type PendingRequest = { requestId: string; data: Record<string, unknown> };
export function WarehousePage({ returns = false }: { returns?: boolean }) {
  const { state, refresh, notify, online } = useApp();
  const [vehicle, setVehicle] = useState(
    state.user.role === "owner"
      ? ""
      : state.vehicles.find((v) => v.active)?.id || "",
  );
  const [data, setData] = useState<WarehouseStockView | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState(1);
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("");
  const [kind, setKind] = useState<StockRequest["kind"] | null>(null),
    [selected, setSelected] = useState<StockRequest | null>(null);
  const [recovery, setRecovery] = useState<PendingRequest | null>(null),
    [recovering, setRecovering] = useState(false);
  const [rejectedRetry, setRejectedRetry] = useState(false);
  const storageKey = `sanket-stock-request:${state.user.id}`;

  const currentReport = useMemo(() => {
    return state.reports.find(r => r.vehicleId === vehicle && r.day === businessDay(state));
  }, [state.reports, vehicle, state]);
  const reportApproved = currentReport?.status === "APPROVED";

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      // Restore the persisted request from external browser storage after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setRecovery(JSON.parse(saved));
    } catch {
      /* Submitting will report a storage error before any network write. */
    }
  }, [storageKey]);
  useEffect(() => {
    let active = true;
    const q = new URLSearchParams({ page: String(page) });
    if (vehicle) q.set("vehicleId", vehicle);
    api<WarehouseStockView>(`/warehouse-stock?${q}`)
      .then((r) => {
        if (active) {
          setData(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [vehicle, page, state.serverTime]);
  const products = useMemo(
    () => new Map(state.products.map((p) => [p.id, p])),
    [state.products],
  );
  const activeVehicle = state.vehicles.find((v) => v.id === vehicle);
  const mutation = useMutation(async () => {
    await refresh();
    setSelected(null);
    notify("Decision recorded. Stock views refreshed.");
  });
  async function retryPending() {
    if (!recovery) return;
    setRejectedRetry(false);
    setRecovering(true);
    setError("");
    try {
      const r = await api<{ message: string }>("/action", {
        action: "inventory-request.create",
        ...recovery,
      });
      localStorage.removeItem(storageKey);
      setRecovery(null);
      notify(r.message);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setRejectedRetry(
        e instanceof ApiError && e.status >= 400 && e.status < 500,
      );
    } finally {
      setRecovering(false);
    }
  }
  return (
    <>
      <div className="sd-toolbar">
        <Field label="Vehicle">
          <select
            value={vehicle}
            onChange={(e) => {
              setVehicle(e.target.value);
              setPage(1);
              setData(null);
            }}
          >
            {state.user.role === "owner" && (
              <option value="">All vehicles · request history</option>
            )}
            {state.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Button variant="secondary" onClick={refresh}>
          Refresh stock
        </Button>
        {returns ? (
          <>
            <Button
              title={reportApproved ? "" : "Daily report must be submitted and approved first."}
              disabled={!activeVehicle || !online || !!recovery || !reportApproved}
              onClick={() => setKind("RETURN")}
            >
              Unload to warehouse
            </Button>
            <Button
              title={reportApproved ? "" : "Daily report must be submitted and approved first."}
              variant="secondary"
              disabled={!activeVehicle || !online || !!recovery || !reportApproved}
              onClick={() => setKind("HOLD")}
            >
              Hold all stock in vehicle
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={!activeVehicle || !online || !!recovery}
              onClick={() => setKind("ALLOCATION")}
            >
              Request additional stock
            </Button>
            <Button
              variant="secondary"
              disabled={!activeVehicle || !online || !!recovery}
              onClick={() => setKind("ADJUSTMENT")}
            >
              Report discrepancy
            </Button>
          </>
        )}
      </div>
      <ErrorNotice error={error} />
      {recovery && (
        <div className="sd-notice sd-warning">
          <p>
            A saved stock request needs its server outcome checked. Retrying
            uses the original request ID and cannot post a duplicate request.
          </p>
          <p>
            {String(recovery.data.kind)} · {String(recovery.data.reason)}
          </p>
          {rejectedRetry && (
            <Button
              variant="secondary"
              onClick={() => {
                localStorage.removeItem(storageKey);
                setRecovery(null);
                setRejectedRetry(false);
                setError("");
              }}
            >
              Discard rejected draft and review a new request
            </Button>
          )}
          <Button busy={recovering} onClick={retryPending}>
            Check / retry saved request
          </Button>
        </div>
      )}
      {!data && !error && <p role="status">Loading live stock…</p>}
      {data && (
        <>
          {returns ? (
            <Panel
              title="Return to Warehouse"
              subtitle={`Business date ${data.day} · carried stock and today's movements`}
            >
              <DataTable
                headers={[
                  "Product",
                  "Opening + assigned today",
                  "Net sold today",
                  "Unloaded today",
                  "Currently in vehicle",
                ]}
                rows={data.journey.map((r) => {
                  const p = products.get(r.productId);
                  return [
                    p?.name || r.productId,
                    `${quantity(r.opening, p)} + ${quantity(r.loaded, p)}`,
                    r.sold < 0
                      ? `Reversed ${quantity(-r.sold, p)}`
                      : quantity(r.sold, p),
                    quantity(r.returned, p),
                    quantity(r.current, p),
                  ];
                })}
              />
              <p className="sd-notice">
                Current vehicle stock includes all confirmed movements. Unloaded
                quantities move only after owner approval; everything else
                remains available in the vehicle. Pending requests do not
                reserve stock.
              </p>
            </Panel>
          ) : (
            <Panel
              title="Warehouse Stock"
              subtitle="Home warehouse availability and aggregate stock already assigned to vehicles"
            >
              <div className="sd-toolbar">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search product or SKU…"
                />
                <select
                  aria-label="Product category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">All categories</option>
                  {[...new Set(state.products.map((p) => p.category))].map(
                    (c) => (
                      <option key={c}>{c}</option>
                    ),
                  )}
                </select>
              </div>
              <DataTable
                headers={[
                  "Warehouse / location",
                  "Product / SKU",
                  "Available to load",
                  "Assigned to vehicles",
                  "Total on hand",
                  "Last warehouse update",
                ]}
                rows={data.rows
                  .filter((r) => {
                    const p = products.get(r.productId);
                    return (
                      (!activeVehicle ||
                        r.warehouseId === activeVehicle.warehouseId) &&
                      (!category || p?.category === category) &&
                      `${p?.name} ${p?.sku}`
                        .toLowerCase()
                        .includes(search.toLowerCase())
                    );
                  })
                  .map((r) => {
                    const p = products.get(r.productId),
                      w = state.warehouses.find((w) => w.id === r.warehouseId);
                    return [
                      `${w?.name} · ${state.locations.find((l) => l.id === w?.locationId)?.name || ""}`,
                      `${p?.name} / ${p?.sku || "—"}${p?.active ? "" : " (inactive)"}`,
                      quantity(r.available, p),
                      quantity(r.allocated, p),
                      quantity(r.total, p),
                      r.lastUpdate ? dateTime(r.lastUpdate) : "No movements",
                    ];
                  })}
              />
              <p className="sd-notice">
                Only warehouse availability can be requested. Vehicle stock is
                already allocated and is not counted again as available. Order
                reservations are not part of this workspace.
              </p>
              {activeVehicle && (
                <>
                  <h3>My current vehicle stock · {activeVehicle.name}</h3>
                  <DataTable
                    headers={["Product", "Available in vehicle"]}
                    rows={data.journey.map((r) => [
                      products.get(r.productId)?.name,
                      quantity(r.current, products.get(r.productId)),
                    ])}
                  />
                </>
              )}
            </Panel>
          )}
          <Panel
            title="Requests & return history"
            subtitle={`${data.total} records · pending requests await owner review`}
          >
            <DataTable
              headers={[
                "Reference / date",
                "Type",
                "Salesman / vehicle",
                "Warehouse",
                "Status",
                "Action",
              ]}
              rows={data.requests.map((r) => [
                `${r.reference.slice(0, 16)} · ${dateTime(r.createdAt)}`,
                r.kind,
                `${r.salesmanName} · ${r.vehicleName}`,
                r.warehouseName,
                <Badge key="status">{r.status}</Badge>,
                <Button
                  key="view"
                  variant="secondary"
                  onClick={() => setSelected(r)}
                >
                  Review details
                </Button>,
              ])}
            />
            <div className="sd-form-actions">
              <Button
                variant="secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span>Page {page}</span>
              <Button
                variant="secondary"
                disabled={!data.hasMore}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </Panel>
        </>
      )}
      <Modal
        open={!!kind}
        onClose={() => setKind(null)}
        title={
          kind === "RETURN"
            ? "Unload stock to warehouse"
            : kind === "HOLD"
              ? "Hold stock in vehicle"
              : kind === "ADJUSTMENT"
                ? "Stock discrepancy request"
                : "Request warehouse stock"
        }
        wide
      >
        {kind && data && activeVehicle && (
          <RequestForm
            kind={kind}
            vehicleId={vehicle}
            data={data}
            storageKey={storageKey}
            onPending={setRecovery}
            onError={setError}
            onClose={() => setKind(null)}
          />
        )}
      </Modal>
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Stock request details"
        wide
      >
        {selected && (
          <RequestDetails
            request={selected}
            busy={mutation.busy}
            error={mutation.error}
            onDecide={async (decision, reason) => {
              try {
                await mutation.run(`inventory-request.${decision}`, {
                  id: selected.id,
                  reason,
                });
              } catch {
                /* error stays in the dialog */
              }
            }}
          />
        )}
      </Modal>
    </>
  );
}
function RequestForm({
  kind,
  vehicleId,
  data,
  storageKey,
  onPending,
  onError,
  onClose,
}: {
  kind: StockRequest["kind"];
  vehicleId: string;
  data: WarehouseStockView;
  storageKey: string;
  onPending: (v: PendingRequest | null) => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const { state, refresh, notify } = useApp();
  const [lines, setLines] = useState<QuantityInput[]>([
    { productId: "", packagingId: "", unitCode: "", quantity: 1 },
  ]);
  const [reason, setReason] = useState(""),
    [productId, setProduct] = useState(""),
    [delta, setDelta] = useState("");
  const [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const vehicle = state.vehicles.find((v) => v.id === vehicleId)!;
  const source = kind === "RETURN" ? vehicleId : vehicle.warehouseId;
  const balances = [
    ...state.balances.filter((b) => b.locationType === "vehicle"),
    ...data.rows.map((r) => ({
      locationId: r.warehouseId,
      locationType: "warehouse" as const,
      productId: r.productId,
      quantity: r.available,
    })),
  ];
  const validation =
    kind === "RETURN" || kind === "ALLOCATION"
      ? stockPreviewError(lines, state.products, balances, source)
      : kind === "ADJUSTMENT" &&
          (!productId || !Number.isSafeInteger(Number(delta)) || !Number(delta))
        ? "Select a product and enter a nonzero whole-number difference."
        : "";
  async function submit() {
    setBusy(true);
    setError("");
    const pending: PendingRequest = {
      requestId: requestId(),
      data: {
        kind,
        vehicleId,
        assignmentId: state.assignments.find(
          (a) => a.vehicleId === vehicleId && !a.to,
        )?.id,
        day: businessDay(state),
        reason,
        lines: kind === "RETURN" || kind === "ALLOCATION" ? lines : [],
        ...(kind === "ADJUSTMENT"
          ? {
              productId,
              packagingId: state.products.find((p) => p.id === productId)
                ?.packaging?.id,
              delta: Number(delta),
            }
          : {}),
      },
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(pending));
      onPending(pending);
      const r = await api<{ message: string }>("/action", {
        action: "inventory-request.create",
        ...pending,
      });
      localStorage.removeItem(storageKey);
      onPending(null);
      notify(r.message);
      onClose();
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Request failed");
      onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!review) {
          setReview(true);
          return;
        }
        void submit();
      }}
    >
      <p className="sd-notice">
        {vehicle.name} →{" "}
        {state.warehouses.find((w) => w.id === vehicle.warehouseId)?.name}.{" "}
        {kind === "HOLD"
          ? "All current stock stays in the vehicle. No warehouse movement is posted."
          : "Your owner must approve this request before stock changes."}
      </p>
      {!review ? (
        <>
          {(kind === "RETURN" || kind === "ALLOCATION") && (
            <QuantityEditor
              lines={lines}
              onChange={setLines}
              products={state.products}
            />
          )}{" "}
          {kind === "ADJUSTMENT" && (
            <div className="sd-form">
              <Field label="Product">
                <select
                  required
                  value={productId}
                  onChange={(e) => setProduct(e.target.value)}
                >
                  <option value="">Select product</option>
                  {state.products
                    .filter((p) => p.packaging)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field
                label={`Difference in ${state.products.find((p) => p.id === productId)?.packaging?.baseUnit || "base units"}`}
                hint="Positive adds missing stock; negative removes excess recorded stock. Owner approval required."
              >
                <Input
                  required
                  type="number"
                  step="1"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                />
              </Field>
            </div>
          )}
          <Field label="Reason">
            <textarea
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <>
          <h3>Review request</h3>
          <p>{reason}</p>
          {kind === "HOLD" ? (
            <DataTable
              headers={["Product", "Keep in vehicle"]}
              rows={data.journey.map((r) => [
                state.products.find((p) => p.id === r.productId)?.name,
                quantity(
                  r.current,
                  state.products.find((p) => p.id === r.productId),
                ),
              ])}
            />
          ) : kind === "ADJUSTMENT" ? (
            <p>
              {state.products.find((p) => p.id === productId)?.name}: {delta}{" "}
              base units
            </p>
          ) : (
            <DataTable
              headers={[
                "Product",
                "Requested",
                "Current source stock",
                "Source stock after approval",
              ]}
              rows={lines.map((l) => {
                const p = state.products.find((p) => p.id === l.productId),
                  available =
                    balances.find(
                      (b) =>
                        b.locationId === source && b.productId === l.productId,
                    )?.quantity || 0,
                  total = lines
                    .filter((x) => x.productId === l.productId)
                    .reduce(
                      (n, x) =>
                        n +
                        x.quantity *
                          (p?.packaging?.levels.find(
                            (k) => k.code === x.unitCode,
                          )?.factor || 1),
                      0,
                    );
                return [
                  p?.name,
                  `${l.quantity} ${l.unitCode}`,
                  quantity(available, p),
                  available >= total
                    ? quantity(available - total, p)
                    : "Insufficient stock",
                ];
              })}
            />
          )}
        </>
      )}
      <ErrorNotice error={error || validation} />
      <div className="sd-form-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => (review ? setReview(false) : onClose())}
        >
          {review ? "Back" : "Cancel"}
        </Button>
        <Button busy={busy} disabled={!!validation || reason.trim().length < 3}>
          {review
            ? kind === "HOLD"
              ? "Confirm hold"
              : "Submit for approval"
            : "Review request"}
        </Button>
      </div>
    </form>
  );
}
function RequestDetails({
  request: r,
  busy,
  error,
  onDecide,
}: {
  request: StockRequest;
  busy: boolean;
  error: string;
  onDecide: (decision: string, reason: string) => Promise<void>;
}) {
  const { state } = useApp();
  const [decision, setDecision] = useState(""),
    [reason, setReason] = useState("");
  const requested = new Map<string, number>();
  for (const l of r.lines)
    requested.set(
      l.productId,
      (requested.get(l.productId) || 0) + l.baseQuantity,
    );
  const ids = [
    ...new Set([
      ...r.vehicleSnapshot.map((x) => x.productId),
      ...r.lines.map((x) => x.productId),
    ]),
  ];
  return (
    <>
      <p className="sd-mono">{r.reference}</p>
      <p>
        {r.salesmanName} · {r.vehicleName} · {r.warehouseName}
      </p>
      <p>
        {dateTime(r.createdAt)} · {r.kind} · <Badge>{r.status}</Badge>
      </p>
      <p>{r.reason}</p>
      <DataTable
        headers={[
          "Product",
          "Vehicle at submission",
          "Requested base units",
          "Vehicle at completion",
        ]}
        rows={ids.map((id) => {
          const p = state.products.find((p) => p.id === id),
            l = r.lines.find((l) => l.productId === id);
          return [
            l?.productName || p?.name,
            `${r.vehicleSnapshot.find((x) => x.productId === id)?.quantity || 0} ${l?.baseUnit || p?.packaging?.baseUnit || "base"}`,
            `${requested.get(id) || 0} ${l?.baseUnit || p?.packaging?.baseUnit || "base"}`,
            r.completionStock
              ? `${r.completionStock.find((x) => x.productId === id)?.quantity || 0} ${l?.baseUnit || p?.packaging?.baseUnit || "base"}`
              : r.status === "REJECTED"
                ? "No movement"
                : "Awaiting decision",
          ];
        })}
      />
      {r.documentId && (
        <p>
          Confirmed movement: <span className="sd-mono">{r.documentId}</span>
        </p>
      )}
      {r.decidedAt && (
        <p>
          {r.decidedName} · {dateTime(r.decidedAt)} · {r.decisionReason}
        </p>
      )}
      {r.status === "PENDING" && state.user.role === "owner" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onDecide(decision, reason);
          }}
        >
          <p className="sd-notice">
            Approval rechecks live stock and posts on the current open business
            date. Quantities shown at submission are historical.
          </p>
          <Field label="Decision">
            <select
              required
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            >
              <option value="">Choose decision</option>
              <option value="approve">Approve and post stock movement</option>
              <option value="reject">Reject without changing stock</option>
            </select>
          </Field>
          <Field label="Confirmation reason">
            <textarea
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <ErrorNotice error={error} />
          <div className="sd-form-actions">
            <Button
              busy={busy}
              disabled={!decision || reason.trim().length < 3}
            >
              Confirm {decision || "decision"}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
