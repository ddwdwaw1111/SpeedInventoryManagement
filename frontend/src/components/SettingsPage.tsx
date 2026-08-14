import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";

import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { BillingInvoiceHeader, UserRole } from "../lib/types";
import { useFeedbackToast } from "./Feedback";

type BillingHeaderFormState = Omit<BillingInvoiceHeader, "paymentDueDays"> & {
  paymentDueDays: string;
};

type SettingsPageProps = {
  currentUserRole?: UserRole;
  onOperationalDataCleared?: () => void | Promise<void>;
};

export function SettingsPage({ currentUserRole = "viewer", onOperationalDataCleared }: SettingsPageProps) {
  const { language, setLanguage, t } = useI18n();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const {
    timeZone,
    setTimeZone,
    timeZoneOptions,
    billingInvoiceHeaderDefaults,
    setBillingInvoiceHeaderDefaults,
    refreshBillingInvoiceHeaderDefaults,
    isBillingInvoiceHeaderDefaultsLoading,
    billingTermOptions
  } = useSettings();
  const canManageBillingDefaults = currentUserRole === "admin";
  const [draftLanguage, setDraftLanguage] = useState(language);
  const [draftTimeZone, setDraftTimeZone] = useState(timeZone);
  const [draftBillingHeader, setDraftBillingHeader] = useState<BillingHeaderFormState>(() => headerToForm(billingInvoiceHeaderDefaults));
  const [isSaving, setIsSaving] = useState(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState("");
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const [clearConfirmation, setClearConfirmation] = useState("");
  const [isClearingOperationalData, setIsClearingOperationalData] = useState(false);

  useEffect(() => {
    if (!canManageBillingDefaults) {
      return;
    }
    void refreshBillingInvoiceHeaderDefaults().catch(() => {
      setSaveErrorMessage("Could not load invoice defaults.");
    });
  }, [canManageBillingDefaults, refreshBillingInvoiceHeaderDefaults]);

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
  const billingHeaderHasChanges = !headersEqual(normalizedDraftBillingHeader, billingInvoiceHeaderDefaults);
  const hasChanges = draftLanguage !== language
    || draftTimeZone !== timeZone
    || (canManageBillingDefaults && billingHeaderHasChanges);

  const displayPreview = useMemo(
    () => new Intl.DateTimeFormat(draftLanguage === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: resolvedDraftTimeZone
    }).format(new Date()),
    [draftLanguage, resolvedDraftTimeZone]
  );

  async function handleSave() {
    if (!hasChanges) return;
    setIsSaving(true);
    setSaveErrorMessage("");
    try {
      setLanguage(draftLanguage);
      setTimeZone(draftTimeZone);
      if (canManageBillingDefaults && billingHeaderHasChanges) {
        await setBillingInvoiceHeaderDefaults(normalizedDraftBillingHeader);
      }
      showSuccess(t("settingsSavedSuccess"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save settings.";
      setSaveErrorMessage(message);
      showError(message);
    } finally {
      setIsSaving(false);
    }
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

  function openClearDialog() {
    setClearConfirmation("");
    setIsClearDialogOpen(true);
  }

  function closeClearDialog() {
    if (isClearingOperationalData) return;
    setIsClearDialogOpen(false);
    setClearConfirmation("");
  }

  async function handleClearOperationalData() {
    if (clearConfirmation !== "confirm" || isClearingOperationalData) return;

    setIsClearingOperationalData(true);
    try {
      const result = await api.clearOperationalData(clearConfirmation);
      setIsClearDialogOpen(false);
      setClearConfirmation("");
      showSuccess(t("operationalDataClearSuccess", {
        inbound: result.inboundDocuments,
        outbound: result.outboundDocuments,
        transfers: result.transfers
      }), 5200);
      try {
        await onOperationalDataCleared?.();
      } catch (refreshError) {
        showError(refreshError instanceof Error ? refreshError.message : t("couldNotLoadReport"));
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : t("operationalDataClearFailed"));
    } finally {
      setIsClearingOperationalData(false);
    }
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
              {!canManageBillingDefaults && <p>{t("billingInvoiceHeaderDefaultsAdminOnly")}</p>}
            </div>
          </div>

          <div className="sheet-form">
            <label>
              {t("billingInvoiceSellerName")}
              <input
                disabled={!canManageBillingDefaults || isBillingInvoiceHeaderDefaultsLoading}
                value={draftBillingHeader.sellerName}
                onChange={(event) => setDraftBillingHeader((current) => ({ ...current, sellerName: event.target.value }))}
              />
            </label>
            <label>
              {t("billingInvoiceSubtitle")}
              <input
                disabled={!canManageBillingDefaults || isBillingInvoiceHeaderDefaultsLoading}
                value={draftBillingHeader.subtitle}
                onChange={(event) => setDraftBillingHeader((current) => ({ ...current, subtitle: event.target.value }))}
              />
            </label>
            <label>
              {t("billingInvoiceRemitTo")}
              <input
                disabled={!canManageBillingDefaults || isBillingInvoiceHeaderDefaultsLoading}
                value={draftBillingHeader.remitTo}
                onChange={(event) => setDraftBillingHeader((current) => ({ ...current, remitTo: event.target.value }))}
              />
            </label>
            <label>
              {t("billingInvoiceTerms")}
              <select
                disabled={!canManageBillingDefaults || isBillingInvoiceHeaderDefaultsLoading}
                value={draftBillingHeader.terms}
                onChange={(event) => handleTermsChange(event.target.value)}
              >
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
                disabled={!canManageBillingDefaults || isBillingInvoiceHeaderDefaultsLoading}
                value={draftBillingHeader.paymentDueDays}
                onChange={(event) => setDraftBillingHeader((current) => ({ ...current, paymentDueDays: event.target.value }))}
              />
            </label>
            <label className="sheet-form__wide">
              {t("billingInvoicePaymentInstructions")}
              <textarea
                rows={3}
                disabled={!canManageBillingDefaults || isBillingInvoiceHeaderDefaultsLoading}
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
            {saveErrorMessage && (
              <div className="sheet-note" role="alert">
                {saveErrorMessage}
              </div>
            )}
          </div>

          <div className="sheet-form__actions" style={{ marginTop: "1rem" }}>
            <button className="button button--primary" type="button" onClick={handleSave} disabled={!hasChanges || isSaving}>
              {t("saveChanges")}
            </button>
            <button className="button button--ghost" type="button" onClick={handleCancel} disabled={!hasChanges || isSaving}>
              {t("cancel")}
            </button>
          </div>

          {canManageBillingDefaults ? (
            <section className="settings-danger-zone" aria-labelledby="operational-data-heading">
              <div className="settings-danger-zone__header">
                <div>
                  <p className="settings-danger-zone__eyebrow">{t("dangerZone")}</p>
                  <h3 id="operational-data-heading">{t("operationalDataClearTitle")}</h3>
                  <p>{t("operationalDataClearDesc")}</p>
                </div>
                <span className="settings-danger-zone__badge">{t("adminOnly")}</span>
              </div>
              <div className="settings-danger-zone__scope" aria-label={t("operationalDataClearScope") as string}>
                <span>{t("operationalDataScopeInbound")}</span>
                <span>{t("operationalDataScopeOutbound")}</span>
                <span>{t("operationalDataScopeTransfers")}</span>
                <span>{t("operationalDataScopeInventory")}</span>
                <span>{t("operationalDataScopeBilling")}</span>
                <span>{t("operationalDataScopeImports")}</span>
              </div>
              <p className="settings-danger-zone__preserved">{t("operationalDataPreserved")}</p>
              <button className="button button--danger settings-danger-zone__trigger" type="button" onClick={openClearDialog}>
                {t("operationalDataClearAction")}
              </button>
            </section>
          ) : null}
        </article>
      </section>

      <Dialog
        open={isClearDialogOpen}
        onClose={closeClearDialog}
        fullWidth
        maxWidth="sm"
        aria-labelledby="clear-operational-data-dialog-title"
      >
        <DialogTitle id="clear-operational-data-dialog-title">{t("operationalDataClearDialogTitle")}</DialogTitle>
        <DialogContent dividers className="settings-danger-dialog__content">
          <Alert severity="error" variant="outlined">
            {t("operationalDataClearWarning")}
          </Alert>
          <div className="settings-danger-dialog__instruction">
            <span>{t("operationalDataClearTypePrompt")}</span>
            <code>confirm</code>
          </div>
          <label className="settings-danger-dialog__label">
            {t("operationalDataConfirmation")}
            <input
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={clearConfirmation}
              onChange={(event) => setClearConfirmation(event.target.value)}
              disabled={isClearingOperationalData}
              placeholder="confirm"
            />
          </label>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeClearDialog} disabled={isClearingOperationalData}>{t("cancel")}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void handleClearOperationalData()}
            disabled={clearConfirmation !== "confirm" || isClearingOperationalData}
          >
            {isClearingOperationalData ? t("operationalDataClearing") : t("operationalDataClearConfirm")}
          </Button>
        </DialogActions>
      </Dialog>
      {feedbackToast}
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
