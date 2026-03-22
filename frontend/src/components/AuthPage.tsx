import { type FormEvent, useState } from "react";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onLogin({ email, password });
  }

  return (
    <main className="auth-shell">
      <section className="auth-hero">
        <p className="eyebrow">Inventory control</p>
        <h1>Speed Inventory Management</h1>
        <p>
          Centralize inbound, outbound, storage, and SKU tracking behind a simple
          authenticated workspace for your team.
        </p>
        <div className="auth-feature-list">
          <article>
            <strong>Live warehouse records</strong>
            <span>Track current stock, container details, and location assignments.</span>
          </article>
          <article>
            <strong>Protected operations</strong>
            <span>Sign in before accessing inventory edits and movement history.</span>
          </article>
          <article>
            <strong>One shared dashboard</strong>
            <span>Keep receiving, shipping, and reporting in the same interface.</span>
          </article>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-card__header">
          <div>
            <p className="eyebrow">Welcome back</p>
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

          {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}

          <button className="button button--primary auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Please wait..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

export function AppHeaderUser({
  user,
  onLogout,
  isSubmitting,
  compact = false
}: {
  user: User;
  onLogout: () => Promise<void>;
  isSubmitting: boolean;
  compact?: boolean;
}) {
  const initials = user.fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";

  return (
    <div className={`app-user ${compact ? "app-user--compact" : ""}`}>
      <div className="app-user__identity">
        <div className="app-user__avatar" aria-hidden="true">{initials}</div>
        <div className="app-user__meta">
          <div className="app-user__name-row">
            <strong>{user.fullName}</strong>
            <span className="app-user__role">{user.role}</span>
          </div>
          <span>{user.email}</span>
        </div>
      </div>
      <button className="app-user__logout" type="button" onClick={() => { void onLogout(); }} disabled={isSubmitting}>
        {isSubmitting ? "Signing out..." : "Sign out"}
      </button>
    </div>
  );
}
