import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";

export function SettingsPage() {
  const { language, setLanguage, t } = useI18n();
  const { timeZone, setTimeZone, timeZoneOptions } = useSettings();
  const [draftLanguage, setDraftLanguage] = useState(language);
  const [draftTimeZone, setDraftTimeZone] = useState(timeZone);

  useEffect(() => {
    setDraftLanguage(language);
  }, [language]);

  useEffect(() => {
    setDraftTimeZone(timeZone);
  }, [timeZone]);

  const resolvedDraftTimeZone = useMemo(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return draftTimeZone === "local" ? browserZone : draftTimeZone;
  }, [draftTimeZone]);

  const hasChanges = draftLanguage !== language || draftTimeZone !== timeZone;

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
  }

  function handleCancel() {
    setDraftLanguage(language);
    setDraftTimeZone(timeZone);
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
