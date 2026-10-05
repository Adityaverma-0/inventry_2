"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CheckCheck,
  Cloud,
  ExternalLink,
  MapPin,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import {
  api,
  dateTime,
  outboxList,
  outboxPut,
  requestId,
  useMutation,
  useHistory,
  type OutboxEntry,
} from "./client";
import {
  HistoryPagination,
  Modal,
  Badge,
  Button,
  DataTable,
  Empty,
  ErrorNotice,
  Field,
  Input,
  Panel,
  SearchInput,
  useApp,
} from "./ui";
export function SettingsPage() {
  const { state, refresh, notify, online } = useApp();
  const mutation = useMutation(refresh);
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  return (
    <div className="sd-grid sd-grid-equal">
      {state.user.role === "owner" && (
        <Panel
          title="Business settings"
          subtitle="Business dates, contact information and foreground location preferences"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await mutation.run("settings.save", {
                  businessName: f.get("businessName"),
                  timezone: f.get("timezone"),
                  phone: f.get("phone"),
                  address: f.get("address"),
                  trackingInterval: Number(f.get("trackingInterval")),
                  staleMinutes: Number(f.get("staleMinutes")),
                  retentionDays: Number(f.get("retentionDays")),
                });
                notify("Business settings saved");
              } catch {}
            }}
          >
            <div className="sd-form">
              <Field label="Business name">
                <Input
                  name="businessName"
                  defaultValue={state.settings.businessName}
                  required
                />
              </Field>
              <Field label="Timezone">
                <Input
                  name="timezone"
                  defaultValue={state.settings.timezone}
                  required
                  list="timezone-options"
                />
                <datalist id="timezone-options">
                  <option>Asia/Kolkata</option>
                  <option>UTC</option>
                </datalist>
              </Field>
              <Field label="Phone">
                <Input
                  name="phone"
                  type="tel"
                  defaultValue={state.settings.phone}
                />
              </Field>
              <Field label="Address">
                <Input name="address" defaultValue={state.settings.address} />
              </Field>
              <Field label="Location capture interval (seconds)">
                <Input
                  name="trackingInterval"
                  type="number"
                  min={15}
                  max={3600}
                  defaultValue={state.settings.trackingInterval}
                  required
                />
              </Field>
              <Field label="Location stale after (minutes)">
                <Input
                  name="staleMinutes"
                  type="number"
                  min={1}
                  max={1440}
                  defaultValue={state.settings.staleMinutes}
                  required
                />
              </Field>
              <Field label="Location retention (days)">
                <Input
                  name="retentionDays"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={state.settings.retentionDays}
                  required
                />
              </Field>
            </div>
            <ErrorNotice error={mutation.error} />
            <div className="sd-form-actions">
              <Button busy={mutation.busy} disabled={!online}>
                Save business settings
              </Button>
            </div>
          </form>
        </Panel>
      )}
      <div className="sd-stack">
        <Panel
          title="Your account"
          subtitle="Your administrator manages profile and access changes"
        >
          <div className="sd-split-row">
            <span>Name</span>
            <strong>{state.user.name}</strong>
          </div>
          <div className="sd-split-row">
            <span>Email</span>
            <strong>{state.user.email}</strong>
          </div>
          <div className="sd-split-row">
            <span>Role</span>
            <Badge tone="blue">
              {state.user.role === "owner"
                ? "Owner / Administrator"
                : "Salesman"}
            </Badge>
          </div>
        </Panel>
        <Panel
          title="Change password"
          subtitle="Use a unique password with at least 12 characters"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              setPasswordError("");
              if (f.get("newPassword") !== f.get("confirmPassword")) {
                setPasswordError("New passwords do not match.");
                return;
              }
              setPasswordBusy(true);
              try {
                await api("/auth", {
                  action: "password",
                  currentPassword: f.get("currentPassword"),
                  newPassword: f.get("newPassword"),
                });
                notify("Password updated.");
                form.reset();
              } catch (e) {
                setPasswordError(
                  e instanceof Error ? e.message : "Password change failed",
                );
              } finally {
                setPasswordBusy(false);
              }
            }}
          >
            <div className="sd-stack">
              <Field label="Current password">
                <Input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Field label="New password">
                <Input
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </Field>
              <Field label="Confirm new password">
                <Input
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </Field>
            </div>
            <ErrorNotice error={passwordError} />
            <div className="sd-form-actions">
              <Button busy={passwordBusy} disabled={!online}>
                Update password
              </Button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}

export function NotificationsPage() { return <div>Notifications</div>; }
export function SyncPage() { return <div>Sync</div>; }
  