import { type FormEvent, useState } from "react";

import type { LoginPayload, SignUpPayload, User } from "../lib/types";

type AuthMode = "login" | "signup";

export function AuthPage({
  onLogin,
  onSignUp,
  isSubmitting,
  errorMessage
}: {
  onLogin: (payload: LoginPayload) => Promise<void>;
  onSignUp: (payload: SignUpPayload) => Promise<void>;
  isSubmitting: boolean;
  errorMessage: string;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (mode === "signup") {
      await onSignUp({ fullName, email, password });
      return;
    }

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
            <p className="eyebrow">{mode === "login" ? "Welcome back" : "Create account"}</p>
            <h2>{mode === "login" ? "Sign in to continue" : "Set up your workspace access"}</h2>
          </div>
          <div className="auth-toggle">
            <button type="button" className={`auth-toggle__button ${mode === "login" ? "auth-toggle__button--active" : ""}`} onClick={() => setMode("login")}>Login</button>
            <button type="button" className={`auth-toggle__button ${mode === "signup" ? "auth-toggle__button--active" : ""}`} onClick={() => setMode("signup")}>Sign up</button>
          </div>
        </div>

        <form className="auth-form" onSubmit={(event) => { void handleSubmit(event); }}>
          {mode === "signup" ? (
            <label>
              Full name
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Warehouse manager" autoComplete="name" />
            </label>
          ) : null}

          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" />
          </label>

          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </label>

          {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}

          <button className="button button--primary auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
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
  return (
    <div className="app-user">
      <div className="app-user__meta">
        <strong>{user.fullName}</strong>
        <span>{user.email}</span>
      </div>
      <button className="button button--ghost button--small" type="button" onClick={() => { void onLogout(); }} disabled={isSubmitting}>
        {isSubmitting ? "Signing out..." : "Logout"}
      </button>
    </div>
  );
}
