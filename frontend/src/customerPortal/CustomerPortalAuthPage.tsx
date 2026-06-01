import { type FormEvent, useState } from "react";
import { AdminPanelSettingsOutlined } from "@mui/icons-material";
import { Alert } from "@mui/material";

import { useI18n } from "../lib/i18n";
import type { LoginPayload, SignUpPayload } from "./types";

type CustomerPortalAuthPageProps = {
  onLogin: (payload: LoginPayload) => Promise<void>;
  onSignUp: (payload: SignUpPayload) => Promise<void>;
  isSubmitting: boolean;
  errorMessage: string;
};

export function CustomerPortalAuthPage({
  onLogin,
  onSignUp: _onSignUp,
  isSubmitting,
  errorMessage
}: CustomerPortalAuthPageProps) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onLogin({ email, password });
  }

  return (
    <main className="auth-shell customer-portal-auth-shell">
      <section className="auth-hero">
        <p className="eyebrow">{t("customerPortal")}</p>
        <h1>{t("customerPortal")}</h1>
        <p>{t("customerPortalAuthDesc")}</p>
        <div className="auth-feature-list">
          <article>
            <strong>{t("customerPortalAuthInventoryTitle")}</strong>
            <span>{t("customerPortalAuthInventoryDesc")}</span>
          </article>
          <article>
            <strong>{t("customerPortalAuthPackingListTitle")}</strong>
            <span>{t("customerPortalAuthPackingListDesc")}</span>
          </article>
          <article>
            <strong>{t("customerPortalAuthDocumentTitle")}</strong>
            <span>{t("customerPortalAuthDocumentDesc")}</span>
          </article>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-card__header">
          <div>
            <p className="eyebrow">{t("customerPortalCustomerAccess")}</p>
            <h2>{t("customerPortalSignInTitle")}</h2>
          </div>
        </div>

        <form className="auth-form" onSubmit={(event) => { void handleSubmit(event); }}>
          <label>
            {t("email")}
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("emailPlaceholder")} autoComplete="email" />
          </label>

          <label>
            {t("password")}
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("userPasswordPlaceholder")} autoComplete="current-password" />
          </label>

          {errorMessage ? <Alert severity="error" variant="outlined" sx={{ mb: 2, borderRadius: 2 }}>{errorMessage}</Alert> : null}

          <button className="button button--primary auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? t("signingIn") : t("signIn")}
          </button>

          <div className="auth-admin-entry">
            <a className="button button--ghost auth-admin-entry__link" href="/admin">
              <AdminPanelSettingsOutlined fontSize="small" />
              <span>{t("adminEntrance")}</span>
            </a>
            <span>{t("adminEntranceHint")}</span>
          </div>
        </form>
      </section>
    </main>
  );
}
