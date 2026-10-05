"use client";
import { useMemo, useState } from "react";
import { MapPin, Plus, Truck, Users, Warehouse } from "lucide-react";
import type {
  Actor,
  Location,
  Vehicle,
  Warehouse as WarehouseType,
} from "@/lib/domain/types";
import { api, dateTime, requestId, useMutation } from "./client";
import {
  Badge,
  Button,
  DataTable,
  ErrorNotice,
  Field,
  Input,
  Modal,
  Panel,
  ProductName,
  quantity,
  SearchInput,
  useApp,
} from "./ui";
export function LocationsPage() {
  const { state, refresh, notify } = useApp();
  const [edit, setEdit] = useState<{
    kind: "location" | "warehouse";
    item?: Location | WarehouseType;
  } | null>(null);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const mutation = useMutation(refresh);
  const products = useMemo(
    () => new Map(state.products.map((p) => [p.id, p])),
    [state.products],
  );
  return (
    <>
      <div className="sd-toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search godowns or locations…"
        />
        <Button
          variant="secondary"
          onClick={() => setEdit({ kind: "location" })}
        >
          <Plus size={15} />
          Add location
        </Button>
        <Button onClick={() => setEdit({ kind: "warehouse" })}>
          <Plus size={15} />
          Add godown
        </Button>
      </div>
      <div className="sd-grid sd-grid-3">
        {state.warehouses
          .filter((w) =>
            `${w.name} ${state.locations.find((l) => l.id === w.locationId)?.name}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((w) => (
            <Panel key={w.id}>
              <div className="sd-inline" style={{ marginBottom: 19 }}>
                <span className="sd-fleet-icon">
                  <Warehouse size={20} />
                </span>
                <div>
                  <h2>{w.name}</h2>
                  <small>
                    {state.locations.find((l) => l.id === w.locationId)?.name}
                  </small>
                </div>
              </div>
              <div className="sd-info-grid">
                <div>
                  <small>Stocked products</small>
                  <strong>
                    {
                      state.balances.filter(
                        (b) => b.locationId === w.id && b.quantity > 0,
                      ).length
                    }
                  </strong>
                </div>
                <div>
                  <small>Home vehicles</small>
                  <strong>
                    {
                      state.vehicles.filter((v) => v.warehouseId === w.id)
                        .length
                    }
                  </strong>
                </div>
              </div>
              <div className="sd-split-row">
                <Badge>{w.active ? "Active" : "Inactive"}</Badge>
                <div className="sd-row-actions">
                  <Button
                    variant="ghost"
                    onClick={() => setEdit({ kind: "warehouse", item: w })}
                  >
                    Edit
                  </Button>
                  <Button variant="secondary" onClick={() => setSelected(w.id)}>
                    View stock
                  </Button>
                </div>
              </div>
            </Panel>
          ))}
      </div>
      <Panel
        title="Business locations"
        subtitle="Each godown belongs to one location."
        className="sd-location-list"
      >
        <DataTable
          headers={["Location", "Godowns", "Status", "Action"]}
          rows={state.locations.map((l) => [
            // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
            <div className="sd-inline">
              <MapPin size={15} />
              <strong>{l.name}</strong>
            </div>,
            state.warehouses.filter((w) => w.locationId === l.id).length,
            // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
            <Badge>{l.active ? "Active" : "Inactive"}</Badge>,
            // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
            <Button
              variant="ghost"
              onClick={() => setEdit({ kind: "location", item: l })}
            >
              Edit location
            </Button>,
          ])}
        />
      </Panel>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`${edit?.item ? "Edit" : "Add"} ${edit?.kind || "location"}`}
      >
        <form
          key={`${edit?.kind}-${edit?.item?.id}`}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await mutation.run(`${edit!.kind}.save`, {
                id: edit?.item?.id,
                name: f.get("name"),
                active: f.get("active") === "on",
                ...(edit?.kind === "warehouse"
                  ? { locationId: f.get("locationId") }
                  : {}),
              });
              notify("Location saved");
              setEdit(null);
            } catch {}
          }}
        >
          <div className="sd-form">
            <Field label="Name">
              <Input
                name="name"
                defaultValue={edit?.item?.name}
                required
                maxLength={160}
              />
            </Field>
            {edit?.kind === "warehouse" && (
              <Field label="Business location">
                <select
                  name="locationId"
                  required
                  defaultValue={
                    (edit?.item as WarehouseType)?.locationId ||
                    state.locations[0]?.id
                  }
                >
                  {state.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <label className="sd-check sd-full">
              <input
                type="checkbox"
                name="active"
                defaultChecked={edit?.item?.active ?? true}
              />
              Active for new operations
            </label>
          </div>
          <ErrorNotice error={mutation.error} />
          <div className="sd-form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEdit(null)}
            >
              Cancel
            </Button>
            <Button busy={mutation.busy}>Save {edit?.kind}</Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!selected}
        onClose={() => setSelected("")}
        title={
          state.warehouses.find((w) => w.id === selected)?.name ||
          "Godown stock"
        }
        wide
      >
        <DataTable
          headers={["Product", "Current stock", "Base quantity"]}
          rows={state.balances
            .filter((b) => b.locationId === selected)
            .map((b) => [
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <ProductName product={products.get(b.productId)} />,
              quantity(b.quantity, products.get(b.productId)),
              b.quantity,
            ])}
        />
        <h3 style={{ marginTop: 25 }}>Recent movements</h3>
        <DataTable
          headers={["When", "Product", "Type", "Change", "Reference"]}
          rows={state.movements
            .filter((m) => m.locationId === selected)
            .slice(0, 50)
            .map((m) => [
              dateTime(m.createdAt),
              products.get(m.productId)?.name,
              m.kind,
              quantity(m.quantity, products.get(m.productId)),
              m.reference,
            ])}
        />
      </Modal>
    </>
  );
}
export function TeamPage() {
  const { state, refresh, notify } = useApp();
  const [tab, setTab] = useState("fleet");
  const [edit, setEdit] = useState<{
    kind: "vehicle" | "user" | "assignment";
    item?: Vehicle | Actor;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mutation = useMutation(refresh);
  const [teamKey, setTeamKey] = useState("");
  function open(
    kind: "vehicle" | "user" | "assignment",
    item?: Vehicle | Actor,
  ) {
    setError("");
    mutation.setError("");
    setTeamKey(requestId());
    setEdit({ kind, item });
  }
  return (
    <>
      <div className="sd-toolbar">
        <div className="sd-tabs" style={{ margin: 0 }}>
          {["fleet", "salesmen", "assignment history"].map((t) => (
            <button
              className={tab === t ? "active" : ""}
              key={t}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <Button variant="secondary" onClick={() => open("user")}>
          <Users size={15} />
          Add salesman
        </Button>
        <Button onClick={() => open("vehicle")}>
          <Plus size={15} />
          Add vehicle
        </Button>
      </div>
      <Panel>
        {tab === "fleet" ? (
          <DataTable
            headers={[
              "Vehicle / Registration",
              "Home godown",
              "Assigned salesman",
              "Status",
              "Actions",
            ]}
            rows={state.vehicles.map((v) => [
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <div className="sd-inline">
                <Truck size={17} />
                <div>
                  <strong>{v.name}</strong>
                  <small className="sd-sub">
                    {v.registration || "Registration not entered"}
                  </small>
                </div>
              </div>,
              state.warehouses.find((w) => w.id === v.warehouseId)?.name,
              state.users.find((u) => u.id === v.salesmanId)?.name ||
                "Unassigned",
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <Badge>{v.active ? "Active" : "Inactive"}</Badge>,
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <div className="sd-row-actions">
                <Button variant="ghost" onClick={() => open("vehicle", v)}>
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => open("assignment", v)}
                >
                  Assign
                </Button>
              </div>,
            ])}
          />
        ) : tab === "salesmen" ? (
          <DataTable
            headers={[
              "Salesman",
              "Login ID",
              "Assigned vehicle",
              "Status",
              "Action",
            ]}
            rows={state.users
              .filter((u) => u.role === "salesman")
              .map((u) => [
                u.name,
                <code>{u.username}</code>,
                state.vehicles.find((v) => v.salesmanId === u.id)?.name ||
                  "Unassigned",
                // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
                <Badge>{u.active ? "Active" : "Inactive"}</Badge>,
                // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
                <Button variant="secondary" onClick={() => open("user", u)}>
                  Manage account
                </Button>,
              ])}
            empty="No salesmen yet"
          />
        ) : (
          <DataTable
            headers={["Vehicle", "Salesman", "From", "Until"]}
            rows={state.assignments.map((a) => [
              state.vehicles.find((v) => v.id === a.vehicleId)?.name,
              state.users.find((u) => u.id === a.salesmanId)?.name,
              dateTime(a.from),
              a.to ? dateTime(a.to) : <Badge tone="green">Current</Badge>,
            ])}
          />
        )}
      </Panel>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={
          edit?.kind === "assignment"
            ? "Assign vehicle"
            : `${edit?.item ? "Edit" : "Add"} ${edit?.kind === "user" ? "salesman" : "vehicle"}`
        }
        description={
          edit?.kind === "assignment"
            ? "Assignments are effective now. Existing stock and historical transactions stay with the vehicle."
            : undefined
        }
      >
        <form
          key={`${edit?.kind}-${edit?.item?.id}`}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setError("");
            setBusy(true);
            try {
              if (edit!.kind === "user") {
                await api("/team", {
                  id: edit?.item?.id,
                  name: f.get("name"),
                  username: (edit?.item as Actor)?.username || Math.random().toString(36).substring(2, 10),
                  mobile: f.get("mobile"),
                  password: f.get("password") || undefined,
                  active: f.get("active") === "on",
                  role: "salesman",
                  requestId: teamKey,
                });
                await refresh();
              } else if (edit!.kind === "assignment") {
                await mutation.run("assignment.save", {
                  vehicleId: edit!.item!.id,
                  salesmanId: f.get("salesmanId") || null,
                  reason: f.get("reason"),
                });
              } else {
                await mutation.run("vehicle.save", {
                  id: edit?.item?.id,
                  name: f.get("name"),
                  registration: f.get("registration"),
                  warehouseId: f.get("warehouseId"),
                  active: f.get("active") === "on",
                });
              }
              notify("Changes saved");
              setEdit(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Save failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="sd-form">
            {edit?.kind === "assignment" ? (
              <>
                <div className="sd-full">
                  <h3>{edit.item?.name}</h3>
                </div>
                <Field label="Salesman">
                  <select
                    name="salesmanId"
                    defaultValue={(edit.item as Vehicle)?.salesmanId || ""}
                  >
                    <option value="">Unassigned</option>
                    {state.users
                      .filter((u) => u.role === "salesman" && u.active)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Reason">
                  <Input
                    name="reason"
                    placeholder="Assignment / change reason"
                    required
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Name">
                  <Input name="name" defaultValue={edit?.item?.name} required />
                </Field>
                {edit?.kind === "vehicle" ? (
                  <>
                    <Field label="Registration">
                      <Input
                        name="registration"
                        defaultValue={(edit?.item as Vehicle)?.registration}
                      />
                    </Field>
                    <Field label="Home godown">
                      <select
                        name="warehouseId"
                        required
                        defaultValue={
                          (edit?.item as Vehicle)?.warehouseId ||
                          state.warehouses[0]?.id
                        }
                      >
                        {state.warehouses
                          .filter((w) => w.active)
                          .map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Mobile">
                      <Input name="mobile" type="tel" />
                    </Field>
                    <Field
                      label={
                        edit?.item
                          ? "Reset password (optional)"
                          : "Initial password"
                      }
                      hint="At least 12 characters. Share securely with the salesman."
                    >
                      <Input
                        name="password"
                        type="password"
                        minLength={12}
                        required={!edit?.item}
                        autoComplete="new-password"
                      />
                    </Field>
                  </>
                )}
                <label className="sd-check sd-full">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={edit?.item?.active ?? true}
                  />
                  Active account / vehicle
                </label>
              </>
            )}
          </div>
          <ErrorNotice error={error || mutation.error} />
          <div className="sd-form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEdit(null)}
            >
              Cancel
            </Button>
            <Button busy={busy}>Save changes</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function VehicleSchedulesPage() {
  const { state, refresh } = useApp();
  const mutation = useMutation(refresh);
  
  return (
    <Panel title="Vehicle Assignments">
      <div className="sd-notice">Weekly vehicle area assignments</div>
      <table className="w-full text-sm border-collapse border">
        <thead>
          <tr className="bg-gray-50">
            <th className="border p-2 text-left">Vehicle</th>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => <th className="border p-2 text-center" key={d}>{d}</th>)}
          </tr>
        </thead>
        <tbody>
          {state.vehicles.map(v => (
            <tr key={v.id}>
              <td className="border p-2">{v.name}</td>
              {Array.from({length: 7}).map((_, day) => (
                <td className="border p-2 text-center" key={day}>
                   <Button  variant="secondary">Edit</Button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
