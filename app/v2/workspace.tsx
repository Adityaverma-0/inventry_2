"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Boxes,
  CheckCheck,
  ChevronRight,
  ClipboardCheck,
  Cloud,
  FileBarChart2,
  FileText,
  House,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Users,
  Warehouse,
  WifiOff,
} from "lucide-react";
import type { Actor, AppState } from "@/lib/domain/types";
import { api, ApiError, businessDay, dateTime } from "./client";
import {
  AppContext,
  Badge,
  Button,
  Empty,
  ErrorNotice,
  Panel,
  Stat,
  TextLink,
  type PageId,
} from "./ui";
import { SalesmanStockPage, AdminReportsPage } from "./feature-views";

import { WarehousePage } from "./warehouse";
import Auth from "./auth";
import { ProductsPage, PackagingPage } from "./products";
import { LocationsPage, TeamPage } from "./masters";
import {
  InventoryPage,
  LoadsPage,
  SalesPage,
  SaleFormPage,
} from "./operations";
import { InvoicesPage } from "./invoices";
import { DailyReportsPage, ReportsPage } from "./reports";
import {
  NotificationsPage,
  SettingsPage,
  SyncPage,
  } from "./settings";
import "./styles.css";
const navigation = [
  {
    group: "WORKSPACE",
    items: [
      ["overview", "Overview", LayoutDashboard],
      ["locations", "Locations & Godowns", Warehouse],
      ["products", "Products", Package],
      ["packaging", "Packaging & Item Types", Boxes],
    ],
  },
  {
    group: "OPERATIONS",
    items: [
      ["invoices", "Purchase Invoices", FileText],
      ["inventory", "Inventory", ArrowDownToLine],
      ["team", "Vehicles & Salesmen", Users],
      ["loads", "Loads & Transfers", Truck],
      ["sales", "Sales", ShoppingBag],
      ["warehouse-stock", "Warehouse Stock", Warehouse],
      ["returns", "Returns & Requests", Truck],
    ],
  },
  {
    group: "INSIGHTS",
    items: [
      ["daily", "Daily Report Approvals", ClipboardCheck],
      ["reports", "Reports", FileBarChart2],
      ["feature-approvals", "Daily Report Approvals (V2)", ClipboardCheck],
    ],
  },
  {
    group: "MANAGE",
    items: [
      ["notifications", "Notifications", Bell],
      ["sync", "Sync Center", Cloud],
      ["settings", "Settings", Settings],
    ],
  },
] as const;
const workerNavigation = [
  {
    group: "MY WORKSPACE",
    items: [
      ["overview", "Home", House],
      ["inventory", "My Stock", Boxes],
      ["feature-stock", "My Vehicle Stock", Boxes],
      ["warehouse-stock", "Warehouse Stock", Warehouse],
      ["returns", "Return to Warehouse", Truck],
      ["new-sale", "New Sale", Plus],
      ["sales", "My Sales", ShoppingBag],
      ["daily", "My Daily Report", ClipboardCheck],
    ],
  },
  {
    group: "ACCOUNT",
    items: [
      ["notifications", "Notifications", Bell],
      ["sync", "Sync Status", Cloud],
      ["settings", "My Profile", Settings],
    ],
  },
] as const;
const descriptions: Partial<Record<PageId, string>> = {
  "warehouse-stock":
    "View home warehouse stock and request an owner-approved allocation.",
  returns:
    "Hold vehicle stock, request unloading, and review confirmed returns.",
  overview: "A clear view of your distribution business, today.",
  locations: "Independent inventory for every godown and location.",
  products: "Your catalogue, pricing and operational readiness.",
  packaging: "Product-specific units, exact ratios and preserved history.",
  invoices: "Review supplier documents. Receive stock with confidence.",
  inventory: "Live committed stock, organised by godown and vehicle.",
  team: "Manage your fleet, people and effective assignments.",
  loads: "Move stock from the home godown to its delivery vehicle.",
  sales: "Posted sales and their linked corrections.",
  daily: "Review the day. Preserve the record. Close with confidence.",
  reports: "Explore your operations with clear quantity and date filters.",
  notifications: "The operational items that need your attention.",
  sync: "See requests waiting on this device and their server outcome.",
  settings: "Business details, operational preferences and account security.",
  "new-sale": "Record sold quantities from your assigned vehicle.",
};
export default function Workspace() {
  const [auth, setAuth] = useState<{
    user: Actor | null;
    setupRequired: boolean;
    localSetup?: boolean;
  } | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState<PageId>("overview");
  const [menu, setMenu] = useState(false);
  const [online, setOnline] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");
  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 5000);
  }, []);
  const navigate = useCallback((p: PageId) => {
    setPage(p);
    setMenu(false);
    history.replaceState(null, "", `#${p}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const loadAuth = useCallback(async () => {
    try {
      setError("");
      const value = await api<{
        user: Actor | null;
        setupRequired: boolean;
        localSetup?: boolean;
      }>("/auth");
      setAuth(value);
      if (!value.user) {
        setState(null);
        setPage("overview");
        setMenu(false);
        history.replaceState(null, "", "#overview");
      } else {
        const requested = window.location.hash.slice(1) as PageId;
        const allowed = (
          value.user.role === "owner" ? navigation : workerNavigation
        ).flatMap((group) =>
          group.items.map((item) => item[0]),
        ) as readonly string[];
        const initial = allowed.includes(requested) ? requested : "overview";
        setPage(initial);
        history.replaceState(null, "", `#${initial}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to connect");
    }
  }, []);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const s = await api<AppState>("/state");
      setState(s);
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setState(null);
        setAuth((a) => (a ? { ...a, user: null } : null));
        setError("Your session has expired. Sign in to continue.");
      } else setError(e instanceof Error ? e.message : "Unable to refresh");
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      } else {
        // Development chunks keep stable URLs. Remove only this app's shell
        // worker/cache so hot reload cannot replay stale assets; keep IDB drafts.
        navigator.serviceWorker
          .getRegistrations()
          .then(async (registrations) => {
            await Promise.all(
              registrations
                .filter((registration) => {
                  const worker =
                    registration.active ||
                    registration.waiting ||
                    registration.installing;
                  return (
                    worker && new URL(worker.scriptURL).pathname === "/sw.js"
                  );
                })
                .map((registration) => registration.unregister()),
            );
            if ("caches" in window) {
              const names = await caches.keys();
              await Promise.all(
                names
                  .filter((name) => name.startsWith("sanket-shell-"))
                  .map((name) => caches.delete(name)),
              );
            }
          })
          .catch(() => {});
      }
    }
    // Bootstrap the remote session and subscribe to browser connectivity.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAuth();
    setOnline(navigator.onLine);
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, [loadAuth]);
  useEffect(() => {
    // An authenticated identity starts its scoped server-state request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (auth?.user) refresh();
  }, [auth?.user, refresh]);
  useEffect(() => {
    if (!auth?.user) return;
    const timer = setInterval(() => {
      if (navigator.onLine && document.visibilityState === "visible") refresh();
    }, 60000);
    return () => clearInterval(timer);
  }, [auth?.user, refresh]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "k" &&
        state?.user.role === "owner"
      ) {
        e.preventDefault();
        navigate("products");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, state?.user.role]);
  if (!auth)
    return (
      <div className="sd sd-screen-state">
        <div>
          <span className="sd-logo" style={{ margin: "0 auto 20px" }}>
            <Boxes size={24} />
          </span>
          <h2>
            {error
              ? "Connect to open your workspace"
              : "Opening your workspace"}
          </h2>
          <p style={{ marginTop: 8 }}>
            {error
              ? "Reconnect to the internet and retry. Sign-in requires the server; queued sales remain saved on this device."
              : "Connecting securely to Sanket Distribution."}
          </p>
          <ErrorNotice error={error} />
          {error && <Button onClick={loadAuth}>Try again</Button>}
        </div>
      </div>
    );
  if (!auth.user)
    return (
      <Auth
        setupRequired={auth.setupRequired}
        localSetup={auth.localSetup}
        notice={error}
        onSuccess={loadAuth}
      />
    );
  if (!state)
    return (
      <div className="sd sd-screen-state">
        <div>
          <h2>Preparing your workspace</h2>
          <ErrorNotice error={error} />
          <Button busy={refreshing} onClick={refresh}>
            Refresh workspace
          </Button>
        </div>
      </div>
    );
  const owner = state.user.role === "owner";
  const nav = owner ? navigation : workerNavigation;
  const current = nav.flatMap((g) => [...g.items]).find((i) => i[0] === page);
  const title = current?.[1] || (page === "new-sale" ? "New Sale" : "Overview");
  const pending =
    state.pendingStockRequests +
    state.reports.filter((r) => r.status === "SUBMITTED").length +
    state.invoices.filter((r) => r.status === "READY_FOR_APPROVAL").length;
  const views: Record<PageId, React.ReactNode> = {
    overview: <Overview />,
    locations: <LocationsPage />,
    products: <ProductsPage />,
    packaging: <PackagingPage />,
    invoices: <InvoicesPage />,
    inventory: <InventoryPage />,
    "warehouse-stock": <WarehousePage />,
    returns: <WarehousePage returns />,
    team: <TeamPage />,
    loads: <LoadsPage />,
    sales: <SalesPage />,
    daily: <DailyReportsPage />,
    reports: <ReportsPage />,
    notifications: <NotificationsPage />,
    sync: <SyncPage />,
    settings: <SettingsPage />,
    "new-sale": <SaleFormPage />,
    "feature-stock": <SalesmanStockPage />,
    "feature-approvals": <AdminReportsPage />,
  };
  return (
    <AppContext.Provider value={{ state, refresh, navigate, notify, online }}>
      <div className="sd sd-app">
        {menu && (
          <button
            aria-label="Close menu"
            className="sd-mobile-backdrop"
            onClick={() => setMenu(false)}
          />
        )}
        <aside className={`sd-sidebar ${menu ? "open" : ""}`}>
          <a
            className="sd-brand"
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              navigate("overview");
            }}
          >
            <span className="sd-logo">
              <Boxes size={24} />
            </span>
            <span>
              Sanket<span>Distribution workspace</span>
            </span>
          </a>
          <nav className="sd-nav" aria-label="Main navigation">
            {nav.map((g) => (
              <div key={g.group}>
                <p className="sd-nav-label">{g.group}</p>
                {g.items.map(([id, label, Icon]) => (
                  <button
                    key={id}
                    className={`sd-nav-button ${page === id ? "active" : ""}`}
                    onClick={() => navigate(id)}
                    aria-current={page === id ? "page" : undefined}
                  >
                    <Icon size={17} />
                    <span>{label}</span>
                    {id === "daily" &&
                      state.reports.some((r) => r.status === "SUBMITTED") && (
                        <span className="sd-nav-count">
                          {
                            state.reports.filter(
                              (r) => r.status === "SUBMITTED",
                            ).length
                          }
                        </span>
                      )}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <button className="sd-side-status" onClick={() => navigate("sync")}>
            <span
              className="sd-dot"
              style={!online ? { background: "#b08a50" } : undefined}
            />
            {online ? "Connected to workspace" : "Offline · local drafts only"}
            <small>
              Last refreshed{" "}
              {new Date(state.serverTime).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          </button>
          <div className="sd-user">
            <span className="sd-avatar">
              {state.user.name
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <strong>{state.user.name}</strong>
              <small>{owner ? "Owner / Administrator" : "Salesman"}</small>
            </div>
            <button
              className="sd-icon-button"
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await api("/auth", { action: "logout" });
                  setState(null);
                  await loadAuth();
                } catch (e) {
                  notify(e instanceof Error ? e.message : "Sign out failed");
                }
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </aside>
        <div className="sd-main">
          <header className="sd-topbar">
            <div className="sd-topbar-left">
              <button
                className="sd-icon-button sd-mobile-menu"
                aria-label="Open menu"
                onClick={() => setMenu(true)}
              >
                <Menu size={20} />
              </button>
              <span>Workspace</span>
              <ChevronRight size={13} />
              <strong>{title}</strong>
            </div>
            <div className="sd-topbar-actions">
              <span className="sd-topbar-date">
                {new Date().toLocaleDateString("en-IN", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: state.settings.timezone,
                })}
              </span>
              {owner && (
                <button
                  className="sd-top-search"
                  aria-label="Search products"
                  onClick={() => navigate("products")}
                >
                  <Search size={15} />
                  <span>Search products…</span>
                  <kbd>⌘ K</kbd>
                </button>
              )}
              <button
                className="sd-icon-button"
                aria-label="Refresh data"
                onClick={refresh}
                disabled={refreshing}
              >
                <RefreshCw size={17} className={refreshing ? "sd-spin" : ""} />
              </button>
              <button
                className="sd-icon-button sd-relative"
                aria-label={`Notifications, ${pending} pending approvals`}
                onClick={() => navigate("notifications")}
              >
                <Bell size={18} />
                {pending > 0 && <i className="sd-pending-dot" />}
              </button>
            </div>
          </header>
          {!online && (
            <div
              className="sd-notice sd-warning"
              style={{ margin: 0, borderRadius: 0 }}
            >
              <WifiOff
                size={14}
                style={{ display: "inline", marginRight: 8 }}
              />
              You’re offline. Displayed stock may be out of date. Sales can be
              saved to this device for review and sync.
            </div>
          )}
          <main className="sd-content">
            <div className="sd-heading">
              <div>
                <span className="sd-eyebrow">
                  {page === "overview"
                    ? `YOUR ${owner ? "BUSINESS" : "WORKDAY"}, AT A GLANCE`
                    : state.settings.businessName}
                </span>
                <h1>
                  {page === "overview"
                    ? `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${state.user.name.split(" ")[0]}`
                    : title}
                </h1>
                <p>{descriptions[page]}</p>
              </div>
              {page === "overview" && (
                <div className="sd-heading-actions">
                  <Button variant="secondary" onClick={() => navigate("daily")}>
                    <ClipboardCheck size={15} />
                    Daily reports
                  </Button>
                  <Button
                    onClick={() => navigate(owner ? "loads" : "new-sale")}
                  >
                    <Plus size={15} />
                    {owner ? "Create a load" : "New sale"}
                  </Button>
                </div>
              )}
            </div>
            <ErrorNotice error={error} />
            {!owner &&
            !workerNavigation.some((g) =>
              g.items.some((i) => i[0] === page),
            ) ? (
              <Empty
                title="This page is restricted"
                description="Your account can access your assigned vehicle and your own operations."
                action={
                  <Button onClick={() => navigate("overview")}>
                    Back to home
                  </Button>
                }
              />
            ) : (
              views[page]
            )}
            <footer className="sd-footer">
              <span>
                © {new Date().getFullYear()} {state.settings.businessName}
              </span>
              <span>
                <ShieldCheck size={12} />
                Live workspace · {state.settings.timezone}
              </span>
            </footer>
          </main>
        </div>
        <nav className="sd-bottom-nav" aria-label="Quick navigation">
          {(owner
            ? [
                ["overview", "Home", House],
                ["inventory", "Stock", Boxes],
                ["loads", "Load", Plus],
                ["daily", "Reports", ClipboardCheck],
                ["settings", "More", Menu],
              ]
            : [
                ["overview", "Home", House],
                ["inventory", "Stock", Boxes],
                ["new-sale", "Sale", Plus],
                ["daily", "Report", ClipboardCheck],
                ["settings", "Profile", Users],
              ]
          ).map(([id, label, Icon]) => {
            const I = Icon as typeof House;
            return (
              <button
                key={id as string}
                className={`${page === id ? "active" : ""} ${id === "new-sale" || id === "loads" ? "sd-sale-nav" : ""}`}
                onClick={() =>
                  id === "settings" && owner
                    ? setMenu(true)
                    : navigate(id as PageId)
                }
              >
                <I size={19} />
                <span>{label as string}</span>
              </button>
            );
          })}
        </nav>
        {toast && (
          <div className="sd-toast" role="status">
            {toast}
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}
import { useApp } from "./ui";
function Overview() {
  const { state, navigate } = useApp();
  const owner = state.user.role === "owner";
  const today = businessDay(state);
  const todaysSales = state.sales.filter(
    (s) => s.day === today && s.status === "POSTED",
  );
  const pendingInvoices = state.invoices.filter(
    (i) => i.status === "READY_FOR_APPROVAL",
  );
  const pendingReports = state.reports.filter((i) => i.status === "SUBMITTED");
  const low = state.balances.filter((b) => {
    const p = state.products.find((p) => p.id === b.productId);
    return p && p.minStock > 0 && b.quantity < p.minStock;
  });
  const ready = state.products.filter((p) => p.ready).length;
  return (
    <>
      <div className="sd-stats">
        <Stat
          label={owner ? "Active products" : "Stocked products"}
          value={
            owner
              ? state.products.filter((p) => p.active).length
              : new Set(
                  state.balances
                    .filter((b) => b.quantity > 0)
                    .map((b) => b.productId),
                ).size
          }
          detail={
            owner
              ? `${ready} ready for operations`
              : "Across your assigned vehicle"
          }
          icon={<Package size={17} />}
        />
        <Stat
          label={owner ? "Godowns & fleet" : "Sales today"}
          value={
            owner
              ? `${state.warehouses.length} / ${state.vehicles.length}`
              : todaysSales.length
          }
          detail={
            owner ? "Independent stock locations" : `Business date ${today}`
          }
          icon={<Truck size={17} />}
          tone="teal"
        />
        <Stat
          label="Pending approvals"
          value={
            pendingInvoices.length +
            pendingReports.length +
            state.pendingStockRequests
          }
          detail={`${pendingInvoices.length} invoices · ${pendingReports.length} reports · ${state.pendingStockRequests} stock requests`}
          icon={<ClipboardCheck size={17} />}
          tone="amber"
        />
        <Stat
          label={owner ? "Sales today" : "Assigned vehicles"}
          value={owner ? todaysSales.length : state.vehicles.length}
          detail={
            owner
              ? `Posted records · ${today}`
              : "Stock follows your assignment"
          }
          icon={<ShoppingBag size={17} />}
          tone="purple"
        />
      </div>
      {owner && (ready === 0 || state.balances.length === 0) && (
        <div className="sd-onboard">
          <div className="sd-onboard-icon">
            <Boxes size={25} />
          </div>
          <div>
            <h3>A fresh start for a well-run day</h3>
            <p>
              Your godowns and fleet are ready. Add your catalogue, configure
              packaging, then receive your first stock.
            </p>
            <div className="sd-checklist">
              <span className="done">
                <CheckCheck size={12} />
                Locations ready
              </span>
              <span className={ready > 0 ? "done" : ""}>
                <CheckCheck size={12} />
                Configure products
              </span>
              <span>
                <ArrowRight size={12} />
                Receive stock
              </span>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => navigate(ready ? "inventory" : "products")}
          >
            {ready ? "Receive stock" : "Set up catalogue"}
            <ArrowUpRight size={14} />
          </Button>
        </div>
      )}
      <div className="sd-grid sd-grid-2">
        <div className="sd-stack">
          <Panel
            title={owner ? "Godown & vehicle overview" : "My vehicle"}
            subtitle="Live stock locations · quantities stay product-specific"
            action={
              <TextLink onClick={() => navigate("inventory")}>
                View stock
              </TextLink>
            }
          >
            {state.vehicles.length ? (
              state.vehicles.map((v) => (
                <div className="sd-split-row" key={v.id}>
                  <div className="sd-inline">
                    <span className="sd-fleet-icon">
                      <Truck size={18} />
                    </span>
                    <div>
                      <h3>{v.name}</h3>
                      <p>
                        {
                          state.warehouses.find((w) => w.id === v.warehouseId)
                            ?.name
                        }{" "}
                        ·{" "}
                        {state.users.find((u) => u.id === v.salesmanId)?.name ||
                          "No salesman assigned"}
                      </p>
                    </div>
                  </div>
                  <Badge tone={v.salesmanId ? "green" : "blue"}>
                    {v.salesmanId ? "Assigned" : "Unassigned"}
                  </Badge>
                </div>
              ))
            ) : (
              <Empty
                title="No vehicle assigned"
                description="Your administrator can assign a vehicle to your account."
              />
            )}
          </Panel>
          <Panel
            title="Recent activity"
            subtitle="The latest confirmed actions in your workspace"
            action={
              <TextLink onClick={() => navigate("overview")}>
                View all
              </TextLink>
            }
          >
            {state.audit.length ? (
              state.audit.slice(0, 5).map((a) => (
                <div className="sd-activity" key={a.id}>
                  <span className="sd-activity-icon">
                    <Activity size={15} />
                  </span>
                  <div>
                    <p>
                      {a.action.replaceAll(".", " · ").replaceAll("_", " ")}
                    </p>
                    <small>
                      {a.actorName} ·{" "}
                      {dateTime(a.createdAt, state.settings.timezone)}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <Empty
                title="Your activity will appear here"
                description="Receipts, loads, sales and decisions are recorded as your team gets to work."
              />
            )}
          </Panel>
        </div>
        <div className="sd-stack">
          <Panel
            title="Needs your attention"
            subtitle="Keep the day moving without loose ends"
          >
            <div className="sd-split-row">
              <div>
                <h3>Purchase invoices</h3>
                <p>Ready for stock approval</p>
              </div>
              <TextLink
                onClick={() => navigate(owner ? "invoices" : "notifications")}
              >
                {pendingInvoices.length} pending
              </TextLink>
            </div>
            <div className="sd-split-row">
              <div>
                <h3>Daily reports</h3>
                <p>Submitted for owner review</p>
              </div>
              <TextLink onClick={() => navigate("daily")}>
                {pendingReports.length} pending
              </TextLink>
            </div>
            <div className="sd-split-row">
              <div>
                <h3>Stock requests</h3>
                <p>Returns, allocations and discrepancies</p>
              </div>
              <TextLink onClick={() => navigate("warehouse-stock")}>
                {state.pendingStockRequests} pending
              </TextLink>
            </div>
            <div className="sd-split-row">
              <div>
                <h3>Low stock alerts</h3>
                <p>Below product base-unit threshold</p>
              </div>
              <TextLink onClick={() => navigate("inventory")}>
                {low.length} items
              </TextLink>
            </div>
            {!pendingInvoices.length &&
              !pendingReports.length &&
              !low.length &&
              !state.pendingStockRequests && (
                <div className="sd-notice sd-success">
                  <CheckCheck
                    size={14}
                    style={{ display: "inline", marginRight: 7 }}
                  />
                  All clear. No pending operational alerts.
                </div>
              )}
          </Panel>
          <Panel
            title="Today's sales"
            subtitle={`Confirmed sales records · ${today}`}
            action={
              <TextLink onClick={() => navigate("sales")}>Details</TextLink>
            }
          >
            {todaysSales.length ? (
              <div className="sd-info-grid">
                <div>
                  <small>Posted records</small>
                  <strong>{todaysSales.length}</strong>
                </div>
                <div>
                  <small>Products sold</small>
                  <strong>
                    {
                      new Set(
                        todaysSales.flatMap((s) =>
                          s.lines.map((l) => l.productId),
                        ),
                      ).size
                    }
                  </strong>
                </div>
              </div>
            ) : (
              <Empty
                title="A new day, ready to begin"
                description="Confirmed sales appear here once your team starts posting."
                icon={<ShoppingBag size={23} />}
              />
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
