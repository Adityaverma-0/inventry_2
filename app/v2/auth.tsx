"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Boxes, Check, ShieldCheck, Truck } from "lucide-react";
import { api } from "./client";
import { Button, ErrorNotice, Field, Input } from "./ui";
export default function Auth({
  setupRequired,
  localSetup,
  notice,
  onSuccess,
}: {
  setupRequired: boolean;
  localSetup?: boolean;
  notice?: string;
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resetMode, setResetMode] = useState(false);
  return (
    <main className="sd sd-auth">
      <section className="sd-auth-story">
        <Link href="/" className="sd-brand">
          <span className="sd-logo">
            <Boxes size={25} />
          </span>
          <span>
            Sanket<span>Distribution workspace</span>
          </span>
        </Link>
        <div className="sd-auth-copy">
          <span className="sd-eyebrow">FROM GODOWN TO THE LAST MILE</span>
          <h1>
            Your stock.
            <br />
            Your fleet.
            <br />
            <em>In one place.</em>
          </h1>
          <p>
            A clearer view of every load, every sale and every day’s closing
            stock.
          </p>
          <div className="sd-auth-features">
            <span>
              <Check size={16} /> Independent godown inventory
            </span>
            <span>
              <Check size={16} /> Product-specific packaging
            </span>
            <span>
              <Check size={16} /> Daily reports with owner approval
            </span>
          </div>
        </div>
        <div className="sd-auth-footer">
          <Truck size={19} />
          <span>Built for a business on the move.</span>
        </div>
      </section>
      <section className="sd-auth-form">
        <div className="sd-auth-card">
          <div className="sd-auth-icon">
            <ShieldCheck size={25} />
          </div>
          <span className="sd-eyebrow">SANKET DISTRIBUTION</span>
          <h2>
            {setupRequired
              ? "Set up your workspace"
              : resetMode
                ? "Reset owner password"
                : "Welcome back"}
          </h2>
          <p>
            {setupRequired
              ? "Create the first owner account to begin. Your catalogue and stock will start empty."
              : resetMode
                ? "Enter the owner setup token and a new password to restore admin access."
                : "Sign in to keep your distribution day moving."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const form = new FormData(e.currentTarget);
              const data = Object.fromEntries(form);
              if (data.username && (data.username as string).includes('@')) {
                 data.email = data.username;
              }

              try {
                await api("/auth", {
                  action: setupRequired ? "setup" : resetMode ? "reset" : "login",
                  ...data,
                });
                onSuccess();
              } catch (e) {
                setError(e instanceof Error ? e.message : resetMode ? "Unable to reset password" : "Unable to sign in");
              } finally {
                setBusy(false);
              }
            }}
          >
            {setupRequired && (
              <Field label="Your name">
                <Input
                  name="name"
                  autoComplete="name"
                  placeholder="Owner's full name"
                  required
                />
              </Field>
            )}
            <Field label="Login ID / Email">
              <Input
                name="username"
                type="text"
                autoComplete="username"
                placeholder="Username or Email"
                required
              />
            </Field>

            {resetMode && (
              <Field
                label="Setup token"
                hint="Use the private setup token configured by the person deploying this workspace."
              >
                <Input
                  name="resetToken"
                  type="password"
                  autoComplete="off"
                  required
                  placeholder="Private setup token"
                />
              </Field>
            )}

            <Field
              label={resetMode ? "New Password" : "Password"}
              hint={
                setupRequired || resetMode
                  ? "Use at least 12 characters, including a number and symbol."
                  : undefined
              }
            >
              <Input
                name={resetMode ? "newPassword" : "password"}
                type="password"
                autoComplete={
                  setupRequired || resetMode ? "new-password" : "current-password"
                }
                minLength={setupRequired || resetMode ? 12 : 1}
                required
                placeholder={resetMode ? "Enter new password" : "Enter your password"}
              />
            </Field>

            {setupRequired && !localSetup && (
              <Field
                label="Setup token"
                hint="Use the private setup token configured by the person deploying this workspace."
              >
                <Input
                  name="setupToken"
                  type="password"
                  autoComplete="off"
                  required
                  placeholder="Private setup token"
                />
              </Field>
            )}
            <ErrorNotice error={error || notice} />
            <Button type="submit" busy={busy}>
              {setupRequired ? "Create owner account" : resetMode ? "Reset password" : "Sign in"}
              <ArrowRight size={17} />
            </Button>
            {!setupRequired && (
              <div style={{ marginTop: 12, textAlign: "center" }}>
                <button
                  type="button"
                  className="sd-text-link"
                  onClick={() => {
                    setResetMode(!resetMode);
                    setError("");
                  }}
                  disabled={busy}
                >
                  {resetMode ? "Back to sign in" : "Forgot owner password?"}
                </button>
              </div>
            )}
          </form>
          <div className="sd-auth-note">
            <ShieldCheck size={15} />
            <span>
              {setupRequired
                ? "Only the first owner can use initial setup."
                : "Your administrator manages account access."}
            </span>
          </div>
        </div>
        <footer>Inventory · Sales · Reconciliation</footer>
      </section>
    </main>
  );
}
