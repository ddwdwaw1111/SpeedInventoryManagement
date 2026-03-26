import { type FormEvent, useState } from "react";
import { Alert } from "@mui/material";

import { useI18n } from "../lib/i18n";
import type { LoginPayload, SignUpPayload, User } from "../lib/types";

export function AuthPage({
  onLogin,
  onSignUp: _onSignUp,
  isSubmitting,
  errorMessage
}: {
  onLogin: (payload: LoginPayload) => Promise<void>;
  onSignUp: (payload: SignUpPayload) => Promise<void>;
  isSubmitting: boolean;
  errorMessage: string;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onLogin({ email, password });
  }

  return (
    <main className="auth-shell">
      <section className="auth-hero">
        <p className="eyebrow">{t("inventorySystem")}</p>
        <h1>{t("speedInventory")}</h1>
        <p>
          Manage receiving, shipping, inventory control, and audit activity from a
          single secure workspace for your warehouse team.
        </p>
        <div className="auth-feature-list">
          <article>
            <strong>Operational visibility</strong>
            <span>Track inventory positions, container references, and warehouse assignments in real time.</span>
          </article>
          <article>
            <strong>Controlled execution</strong>
            <span>Authenticate users before they can post transactions, update inventory, or review history.</span>
          </article>
          <article>
            <strong>Unified warehouse workflow</strong>
            <span>Keep receipts, shipments, inventory control, and reporting in one operating interface.</span>
          </article>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-card__header">
          <div>
            <p className="eyebrow">Warehouse access</p>
            <h2>Sign in to continue</h2>
          </div>
        </div>

        <form className="auth-form" onSubmit={(event) => { void handleSubmit(event); }}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" />
          </label>

          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete="current-password" />
          </label>

          {errorMessage ? <Alert severity="error" variant="outlined" sx={{ mb: 2, borderRadius: 2 }}>{errorMessage}</Alert> : null}

          <button className="button button--primary auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

export function AppHeaderUser({
  user,
  onLogout,
  isSubmitting
}: {
  user: User;
  onLogout: () => Promise<void>;
  isSubmitting: boolean;
}) {
  const { t } = useI18n();
  const initials = user.fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";

  return (
    <div className="app-user">
      <button className="app-user__trigger" type="button" aria-haspopup="menu">
        <div className="app-user__avatar" aria-hidden="true">{initials}</div>
        <span className="app-user__trigger-name">{user.fullName}</span>
        <span className="app-user__trigger-caret" aria-hidden="true" />
      </button>
      <div className="app-user__menu" role="menu">
        <div className="app-user__menu-header">
          <strong>{user.fullName}</strong>
          <span className="app-user__menu-role">{t(user.role)}</span>
        </div>
        <div className="app-user__menu-details">
          <span>{user.email}</span>
        </div>
        <button className="app-user__menu-action" type="button" onClick={() => { void onLogout(); }} disabled={isSubmitting}>
          {isSubmitting ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </div>
  );
}
