import DeleteForeverOutlinedIcon from "@mui/icons-material/DeleteForeverOutlined";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { useI18n } from "../lib/i18n";
import type {
  DeleteInboundWithDependenciesResponse,
  InboundDeletionDependency,
  InboundDeletionImpact,
  InboundDocument
} from "../lib/types";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";

type InboundDeletionRollbackDialogProps = {
  open: boolean;
  document: InboundDocument | null;
  onClose: () => void;
  onDeleted: (response: DeleteInboundWithDependenciesResponse) => void | Promise<void>;
};

export function InboundDeletionRollbackDialog({
  open,
  document,
  onClose,
  onDeleted
}: InboundDeletionRollbackDialogProps) {
  const { t } = useI18n();
  const [impact, setImpact] = useState<InboundDeletionImpact | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !document?.id) {
      setImpact(null);
      setSelectedKeys(new Set());
      setError("");
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError("");
    setImpact(null);
    void api.previewInboundDeletion(document.id)
      .then((nextImpact) => {
        if (!active) return;
        setImpact(nextImpact);
        setSelectedKeys(new Set());
      })
      .catch((requestError) => {
        if (!active) return;
        setError(getErrorMessage(requestError, t("inboundDeletionPreviewFailed")));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [document?.id, open, t]);

  const allRequiredSelected = useMemo(
    () => Boolean(impact) && impact!.dependencies.every((entry) => entry.reversible && selectedKeys.has(dependencyKey(entry))),
    [impact, selectedKeys]
  );
  const canSubmit = Boolean(impact?.canExecute) && allRequiredSelected && !loading && !submitting;

  function toggleDependency(dependency: InboundDeletionDependency) {
    if (!dependency.reversible || submitting) return;
    setSelectedKeys((current) => {
      const next = new Set(current);
      const key = dependencyKey(dependency);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleDelete() {
    if (!document?.id || !impact || !canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await api.deleteInboundWithDependencies(
        document.id,
        impact.dependencies
          .filter((dependency) => selectedKeys.has(dependencyKey(dependency)))
          .map((dependency) => ({
            sourceType: dependency.sourceType,
            documentId: dependency.documentId,
            lastLedgerId: dependency.lastLedgerId
          }))
      );
      await onDeleted(response);
    } catch (requestError) {
      setError(getErrorMessage(requestError, t("inboundDeletionExecuteFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <WarningAmberRoundedIcon fontSize="small" />
          </span>
          <div>
            <div className="text-lg font-extrabold text-slate-900">{t("inboundDeletionTitle")}</div>
            <div className="mt-1 text-sm font-normal text-slate-500">
              {t("inboundDeletionSubtitle", { container: document?.containerNo || `#${document?.id ?? "-"}` })}
            </div>
          </div>
        </div>
      </DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <div className="flex min-h-48 items-center justify-center gap-3 text-sm font-semibold text-slate-600">
            <InlineLoadingIndicator />
            {t("inboundDeletionLoading")}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</div>
        ) : impact ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              {impact.hasDependencies ? t("inboundDeletionWarning") : t("inboundDeletionNoDependencies")}
            </div>

            {impact.dependencies.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">{t("inboundDeletionActivities")}</div>
                    <div className="mt-1 text-xs text-slate-500">{t("inboundDeletionActivitiesHint")}</div>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                    {t("inboundDeletionActivityCount", { count: impact.dependencies.length })}
                  </span>
                </div>

                {impact.dependencies.map((dependency, index) => {
                  const checked = selectedKeys.has(dependencyKey(dependency));
                  return (
                    <button
                      key={dependencyKey(dependency)}
                      type="button"
                      onClick={() => toggleDependency(dependency)}
                      disabled={!dependency.reversible || submitting}
                      className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                        dependency.reversible
                          ? checked
                            ? "border-[#143569] bg-blue-50/70"
                            : "border-slate-200 bg-white hover:border-slate-300"
                          : "cursor-not-allowed border-rose-200 bg-rose-50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox checked={checked} disabled={!dependency.reversible || submitting} tabIndex={-1} sx={{ p: 0.5 }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-white">
                              {formatDependencyType(dependency.sourceType, t)}
                            </span>
                            <span className="text-sm font-extrabold text-slate-900">{dependency.reference}</span>
                            {dependency.includesTransfer ? (
                              <span className="rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-bold text-indigo-700">{t("inboundDeletionIncludesAutoTransfer")}</span>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span>{t("inboundDeletionOrder", { order: index + 1 })}</span>
                            <span>{formatActivityDate(dependency.activityAt)}</span>
                            <span>{t("inboundDeletionAffectedQty", { qty: dependency.affectedQty })}</span>
                            <span>{t("inboundDeletionAffectedPallets", { pallets: formatPallets(dependency.affectedPallets) })}</span>
                            {dependency.affectedContainers?.length ? (
                              <span>{t("inboundDeletionAffectedContainers", { containers: dependency.affectedContainers.join(", ") })}</span>
                            ) : null}
                          </div>
                          {dependency.blockingReason ? (
                            <div className="mt-2 text-xs font-semibold text-rose-700">{dependency.blockingReason}</div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {impact.dependencies.length > 0 && !allRequiredSelected ? (
              <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
                {t("inboundDeletionSelectAll")}
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={submitting}>{t("cancel")}</Button>
        <Button
          color="error"
          variant="contained"
          startIcon={submitting ? <InlineLoadingIndicator /> : <DeleteForeverOutlinedIcon />}
          disabled={!canSubmit}
          onClick={() => void handleDelete()}
        >
          {submitting ? t("inboundDeletionDeleting") : t("inboundDeletionConfirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function dependencyKey(dependency: Pick<InboundDeletionDependency, "sourceType" | "documentId">) {
  return `${dependency.sourceType}:${dependency.documentId}`;
}

function formatDependencyType(sourceType: string, t: (key: string, params?: Record<string, string | number>) => string) {
  const keyByType: Record<string, string> = {
    OUTBOUND: "inboundDeletionTypeOutbound",
    TRANSFER: "inboundDeletionTypeTransfer",
    ADJUSTMENT: "inboundDeletionTypeAdjustment",
    CYCLE_COUNT: "inboundDeletionTypeCycleCount",
    INBOUND: "inboundDeletionTypeInbound"
  };
  const key = keyByType[sourceType.toUpperCase()];
  return key ? t(key) : sourceType;
}

function formatActivityDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatPallets(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
