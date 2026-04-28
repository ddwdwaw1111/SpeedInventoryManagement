import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { BillingInvoiceHeader } from "../lib/types";

type BillingHeaderFormState = Omit<BillingInvoiceHeader, "paymentDueDays"> & {
  paymentDueDays: string;
};

export function SettingsPage() {
  const { language, setLanguage, t } = useI18n();
  const {
    timeZone,
    setTimeZone,
    timeZoneOptions,
    billingInvoiceHeaderDefaults,
    setBillingInvoiceHeaderDefaults,
    billingTermOptions
  } = useSettings();
  const [draftLanguage, setDraftLanguage] = useState(language);
  const [draftTimeZone, setDraftTimeZone] = useState(timeZone);
  const [draftBillingHeader, setDraftBillingHeader] = useState<BillingHeaderFormState>(() => headerToForm(billingInvoiceHeaderDefaults));

  useEffect(() => {
    setDraftLanguage(language);
  }, [language]);

  useEffect(() => {
    setDraftTimeZone(timeZone);
  }, [timeZone]);

  useEffect(() => {
    setDraftBillingHeader(headerToForm(billingInvoiceHeaderDefaults));
  }, [billingInvoiceHeaderDefaults]);

  const resolvedDraftTimeZone = useMemo(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return draftTimeZone === "local" ? browserZone : draftTimeZone;
  }, [draftTimeZone]);

  const normalizedDraftBillingHeader = useMemo(() => formToHeader(draftBillingHeader), [draftBillingHeader]);
  const hasChanges = draftLanguage !== language
    || draftTimeZone !== timeZone
    || !headersEqual(normalizedDraftBillingHeader, billingInvoiceHeaderDefaults);

  const displayPreview = useMemo(
    () => new Intl.DateTimeFormat(draftLanguage === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: resolvedDraftTimeZone
    }).format(new Date()),
    [draftLanguage, resolvedDraftTimeZone]
  );

  function handleSave() {
    if (!hasChanges) return;
    setLanguage(draftLanguage);
    setTimeZone(draftTimeZone);
    setBillingInvoiceHeaderDefaults(normalizedDraftBillingHeader);
  }

  function handleCancel() {
    setDraftLanguage(language);
    setDraftTimeZone(timeZone);
    setDraftBillingHeader(headerToForm(billingInvoiceHeaderDefaults));
  }

  function handleTermsChange(terms: string) {
    const option = billingTermOptions.find((candidate) => candidate.terms === terms);
    setDraftBillingHeader((current) => ({
      ...current,
      terms,
      paymentDueDays: option ? String(option.paymentDueDays) : current.paymentDueDays
    }));
  }

  return (
    <main className="workspace-main">
      <section className="editor-grid editor-grid--single">
        <article className="workbook-panel">
          <div className="workbook-panel__header">
            <div>
              <p className="sheet-kicker">{t("settings")}</p>
              <h2>{t("settings")}</h2>
              <p>{t("settingsDesc")}</p>
            </div>
          </div>

          <div className="sheet-form">
            <label>
              {t("language")}
              <select value={draftLanguage} onChange={(event) => setDraftLanguage(event.target.value as "en" | "zh")}>
                <option value="en">{t("english")}</option>
                <option value="zh">{t("chinese")}</option>
              </select>
            </label>

            <label className="sheet-form__wide">
              {t("timezone")}
              <select value={draftTimeZone} onChange={(event) => setDraftTimeZone(event.target.value)}>
                {timeZoneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value === "local" ? t("browserLocal") : option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="workbook-panel__header" style={{ borderTop: "1px solid var(--border-subtle)", marginTop: "1rem", paddingTop: "1rem" }}>
            <div>
              <p className="sheet-kicker">{t("billingInvoiceHeaderDefaults")}</p>
              <h3>{t("billingInvoiceHeaderDefaults")}</h3>
              <p>{t("billingInvoiceHeaderDefaultsDesc")}</p>
            </div>
          </div>

          <div className="sheet-form">
            <label>
              {t("billingInvoiceSellerName")}
              <input
                value={draftBillingHeader.sellerName}
                onChange={(event) => setDraftBillingHeader((current) => ({ ...current, sellerName: event.target.value }))}
              />
            </label>
            <label>
              {t("billingInvoiceSubtitle")}
              <input
                value={draftBillingHeader.subtitle}
                onChange={(event) => setDraftBillingHeader((current) => ({ ...current, subtitle: event.target.value }))}
              />
            </label>
            <label>
              {t("billingInvoiceRemitTo")}
              <input
                value={draftBillingHeader.remitTo}
                onChange={(event) => setDraftBillingHeader((current) => ({ ...current, remitTo: event.target.value }))}
              />
            </label>
            <label>
              {t("billingInvoiceTerms")}
              <select value={draftBillingHeader.terms} onChange={(event) => handleTermsChange(event.target.value)}>
                {billingTermOptions.map((option) => (
                  <option key={option.label} value={option.terms}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              {t("billingInvoicePaymentDueDays")}
              <input
                type="number"
                min={0}
                step={1}
                value={draftBillingHeader.paymentDueDays}
                onChange={(event) => setDraftBillingHeader((current) => ({ ...current, paymentDueDays: event.target.value }))}
              />
            </label>
            <label className="sheet-form__wide">
              {t("billingInvoicePaymentInstructions")}
              <textarea
                rows={3}
                value={draftBillingHeader.paymentInstructions}
                onChange={(event) => setDraftBillingHeader((current) => ({ ...current, paymentInstructions: event.target.value }))}
              />
            </label>
          </div>

          <div className="settings-preview">
            <div className="sheet-note">
              <strong>{t("timezone")}</strong> {resolvedDraftTimeZone}
            </div>
            <div className="sheet-note">
              <strong>{t("displayPreview")}</strong> {displayPreview}
            </div>
            <div className="sheet-note">
              {hasChanges ? t("unsavedChanges") : t("noChanges")}
            </div>
          </div>

          <div className="sheet-form__actions" style={{ marginTop: "1rem" }}>
            <button className="button button--primary" type="button" onClick={handleSave} disabled={!hasChanges}>
              {t("saveChanges")}
            </button>
            <button className="button button--ghost" type="button" onClick={handleCancel} disabled={!hasChanges}>
              {t("cancel")}
            </button>
          </div>
        </article>
      </section>
    </main>
  );
}

function headerToForm(header: BillingInvoiceHeader): BillingHeaderFormState {
  return {
    sellerName: header.sellerName,
    subtitle: header.subtitle,
    remitTo: header.remitTo,
    terms: header.terms,
    paymentDueDays: String(header.paymentDueDays),
    paymentInstructions: header.paymentInstructions
  };
}

function formToHeader(header: BillingHeaderFormState): BillingInvoiceHeader {
  return {
    sellerName: header.sellerName.trim(),
    subtitle: header.subtitle.trim(),
    remitTo: header.remitTo.trim(),
    terms: header.terms.trim(),
    paymentDueDays: Math.max(0, Math.round(toNumber(header.paymentDueDays))),
    paymentInstructions: header.paymentInstructions.trim()
  };
}

function headersEqual(left: BillingInvoiceHeader, right: BillingInvoiceHeader) {
  return left.sellerName === right.sellerName
    && left.subtitle === right.subtitle
    && left.remitTo === right.remitTo
    && left.terms === right.terms
    && left.paymentDueDays === right.paymentDueDays
    && left.paymentInstructions === right.paymentInstructions;
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
