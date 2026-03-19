import { useMemo } from "react";

import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";

export function SettingsPage() {
  const { t } = useI18n();
  const { timeZone, resolvedTimeZone, setTimeZone, timeZoneOptions } = useSettings();

  const utcPreview = useMemo(
    () => new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: "UTC"
    }).format(new Date()),
    []
  );

  const displayPreview = useMemo(
    () => new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: resolvedTimeZone
    }).format(new Date()),
    [resolvedTimeZone]
  );

  return (
    <main className="workspace-main">
      <section className="editor-grid editor-grid--single">
        <article className="workbook-panel">
          <div className="workbook-panel__header">
            <div>
              <p className="sheet-kicker">{t("settings")}</p>
              <h2>{t("timezoneDisplay")}</h2>
              <p>{t("timezoneDisplayDesc")}</p>
            </div>
          </div>

          <div className="sheet-form">
            <label className="sheet-form__wide">
              {t("timezone")}
              <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
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
              <strong>{t("databaseTimezone")}</strong> UTC
            </div>
            <div className="sheet-note">
              <strong>{t("frontendTimezone")}</strong> {resolvedTimeZone}
            </div>
            <div className="sheet-note">
              <strong>{t("utcPreview")}</strong> {utcPreview}
            </div>
            <div className="sheet-note">
              <strong>{t("displayPreview")}</strong> {displayPreview}
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}
