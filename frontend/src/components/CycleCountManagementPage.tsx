import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { formatDateTimeValue } from "../lib/dates";
import { consumePendingInventoryActionContext, type InventoryActionContext } from "../lib/inventoryActionContext";
import { buildInventoryActionSourceKey } from "../lib/inventoryActionSources";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { PageKey } from "../lib/routes";
import {
  buildInventoryProjectionKey,
  normalizeStorageSection,
  toInventoryProjectionRef,
  type CycleCount,
  type Item,
  type PalletTrace,
  type UserRole
} from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import { RowActionsMenu } from "./RowActionsMenu";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type CycleCountManagementPageProps = {
  cycleCounts: CycleCount[];
  items: Item[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageKey) => void;
};

type CycleCountFormState = {
  countNo: string;
  notes: string;
};

type CycleCountLineFormState = {
  id: string;
  bucketKey: string;
  countedQty: number;
  lineNote: string;
  palletCounts: CycleCountPalletFormState[];
};

type CycleCountPalletFormState = {
  rowId: string;
  palletId: number;
  palletCode: string;
  countedQty: number;
  isNew: boolean;
};

type LaunchNotice = {
  message: string;
  severity: "info" | "warning";
};

type CycleCountWizardStep = 1 | 2 | 3;

type DraftPreviewLine = {
  index: number;
  line: CycleCountLineFormState;
  selectedItem: Item | null;
  systemQty: number;
  countedQty: number;
  varianceQty: number;
  isComplete: boolean;
  palletPreviewLines: DraftPreviewPalletLine[];
};

type DraftPreviewPalletLine = {
  rowId: string;
  palletId: number;
  palletCode: string;
  systemQty: number;
  countedQty: number;
  varianceQty: number;
  isNew: boolean;
};

const emptyCycleCountForm: CycleCountFormState = {
  countNo: "",
  notes: ""
};

const CYCLE_COUNT_COLUMN_ORDER_PREFERENCE_KEY = "cycle-counts.column-order";

function createCycleCountClientId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createCycleCountLine(
  patch: Partial<Omit<CycleCountLineFormState, "id">> = {}
): CycleCountLineFormState {
  return {
    id: createCycleCountClientId(),
    bucketKey: "",
    countedQty: 0,
    lineNote: "",
    palletCounts: [],
    ...patch
  };
}

function createCycleCountPalletCount(
  patch: Partial<CycleCountPalletFormState> = {}
): CycleCountPalletFormState {
  return {
    rowId: createCycleCountClientId(),
    palletId: 0,
    palletCode: "",
    countedQty: 0,
    isNew: false,
    ...patch
  };
}

function createCycleCountLinesFromItems(items: Item[]) {
  return items.map((item) => createCycleCountLine({
    bucketKey: buildInventoryProjectionKey(toInventoryProjectionRef(item))
  }));
}

export function CycleCountManagementPage({
  cycleCounts,
  items,
  currentUserRole,
  isLoading,
  onRefresh,
  onNavigate
}: CycleCountManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const canConfigureColumns = currentUserRole === "admin";
  const pageDescription = t("cycleCountsDesc");
  const permissionNotice = canManage ? "" : t("readOnlyModeNotice");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedCycleCountId, setSelectedCycleCountId] = useState<number | null>(null);
  const [form, setForm] = useState<CycleCountFormState>(emptyCycleCountForm);
  const [lines, setLines] = useState<CycleCountLineFormState[]>([createCycleCountLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [pallets, setPallets] = useState<PalletTrace[]>([]);
  const [isLoadingPallets, setIsLoadingPallets] = useState(false);
  const [palletLoadError, setPalletLoadError] = useState("");
  const [launchNotice, setLaunchNotice] = useState<LaunchNotice | null>(null);
  const [activeLaunchContext, setActiveLaunchContext] = useState<InventoryActionContext | null>(null);
  const [hasProcessedLaunchContext, setHasProcessedLaunchContext] = useState(false);
  const [cycleCountWizardStep, setCycleCountWizardStep] = useState<CycleCountWizardStep>(1);
  const selectedCycleCount = useMemo(
    () => cycleCounts.find((cycleCount) => cycleCount.id === selectedCycleCountId) ?? null,
    [cycleCounts, selectedCycleCountId]
  );
  const itemByBucketKey = useMemo(
    () => new Map(items.map((item) => [buildInventoryProjectionKey(toInventoryProjectionRef(item)), item] as const)),
    [items]
  );
  const selectableItems = useMemo(
    () => activeLaunchContext ? filterItemsForLaunchContext(items, activeLaunchContext) : items,
    [activeLaunchContext, items]
  );
  const selectableItemByBucketKey = useMemo(
    () => new Map(selectableItems.map((item) => [buildInventoryProjectionKey(toInventoryProjectionRef(item)), item] as const)),
    [selectableItems]
  );
  const selectablePalletsByBucketKey = useMemo(() => {
    const nextMap = new Map<string, PalletTrace[]>();

    selectableItems.forEach((item) => {
      nextMap.set(
        buildInventoryProjectionKey(toInventoryProjectionRef(item)),
        pallets.filter((pallet) => matchesCycleCountPalletToItem(pallet, item))
      );
    });

    return nextMap;
  }, [pallets, selectableItems]);
  const draftPreviewLines = useMemo<DraftPreviewLine[]>(
    () => lines.map((line, index) => {
        const selectedItem = itemByBucketKey.get(line.bucketKey) ?? null;
        const systemQty = selectedItem?.quantity ?? 0;
        const linePalletOptions = selectedItem ? selectablePalletsByBucketKey.get(line.bucketKey) ?? [] : [];
        const palletPreviewLines = selectedItem
          ? line.palletCounts
            .map((entry, palletIndex) => {
              if (entry.isNew) {
                const countedPalletQty = Math.max(0, entry.countedQty);
                return {
                  rowId: entry.rowId,
                  palletId: 0,
                  palletCode: t("cycleCountNewPalletLabel", { index: palletIndex + 1 }),
                  systemQty: 0,
                  countedQty: countedPalletQty,
                  varianceQty: countedPalletQty,
                  isNew: true
                };
              }

              const pallet = linePalletOptions.find((option) => option.id === entry.palletId);
              if (!pallet) {
                return null;
              }

              const palletSystemQty = getCycleCountablePalletQty(pallet, selectedItem.skuMasterId);
              const countedPalletQty = Math.max(0, entry.countedQty);
              return {
                rowId: entry.rowId,
                palletId: pallet.id,
                palletCode: entry.palletCode || pallet.palletCode,
                systemQty: palletSystemQty,
                countedQty: countedPalletQty,
                varianceQty: countedPalletQty - palletSystemQty,
                isNew: false
              };
            })
            .filter((entry): entry is DraftPreviewPalletLine => Boolean(entry))
          : [];
        const countedQty = selectedItem
          ? palletPreviewLines.reduce((sum, palletLine) => sum + palletLine.countedQty, 0)
          : 0;

        return {
          index,
          line,
          selectedItem,
          systemQty,
          countedQty,
          varianceQty: selectedItem ? countedQty - systemQty : 0,
          isComplete: Boolean(selectedItem) && palletPreviewLines.length > 0,
          palletPreviewLines
        };
      }),
    [itemByBucketKey, lines, selectablePalletsByBucketKey, t]
  );
  const draftSummary = useMemo(() => {
    let selectedLineCount = 0;
    let totalSystemQty = 0;
    let totalCountedQty = 0;
    let varianceLineCount = 0;
    let incompleteLineCount = 0;
    const customerNames = new Set<string>();
    const containerNos = new Set<string>();

    draftPreviewLines.forEach((previewLine) => {
      if (!previewLine.selectedItem) {
        incompleteLineCount += 1;
        return;
      }
      if (!previewLine.isComplete) {
        incompleteLineCount += 1;
      }

      selectedLineCount += 1;
      totalSystemQty += previewLine.systemQty;
      totalCountedQty += previewLine.countedQty;
      if (previewLine.varianceQty !== 0) {
        varianceLineCount += 1;
      }
      customerNames.add(previewLine.selectedItem.customerName);
      if (previewLine.selectedItem.containerNo) {
        containerNos.add(previewLine.selectedItem.containerNo);
      }
    });

    return {
      selectedLineCount,
      totalSystemQty,
      totalCountedQty,
      totalVarianceQty: totalCountedQty - totalSystemQty,
      varianceLineCount,
      incompleteLineCount,
      customerCount: customerNames.size,
      containerCount: containerNos.size
    };
  }, [draftPreviewLines]);
  const historySummary = useMemo(() => ({
    totalDocuments: cycleCounts.length,
    totalLines: cycleCounts.reduce((sum, cycleCount) => sum + cycleCount.totalLines, 0),
    totalVariance: cycleCounts.reduce((sum, cycleCount) => sum + cycleCount.totalVariance, 0)
  }), [cycleCounts]);
  const activeScopeLabel = useMemo(
    () => buildLaunchScopeLabel(activeLaunchContext, selectableItems, t),
    [activeLaunchContext, selectableItems, t]
  );
  const canPostDraft = draftSummary.selectedLineCount > 0 && draftSummary.incompleteLineCount === 0 && !submitting && !isLoadingPallets;

  useEffect(() => {
    if (selectedCycleCountId !== null && !selectedCycleCount) {
      setSelectedCycleCountId(null);
    }
  }, [selectedCycleCount, selectedCycleCountId]);

  useEffect(() => {
    if (!canManage || !isEditorOpen) {
      return;
    }

    let active = true;

    async function loadPallets() {
      setIsLoadingPallets(true);
      setPalletLoadError("");
      try {
        const nextPallets = await api.getPallets(50000);
        if (!active) {
          return;
        }
        setPallets(nextPallets);
      } catch (error) {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : t("couldNotLoadReport");
        setPalletLoadError(message);
      } finally {
        if (active) {
          setIsLoadingPallets(false);
        }
      }
    }

    void loadPallets();
    return () => {
      active = false;
    };
  }, [canManage, isEditorOpen, t]);

  useEffect(() => {
    if (hasProcessedLaunchContext || !canManage || isLoading) {
      return;
    }

    setHasProcessedLaunchContext(true);
    const pendingContext = consumePendingInventoryActionContext("cycle-counts");
    if (!pendingContext) {
      return;
    }

    const matchedItems = filterItemsForLaunchContext(items, pendingContext);
    if (matchedItems.length === 0) {
      setActiveLaunchContext(null);
      setLaunchNotice({
        message: t("cycleCountShortcutNoMatches"),
        severity: "warning"
      });
      setForm(emptyCycleCountForm);
      setLines([createCycleCountLine()]);
      setErrorMessage("");
      setPalletLoadError("");
      setSubmitting(false);
      setCycleCountWizardStep(1);
      setIsEditorOpen(false);
      return;
    }

    setActiveLaunchContext(pendingContext);
    setLaunchNotice({
      message: t("cycleCountShortcutLoaded", { count: matchedItems.length }),
      severity: "info"
    });
    setForm(emptyCycleCountForm);
    setLines(createCycleCountLinesFromItems(matchedItems));
    setErrorMessage("");
    setSubmitting(false);
    setCycleCountWizardStep(2);
    setIsEditorOpen(true);
  }, [canManage, hasProcessedLaunchContext, isLoading, items, t]);

  useEffect(() => {
    setLines((current) => {
      let changed = false;
      const next = current.map((line) => {
        const nextBucketKey = selectableItemByBucketKey.has(line.bucketKey)
          ? line.bucketKey
          : "";
        const nextSelectedItem = selectableItemByBucketKey.get(nextBucketKey) ?? null;
        const nextPalletOptions = nextSelectedItem ? selectablePalletsByBucketKey.get(nextBucketKey) ?? [] : [];
        const nextPalletCounts = nextSelectedItem
          ? nextPalletOptions.length === 0 && isLoadingPallets && line.palletCounts.length > 0
            ? line.palletCounts
            : buildCycleCountPalletCounts(nextPalletOptions, nextSelectedItem.skuMasterId, line.palletCounts)
          : [];
        const nextCountedQty = nextSelectedItem
          ? sumCycleCountPalletCounts(nextPalletCounts)
          : 0;

        if (
          nextBucketKey === line.bucketKey
          && nextCountedQty === line.countedQty
          && areCycleCountPalletCountsEqual(nextPalletCounts, line.palletCounts)
        ) {
          return line;
        }

        changed = true;
        return {
          ...line,
          bucketKey: nextBucketKey,
          countedQty: nextCountedQty,
          palletCounts: nextPalletCounts
        };
      });

      return changed ? next : current;
    });
  }, [isLoadingPallets, selectableItemByBucketKey, selectablePalletsByBucketKey]);

  const baseColumns = useMemo<GridColDef<CycleCount>[]>(() => [
    { field: "countNo", headerName: t("countNo"), minWidth: 180, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.countNo}</span> },
    { field: "totalLines", headerName: t("totalLines"), minWidth: 120, type: "number" },
    {
      field: "totalVariance",
      headerName: t("varianceQty"),
      minWidth: 140,
      type: "number",
      renderCell: (params) => (
        <span style={{ color: params.row.totalVariance >= 0 ? "#3c6e71" : "#b76857", fontWeight: 700 }}>
          {formatSignedNumber(params.row.totalVariance)}
        </span>
      )
    },
    {
      field: "status",
      headerName: t("status"),
      minWidth: 120,
      renderCell: () => <Chip label={t("posted")} color="success" size="small" />
    },
    { field: "notes", headerName: t("notes"), minWidth: 260, flex: 1.4, renderCell: (params) => params.row.notes || "-" },
    { field: "createdAt", headerName: t("created"), minWidth: 220, flex: 1, valueFormatter: (value) => formatDateTimeValue(String(value), resolvedTimeZone) },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 90,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <RowActionsMenu
          ariaLabel={t("actions")}
          actions={[
            {
              key: "details",
              label: t("details"),
              icon: <VisibilityOutlinedIcon fontSize="small" />,
              onClick: () => setSelectedCycleCountId(params.row.id)
            }
          ]}
        />
      )
    }
  ], [resolvedTimeZone, t]);
  const {
    columns,
    columnOrderAction,
    columnOrderDialog
  } = useSharedColumnOrder({
    preferenceKey: CYCLE_COUNT_COLUMN_ORDER_PREFERENCE_KEY,
    baseColumns,
    canManage: canConfigureColumns,
    onError: setErrorMessage
  });

  const detailColumns = useMemo<GridColDef<CycleCount["lines"][number]>[]>(() => [
    { field: "sku", headerName: t("sku"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 220, flex: 1.4 },
    { field: "customerName", headerName: t("customer"), minWidth: 170, flex: 1 },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 170, flex: 1 },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 110 },
    { field: "systemQty", headerName: t("systemQty"), minWidth: 120, type: "number" },
    { field: "countedQty", headerName: t("countedQty"), minWidth: 120, type: "number" },
    {
      field: "varianceQty",
      headerName: t("varianceQty"),
      minWidth: 120,
      type: "number",
      renderCell: (params) => (
        <span style={{ color: params.row.varianceQty >= 0 ? "#3c6e71" : "#b76857", fontWeight: 700 }}>
          {formatSignedNumber(params.row.varianceQty)}
        </span>
      )
    },
    { field: "lineNote", headerName: t("internalNotes"), minWidth: 240, flex: 1.3, renderCell: (params) => params.row.lineNote || "-" }
  ], [t]);
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });
  const detailGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: t("emptyStateHint"),
    loadingTitle: t("loadingRecords")
  });

  function openCreateWorkspace(prefilledItems: Item[] = [], options: {
    launchContext?: InventoryActionContext | null;
    notice?: LaunchNotice | null;
    step?: CycleCountWizardStep;
  } = {}) {
    if (!canManage) {
      return;
    }

    setActiveLaunchContext(options.launchContext ?? null);
    setLaunchNotice(options.notice ?? null);
    setForm(emptyCycleCountForm);
    setLines(prefilledItems.length > 0 ? createCycleCountLinesFromItems(prefilledItems) : [createCycleCountLine()]);
    setErrorMessage("");
    setPalletLoadError("");
    setSubmitting(false);
    setCycleCountWizardStep(options.step ?? 1);
    setIsEditorOpen(true);
  }

  function closeCreateWorkspace() {
    setIsEditorOpen(false);
    setSubmitting(false);
    setErrorMessage("");
    setPalletLoadError("");
    setForm(emptyCycleCountForm);
    setLines([createCycleCountLine()]);
    setCycleCountWizardStep(1);
    setActiveLaunchContext(null);
    setLaunchNotice(null);
  }

  function addLine() {
    setLines((current) => [...current, createCycleCountLine()]);
  }

  function removeLine(lineId: string) {
    setLines((current) => current.length === 1 ? current : current.filter((line) => line.id !== lineId));
  }

  function updateLine(lineId: string, patch: Partial<CycleCountLineFormState>) {
    setLines((current) => current.map((line) => line.id === lineId ? { ...line, ...patch } : line));
  }

  function updateLineBucket(lineId: string, nextBucketKey: string) {
    const nextItem = selectableItemByBucketKey.get(nextBucketKey) ?? null;
    const nextPalletOptions = nextItem ? selectablePalletsByBucketKey.get(nextBucketKey) ?? [] : [];
    const nextPalletCounts = nextItem ? buildCycleCountPalletCounts(nextPalletOptions, nextItem.skuMasterId) : [];

    setLines((current) => current.map((line) => line.id === lineId
      ? {
          ...line,
          bucketKey: nextBucketKey,
          countedQty: nextItem ? sumCycleCountPalletCounts(nextPalletCounts) : 0,
          palletCounts: nextPalletCounts
        }
      : line));
  }

  function updateLineCountedQty(lineId: string, countedQty: number) {
    setLines((current) => current.map((line) => line.id === lineId
      ? { ...line, countedQty: Math.max(0, countedQty) }
      : line));
  }

  function updateLinePalletCount(lineId: string, palletRowId: string, countedQty: number) {
    setLines((current) => current.map((line) => {
      if (line.id !== lineId) {
        return line;
      }

      const nextPalletCounts = line.palletCounts.map((entry) => entry.rowId === palletRowId
        ? { ...entry, countedQty: Math.max(0, countedQty) }
        : entry);
      return {
        ...line,
        countedQty: sumCycleCountPalletCounts(nextPalletCounts),
        palletCounts: nextPalletCounts
      };
    }));
  }

  function addLinePallet(lineId: string) {
    setLines((current) => current.map((line) => {
      if (line.id !== lineId) {
        return line;
      }

      const nextPalletCounts = [
        ...line.palletCounts,
        createCycleCountPalletCount({ isNew: true })
      ];
      return {
        ...line,
        countedQty: sumCycleCountPalletCounts(nextPalletCounts),
        palletCounts: nextPalletCounts
      };
    }));
  }

  function removeLinePallet(lineId: string, palletRowId: string) {
    setLines((current) => current.map((line) => {
      if (line.id !== lineId) {
        return line;
      }

      const targetEntry = line.palletCounts.find((entry) => entry.rowId === palletRowId);
      if (!targetEntry) {
        return line;
      }

      const nextPalletCounts = targetEntry.isNew
        ? line.palletCounts.filter((entry) => entry.rowId !== palletRowId)
        : line.palletCounts.map((entry) => entry.rowId === palletRowId
          ? { ...entry, countedQty: 0 }
          : entry);
      return {
        ...line,
        countedQty: sumCycleCountPalletCounts(nextPalletCounts),
        palletCounts: nextPalletCounts
      };
    }));
  }

  function moveCycleCountWizardStep(step: CycleCountWizardStep) {
    setCycleCountWizardStep(step);
  }

  function showActionError(error: unknown, fallbackMessage: string) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    setErrorMessage(message);
    showError(message);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      if (draftPreviewLines.filter((previewLine) => previewLine.selectedItem).length !== lines.length) {
        throw new Error(t("cycleCountCompleteLines"));
      }
      if (draftPreviewLines.some((previewLine) => previewLine.selectedItem && previewLine.palletPreviewLines.length === 0)) {
        throw new Error(t("cycleCountRequirePalletBreakdown"));
      }

      const preparedLines = draftPreviewLines
        .filter((previewLine) => previewLine.selectedItem)
        .flatMap((previewLine) => previewLine.palletPreviewLines
          .filter((palletLine) => !palletLine.isNew || palletLine.countedQty > 0)
          .map((palletLine) => ({
            ...toInventoryProjectionRef(previewLine.selectedItem!),
            ...(palletLine.isNew ? { createPallet: true } : { palletId: palletLine.palletId }),
            countedQty: palletLine.countedQty,
            lineNote: previewLine.line.lineNote || undefined
          })));

      if (preparedLines.length === 0) {
        throw new Error(t("cycleCountRequireLine"));
      }

      await api.createCycleCount({
        countNo: form.countNo || undefined,
        notes: form.notes || undefined,
        lines: preparedLines
      });
      closeCreateWorkspace();
      await onRefresh();
      showSuccess(t("cycleCountSavedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveCycleCount"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="workspace-main">
      <section className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,#f4f8ff_0%,#eef4fb_100%)] px-5 py-5 shadow-[0_18px_48px_rgba(10,31,68,0.06)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#143569] shadow-[0_8px_18px_rgba(20,53,105,0.08)]">
              <FactCheckOutlinedIcon sx={{ fontSize: 18 }} />
              <span>{t("cycleCount")}</span>
            </div>

            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-[#102a56]">{t("cycleCounts")}</h1>
              <p className="mt-1.5 max-w-3xl text-sm text-slate-600">
                {t("cycleCountEditorPageDesc")}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="min-w-[140px] rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-[0_10px_22px_rgba(20,53,105,0.06)]">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {isEditorOpen ? t("draft") : t("cycleCounts")}
                </div>
                <div className="mt-1 text-2xl font-semibold text-[#102a56]">
                  {isEditorOpen ? draftSummary.selectedLineCount : historySummary.totalDocuments}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {isEditorOpen ? t("totalLines") : t("posted")}
                </div>
              </div>
              <div className="min-w-[140px] rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-[0_10px_22px_rgba(20,53,105,0.06)]">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t("systemQty")}</div>
                <div className="mt-1 text-2xl font-semibold text-[#102a56]">
                  {isEditorOpen ? draftSummary.totalSystemQty : historySummary.totalLines}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {isEditorOpen ? t("onHand") : t("totalLines")}
                </div>
              </div>
              <div className="min-w-[140px] rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-[0_10px_22px_rgba(20,53,105,0.06)]">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t("varianceQty")}</div>
                <div className={`mt-1 text-2xl font-semibold ${isEditorOpen ? draftSummary.totalVarianceQty === 0 ? "text-[#102a56]" : draftSummary.totalVarianceQty > 0 ? "text-[#2f6b5f]" : "text-[#b76857]" : historySummary.totalVariance >= 0 ? "text-[#2f6b5f]" : "text-[#b76857]"}`}>
                  {formatSignedNumber(isEditorOpen ? draftSummary.totalVarianceQty : historySummary.totalVariance)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {isEditorOpen ? t("cycleCountStepReview") : t("summary")}
                </div>
              </div>
            </div>
          </div>

          {canManage ? (
            <div className="flex flex-wrap items-center gap-3">
              {isEditorOpen ? (
                <button
                  type="button"
                  onClick={closeCreateWorkspace}
                  className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50"
                >
                  {t("discardDraft")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openCreateWorkspace()}
                  className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-[#143569] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(20,53,105,0.18)] transition hover:bg-[#102f5f]"
                >
                  <AddCircleOutlineOutlinedIcon sx={{ fontSize: 18 }} />
                  {t("addCycleCount")}
                </button>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {canManage ? (
        <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
          <WorkspacePanelHeader
            title={t("addCycleCount")}
            description={t("cycleCountEditorStepHint")}
            actions={!isEditorOpen ? (
              <button
                type="button"
                onClick={() => openCreateWorkspace()}
                className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-[#143569] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(20,53,105,0.18)] transition hover:bg-[#102f5f]"
              >
                <AddCircleOutlineOutlinedIcon sx={{ fontSize: 18 }} />
                {t("addCycleCount")}
              </button>
            ) : undefined}
          />

          {!isEditorOpen ? (
            <div className="space-y-4">
              {launchNotice ? <InlineAlert severity={launchNotice.severity}>{launchNotice.message}</InlineAlert> : null}
              <div className="rounded-[20px] border border-slate-200/80 bg-[linear-gradient(180deg,#f8fbff_0%,#f3f7fc_100%)] p-5">
                <p className="max-w-3xl text-sm leading-6 text-slate-600">
                  {t("cycleCountEditorClosedDesc")}
                </p>
              </div>
            </div>
          ) : (
            <>
              {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
              {launchNotice ? <InlineAlert severity={launchNotice.severity}>{launchNotice.message}</InlineAlert> : null}
              {!launchNotice ? (
                <InlineAlert severity="info">
                  {activeLaunchContext ? t("cycleCountScopeScopedNotice") : t("cycleCountManualNotice")}
                </InlineAlert>
              ) : null}
              {palletLoadError ? <InlineAlert severity="warning">{palletLoadError}</InlineAlert> : null}
              {!palletLoadError && isLoadingPallets ? (
                <InlineAlert severity="info">{t("cycleCountPalletLoading")}</InlineAlert>
              ) : null}

              <form onSubmit={handleSubmit}>
                <div className="shipment-wizard__steps">
                  {([
                    [1, t("cycleCountStepScope")],
                    [2, t("cycleCountStepLines")],
                    [3, t("cycleCountStepReview")]
                  ] as const).map(([step, label]) => (
                    <button
                      key={step}
                      type="button"
                      className={`shipment-wizard__step ${cycleCountWizardStep === step ? "shipment-wizard__step--active" : ""}`}
                      onClick={() => moveCycleCountWizardStep(step)}
                    >
                      <span className="shipment-wizard__step-index">{step}</span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {cycleCountWizardStep === 1 ? (
                  <>
                    <div className="sheet-form sheet-form--compact">
                      <label>
                        {t("countNo")}
                        <input
                          value={form.countNo}
                          onChange={(event) => setForm((current) => ({ ...current, countNo: event.target.value }))}
                          placeholder={t("autoGeneratedOptional")}
                        />
                      </label>
                      <label className="sheet-form__wide">
                        {t("notes")}
                        <input
                          value={form.notes}
                          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                          placeholder={t("cycleCountNotesPlaceholder")}
                        />
                      </label>
                    </div>

                    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                      <div className="rounded-[20px] border border-slate-200/80 bg-[linear-gradient(180deg,#f8fbff_0%,#f2f7fd_100%)] p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              {t("cycleCountScopeCardTitle")}
                            </div>
                            <h3 className="mt-1 text-lg font-semibold text-[#102a56]">{activeScopeLabel}</h3>
                            <p className="mt-1.5 max-w-2xl text-sm text-slate-600">
                              {activeLaunchContext ? t("cycleCountScopeScopedNotice") : t("cycleCountManualNotice")}
                            </p>
                          </div>
                          <span className={`status-pill ${activeLaunchContext ? "status-pill--ok" : ""}`}>
                            {activeLaunchContext ? t("cycleCountScopeScoped") : t("cycleCountScopeManual")}
                          </span>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <span className="rounded-full border border-sky-200/80 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                            {`${t("totalLines")}: ${activeLaunchContext ? selectableItems.length : Math.max(draftSummary.selectedLineCount, 0)}`}
                          </span>
                          <span className="rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                            {`${t("customer")}: ${activeLaunchContext ? new Set(selectableItems.map((item) => item.customerName)).size : draftSummary.customerCount}`}
                          </span>
                          <span className="rounded-full border border-violet-200/80 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                            {`${t("containers")}: ${activeLaunchContext ? new Set(selectableItems.map((item) => item.containerNo).filter(Boolean)).size : draftSummary.containerCount}`}
                          </span>
                        </div>
                      </div>

                      <div className="rounded-[20px] border border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t("summary")}</div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                            <div className="text-xl font-semibold text-[#102a56]">{draftSummary.selectedLineCount}</div>
                            <div className="mt-1 text-xs text-slate-500">{t("totalLines")}</div>
                          </div>
                          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                            <div className="text-xl font-semibold text-[#102a56]">{draftSummary.totalSystemQty}</div>
                            <div className="mt-1 text-xs text-slate-500">{t("systemQty")}</div>
                          </div>
                          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                            <div className="text-xl font-semibold text-[#102a56]">{draftSummary.totalCountedQty}</div>
                            <div className="mt-1 text-xs text-slate-500">{t("countedQty")}</div>
                          </div>
                          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                            <div className={`text-xl font-semibold ${draftSummary.varianceLineCount > 0 ? "text-[#b76857]" : "text-[#102a56]"}`}>
                              {draftSummary.varianceLineCount}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">{t("varianceQty")}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 shipment-wizard__actions">
                      <button
                        type="button"
                        onClick={closeCreateWorkspace}
                        className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50"
                      >
                        {t("cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCycleCountWizardStep(2)}
                        className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-[#143569] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(20,53,105,0.18)] transition hover:bg-[#102f5f]"
                      >
                        {t("cycleCountStepLines")}
                      </button>
                    </div>
                  </>
                ) : null}

                {cycleCountWizardStep === 2 ? (
                  <>
                    <div className="batch-allocation-preview">
                      <div className="batch-allocation-preview__header">
                        <div>
                          <strong>{t("cycleCountLines")}</strong>
                          <span>{t("cycleCountLineCaptureHint")}</span>
                        </div>
                        <div className="batch-allocation-preview__stats">
                          <div className="batch-allocation-preview__stat">
                            <strong>{draftSummary.selectedLineCount}</strong>
                            <span>{t("totalLines")}</span>
                          </div>
                          <div className="batch-allocation-preview__stat">
                            <strong>{draftSummary.totalSystemQty}</strong>
                            <span>{t("systemQty")}</span>
                          </div>
                          <div className="batch-allocation-preview__stat">
                            <strong>{draftSummary.totalCountedQty}</strong>
                            <span>{t("countedQty")}</span>
                          </div>
                          <div className="batch-allocation-preview__stat">
                            <strong>{draftSummary.varianceLineCount}</strong>
                            <span>{t("varianceQty")}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="batch-lines">
                      <div className="batch-lines__toolbar batch-lines__toolbar--sticky">
                        <strong>{t("cycleCountLines")}</strong>
                        <div className="batch-lines__adder">
                          <Button size="small" variant="outlined" type="button" onClick={addLine}>
                            {t("addLine")}
                          </Button>
                        </div>
                      </div>

                      {draftPreviewLines.map((previewLine) => {
                        const { line, selectedItem, systemQty, varianceQty, palletPreviewLines } = previewLine;
                        const hasPalletBreakdown = palletPreviewLines.length > 0;
                        const matchedPalletCount = palletPreviewLines.filter((palletLine) => !palletLine.isNew).length;
                        const missingPalletBreakdown = Boolean(selectedItem) && !hasPalletBreakdown;
                        const lineStatusLabel = !selectedItem
                          ? t("reviewIncomplete")
                          : missingPalletBreakdown
                            ? t("needsAttention")
                            : varianceQty === 0
                            ? t("ready")
                            : t("needsAttention");
                        const lineStatusTone = !selectedItem
                          ? "status-pill--alert"
                          : missingPalletBreakdown
                            ? "status-pill--alert"
                            : varianceQty === 0
                            ? "status-pill--ok"
                            : "status-pill--alert";

                        return (
                          <div className="batch-line-card" key={line.id}>
                            <div className="batch-line-card__header">
                              <div className="batch-line-card__title">
                                <strong>{`${t("cycleCountLine")} #${previewLine.index + 1}`}</strong>
                                <span className={`status-pill ${lineStatusTone}`}>{lineStatusLabel}</span>
                              </div>
                              <button
                                className="button button--danger button--small"
                                type="button"
                                onClick={() => removeLine(line.id)}
                                disabled={lines.length === 1}
                              >
                                {t("removeLine")}
                              </button>
                            </div>

                            <div className="grid gap-3 xl:grid-cols-[minmax(320px,2.3fr)_110px_110px_110px_minmax(220px,1.4fr)]">
                              <label className="batch-line-grid__description">
                                {t("stockRow")}
                                <select
                                  value={line.bucketKey}
                                  onChange={(event) => updateLineBucket(line.id, event.target.value)}
                                >
                                  <option value="">{t("selectStockRow")}</option>
                                  {selectableItems.map((item) => {
                                    const bucketKey = buildInventoryProjectionKey(toInventoryProjectionRef(item));
                                    return (
                                      <option key={bucketKey} value={bucketKey}>
                                        {formatInventoryPositionOption(item, t)}
                                      </option>
                                    );
                                  })}
                                </select>
                              </label>

                              <label>
                                {t("systemQty")}
                                <input value={selectedItem ? String(systemQty) : ""} readOnly />
                              </label>

                              <label>
                                {t("countedQty")}
                                <input
                                  type="number"
                                  min="0"
                                  value={selectedItem ? String(previewLine.countedQty) : numberInputValue(line.countedQty)}
                                  readOnly
                                />
                              </label>

                              <label>
                                {t("varianceQty")}
                                <input value={selectedItem ? formatSignedNumber(varianceQty) : ""} readOnly />
                              </label>

                              <label>
                                {t("internalNotes")}
                                <input
                                  value={line.lineNote}
                                  onChange={(event) => updateLine(line.id, { lineNote: event.target.value })}
                                  placeholder={t("cycleCountLineNotePlaceholder")}
                                />
                              </label>
                            </div>

                            <div className="batch-line-card__meta">
                              <span className="batch-line-card__hint">
                                {selectedItem
                                  ? [
                                      selectedItem.customerName,
                                      `${selectedItem.locationName} / ${normalizeStorageSection(selectedItem.storageSection)}`,
                                      `${selectedItem.sku} - ${displayDescription(selectedItem)}`,
                                      selectedItem.containerNo || "-"
                                    ].join(" · ")
                                  : t("selectStockRow")}
                              </span>
                              {selectedItem ? (
                                <span className={`status-pill ${varianceQty === 0 ? "status-pill--ok" : "status-pill--alert"}`}>
                                  {`${t("onHand")}: ${selectedItem.quantity}`}
                                </span>
                              ) : null}
                            </div>

                            {selectedItem ? (
                              <div className="mt-4 rounded-[20px] border border-slate-200/80 bg-slate-50/80 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("palletBreakdown")}</div>
                                    <p className="mt-1 text-sm text-slate-600">
                                      {matchedPalletCount > 0 ? t("cycleCountPalletBreakdownHint", { count: matchedPalletCount }) : t("cycleCountPalletRequiredHint")}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {hasPalletBreakdown ? (
                                      <span className="rounded-full border border-sky-200/80 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                                        {t("cycleCountPalletCountSummary", { count: palletPreviewLines.length })}
                                      </span>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => addLinePallet(line.id)}
                                      disabled={!selectedItem || isLoadingPallets || matchedPalletCount === 0}
                                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-xs font-semibold text-[#143569] transition hover:border-slate-300 hover:bg-slate-50"
                                    >
                                      {t("cycleCountAddPallet")}
                                    </button>
                                  </div>
                                </div>

                                {missingPalletBreakdown ? (
                                  <InlineAlert severity="warning" className="mt-4">
                                    {t("cycleCountRequirePalletBreakdown")}
                                  </InlineAlert>
                                ) : null}

                                {line.palletCounts.length > 0 ? (
                                  <div className="mt-4 grid gap-3">
                                    {palletPreviewLines.map((palletLine) => (
                                      <div
                                        key={`${line.id}-${palletLine.rowId}`}
                                        className="grid gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 lg:grid-cols-[minmax(220px,1.8fr)_110px_minmax(170px,1.2fr)_110px_110px]"
                                      >
                                        <div>
                                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("pallet")}</div>
                                          <div className="mt-1 text-sm font-semibold text-[#102a56]">{palletLine.palletCode}</div>
                                          <div className="mt-1 text-xs text-slate-500">
                                            {palletLine.isNew ? t("cycleCountNewPalletHint") : t("cycleCountExistingPalletHint")}
                                          </div>
                                        </div>
                                        <div>
                                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("systemQty")}</div>
                                          <div className="mt-1 text-sm font-semibold text-[#102a56]">{palletLine.systemQty}</div>
                                        </div>
                                        <label>
                                          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("countedQty")}</span>
                                          <div className="mt-1">
                                            <input
                                              type="number"
                                              min="0"
                                              value={String(palletLine.countedQty)}
                                              aria-label={`${t("countedQty")}: ${palletLine.palletCode}`}
                                              onChange={(event) => updateLinePalletCount(line.id, palletLine.rowId, Number(event.target.value || 0))}
                                              className="w-24 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-right text-sm font-semibold text-[#143569] outline-none transition focus:border-[#143569]/40 focus:bg-white"
                                            />
                                          </div>
                                        </label>
                                        <div className="flex items-start justify-end">
                                          <button
                                            type="button"
                                            onClick={() => removeLinePallet(line.id, palletLine.rowId)}
                                            aria-label={`${t("cycleCountRemovePallet")}: ${palletLine.palletCode}`}
                                            className="inline-flex items-center rounded-xl border border-rose-200/80 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
                                          >
                                            {t("cycleCountRemovePallet")}
                                          </button>
                                        </div>
                                        <div>
                                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("varianceQty")}</div>
                                          <div className={`mt-1 text-sm font-semibold ${palletLine.varianceQty === 0 ? "text-[#102a56]" : palletLine.varianceQty > 0 ? "text-[#2f6b5f]" : "text-[#b76857]"}`}>
                                            {formatSignedNumber(palletLine.varianceQty)}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-5 shipment-wizard__actions">
                      <button
                        type="button"
                        onClick={() => moveCycleCountWizardStep(1)}
                        className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50"
                      >
                        {t("cycleCountStepScope")}
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCycleCountWizardStep(3)}
                        className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-[#143569] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(20,53,105,0.18)] transition hover:bg-[#102f5f]"
                      >
                        {t("cycleCountStepReview")}
                      </button>
                    </div>
                  </>
                ) : null}

                {cycleCountWizardStep === 3 ? (
                  <>
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                      <div className="rounded-[20px] border border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {t("cycleCountReviewSummary")}
                        </div>
                        <h3 className="mt-1 text-lg font-semibold text-[#102a56]">
                          {form.countNo || t("draft")}
                        </h3>
                        <p className="mt-1.5 text-sm text-slate-600">
                          {t("cycleCountReviewHint")}
                        </p>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                            <div className="text-lg font-semibold text-[#102a56]">{draftSummary.selectedLineCount}</div>
                            <div className="mt-1 text-xs text-slate-500">{t("totalLines")}</div>
                          </div>
                          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                            <div className="text-lg font-semibold text-[#102a56]">{draftSummary.totalSystemQty}</div>
                            <div className="mt-1 text-xs text-slate-500">{t("systemQty")}</div>
                          </div>
                          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                            <div className="text-lg font-semibold text-[#102a56]">{draftSummary.totalCountedQty}</div>
                            <div className="mt-1 text-xs text-slate-500">{t("countedQty")}</div>
                          </div>
                          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                            <div className={`text-lg font-semibold ${draftSummary.totalVarianceQty === 0 ? "text-[#102a56]" : draftSummary.totalVarianceQty > 0 ? "text-[#2f6b5f]" : "text-[#b76857]"}`}>
                              {formatSignedNumber(draftSummary.totalVarianceQty)}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">{t("varianceQty")}</div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-[20px] border border-[#143569]/20 bg-[#143569] p-4 text-white shadow-[0_20px_40px_rgba(20,53,105,0.22)]">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                          {t("cycleCountScopeCardTitle")}
                        </div>
                        <h3 className="mt-1 text-lg font-semibold">{activeScopeLabel}</h3>
                        <div className="mt-4 space-y-3 text-sm text-white/90">
                          <div>
                            <div className="text-white/60">{t("countNo")}</div>
                            <div>{form.countNo || t("autoGeneratedOptional")}</div>
                          </div>
                          <div>
                            <div className="text-white/60">{t("notes")}</div>
                            <div>{form.notes || "-"}</div>
                          </div>
                          <div>
                            <div className="text-white/60">{t("status")}</div>
                            <div>{t("draft")}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {draftSummary.selectedLineCount === 0 ? (
                      <InlineAlert severity="warning">{t("cycleCountRequireLine")}</InlineAlert>
                    ) : null}
                    {draftSummary.incompleteLineCount > 0 ? (
                      <InlineAlert severity="warning">{t("cycleCountCompleteLines")}</InlineAlert>
                    ) : draftSummary.varianceLineCount > 0 ? (
                      <InlineAlert severity="warning">
                        {t("cycleCountVariancePostingNotice", { count: draftSummary.varianceLineCount })}
                      </InlineAlert>
                    ) : (
                      <InlineAlert severity="info">{t("cycleCountBalancedNotice")}</InlineAlert>
                    )}

                    <div className="grid gap-3">
                      {draftPreviewLines.map((previewLine) => (
                        <div className="batch-line-card" key={`review-${previewLine.line.id}`}>
                          <div className="batch-line-card__header">
                            <div className="batch-line-card__title">
                              <strong>{`${t("cycleCountLine")} #${previewLine.index + 1}`}</strong>
                              <span className={`status-pill ${!previewLine.isComplete ? "status-pill--alert" : previewLine.varianceQty === 0 ? "status-pill--ok" : "status-pill--alert"}`}>
                                {!previewLine.isComplete
                                  ? t("reviewIncomplete")
                                  : previewLine.varianceQty === 0
                                    ? t("ready")
                                    : formatSignedNumber(previewLine.varianceQty)}
                              </span>
                            </div>
                          </div>

                          <div className="grid gap-3 lg:grid-cols-[minmax(260px,2fr)_110px_110px_110px]">
                            <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("stockRow")}</div>
                              <div className="mt-1 text-sm font-semibold text-[#102a56]">
                                {previewLine.selectedItem
                                  ? `${previewLine.selectedItem.sku} - ${displayDescription(previewLine.selectedItem)}`
                                  : t("selectStockRow")}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {previewLine.selectedItem
                                  ? [
                                      previewLine.selectedItem.customerName,
                                      `${previewLine.selectedItem.locationName} / ${normalizeStorageSection(previewLine.selectedItem.storageSection)}`,
                                      previewLine.selectedItem.containerNo || "-"
                                    ].join(" · ")
                                  : "-"}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("systemQty")}</div>
                              <div className="mt-1 text-lg font-semibold text-[#102a56]">{previewLine.selectedItem ? previewLine.systemQty : "-"}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("countedQty")}</div>
                              <div className="mt-1 text-lg font-semibold text-[#102a56]">{previewLine.selectedItem ? previewLine.countedQty : "-"}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("varianceQty")}</div>
                              <div className={`mt-1 text-lg font-semibold ${previewLine.selectedItem ? previewLine.varianceQty === 0 ? "text-[#102a56]" : previewLine.varianceQty > 0 ? "text-[#2f6b5f]" : "text-[#b76857]" : "text-slate-400"}`}>
                                {previewLine.selectedItem ? formatSignedNumber(previewLine.varianceQty) : "-"}
                              </div>
                            </div>
                          </div>

                          {previewLine.palletPreviewLines.length > 0 ? (
                            <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("palletBreakdown")}</div>
                              <div className="mt-3 grid gap-3">
                                {previewLine.palletPreviewLines.map((palletLine) => (
                                  <div
                                    key={`review-${previewLine.line.id}-${palletLine.rowId}`}
                                    className="grid gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 lg:grid-cols-[minmax(220px,1.8fr)_110px_110px_110px]"
                                  >
                                    <div>
                                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("pallet")}</div>
                                      <div className="mt-1 text-sm font-semibold text-[#102a56]">{palletLine.palletCode}</div>
                                    </div>
                                    <div>
                                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("systemQty")}</div>
                                      <div className="mt-1 text-lg font-semibold text-[#102a56]">{palletLine.systemQty}</div>
                                    </div>
                                    <div>
                                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("countedQty")}</div>
                                      <div className="mt-1 text-lg font-semibold text-[#102a56]">{palletLine.countedQty}</div>
                                    </div>
                                    <div>
                                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("varianceQty")}</div>
                                      <div className={`mt-1 text-lg font-semibold ${palletLine.varianceQty === 0 ? "text-[#102a56]" : palletLine.varianceQty > 0 ? "text-[#2f6b5f]" : "text-[#b76857]"}`}>
                                        {formatSignedNumber(palletLine.varianceQty)}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {previewLine.line.lineNote ? (
                            <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                              <strong className="text-[#102a56]">{t("internalNotes")}: </strong>
                              {previewLine.line.lineNote}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 shipment-wizard__actions">
                      <button
                        type="button"
                        onClick={() => moveCycleCountWizardStep(2)}
                        className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50"
                      >
                        {t("cycleCountStepLines")}
                      </button>
                      <button
                        type="button"
                        onClick={closeCreateWorkspace}
                        className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50"
                      >
                        {t("discardDraft")}
                      </button>
                      <button
                        type="submit"
                        disabled={!canPostDraft}
                        className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-[#143569] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(20,53,105,0.18)] transition hover:bg-[#102f5f] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {submitting ? t("saving") : t("saveCycleCount")}
                      </button>
                    </div>
                  </>
                ) : null}
              </form>
            </>
          )}
        </section>
      ) : null}

      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("cycleCounts")}
            description={pageDescription}
            actions={canConfigureColumns ? (
              <div className="sheet-actions">
                {columnOrderAction}
              </div>
            ) : undefined}
            notices={[permissionNotice]}
          />
        </div>
        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={cycleCounts}
              columns={columns}
              loading={isLoading}
              pagination
              pageSizeOptions={[10, 25, 50]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              getRowHeight={() => 64}
              onRowClick={(params) => setSelectedCycleCountId(params.row.id)}
              getRowClassName={(params) => (params.row.id === selectedCycleCountId ? "document-row--selected" : "")}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>

      {columnOrderDialog}
      {feedbackToast}

      <Drawer
        anchor="right"
        open={Boolean(selectedCycleCount)}
        onClose={() => setSelectedCycleCountId(null)}
        PaperProps={{ className: "document-drawer" }}
      >
        {selectedCycleCount ? (
          <div className="document-drawer__content">
            <div className="document-drawer__header">
              <div>
                <div className="document-drawer__eyebrow">{t("cycleCounts")}</div>
                <h3>{selectedCycleCount.countNo}</h3>
                <p>{formatDateTimeValue(selectedCycleCount.createdAt, resolvedTimeZone)}</p>
              </div>
              <IconButton aria-label={t("close")} onClick={() => setSelectedCycleCountId(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </div>

            <div className="document-drawer__actions">
              <Button
                variant="outlined"
                startIcon={<HistoryOutlinedIcon fontSize="small" />}
                onClick={() => {
                  setPendingAllActivityContext({ movementType: "COUNT" });
                  onNavigate("all-activity");
                }}
              >
                {t("allActivity")}
              </Button>
            </div>

            <div className="document-drawer__status-bar">
              <div className="document-drawer__status-main">
                <Chip label={t("posted")} color="success" size="small" />
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedCycleCount.totalLines}</strong>
                <span>{t("totalLines")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{formatSignedNumber(selectedCycleCount.totalVariance)}</strong>
                <span>{t("varianceQty")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedCycleCount.status}</strong>
                <span>{t("status")}</span>
              </div>
            </div>

            <div className="document-drawer__audit-strip">
              <div className="document-drawer__audit-item">
                <strong>{t("created")}</strong>
                <span>{formatDateTimeValue(selectedCycleCount.createdAt, resolvedTimeZone)}</span>
              </div>
              <div className="document-drawer__audit-item">
                <strong>{t("updated")}</strong>
                <span>{formatDateTimeValue(selectedCycleCount.updatedAt, resolvedTimeZone)}</span>
              </div>
              <div className="document-drawer__audit-item">
                <strong>{t("status")}</strong>
                <span>{selectedCycleCount.status}</span>
              </div>
            </div>

            <div className="document-drawer__meta">
              <div className="sheet-note">
                <strong>{t("countNo")}</strong><br />
                {selectedCycleCount.countNo}
              </div>
              <div className="sheet-note">
                <strong>{t("created")}</strong><br />
                {formatDateTimeValue(selectedCycleCount.createdAt, resolvedTimeZone)}
              </div>
              <div className="sheet-note document-drawer__meta-note">
                <strong>{t("notes")}</strong><br />
                {selectedCycleCount.notes || "-"}
              </div>
            </div>

            <div className="document-drawer__section-title">{t("cycleCountLines")}</div>
            <Box sx={{ minWidth: 0 }}>
              <DataGrid
                rows={selectedCycleCount.lines}
                columns={detailColumns}
                pagination
                pageSizeOptions={[10, 25, 50]}
                disableRowSelectionOnClick
                initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                getRowHeight={() => 64}
                slots={detailGridSlots}
                sx={{ border: 0 }}
              />
            </Box>
          </div>
        ) : null}
      </Drawer>
    </main>
  );
}

function displayDescription(item: Pick<Item, "description" | "name">) {
  return item.description || item.name;
}

function formatInventoryPositionOption(
  item: Item,
  t: (key: string) => string
) {
  return `${item.customerName} | ${item.locationName} / ${normalizeStorageSection(item.storageSection)} | ${item.sku} - ${displayDescription(item)} (${t("onHand")}: ${item.quantity})`;
}

function buildLaunchScopeLabel(
  context: InventoryActionContext | null,
  scopedItems: Item[],
  t: (key: string, params?: Record<string, string | number>) => string
) {
  if (context?.containerNo) {
    return t("cycleCountScopeByContainer", { containerNo: context.containerNo });
  }

  if (scopedItems.length > 0) {
    return t("cycleCountScopeBySku", {
      customerName: scopedItems[0].customerName,
      sku: scopedItems[0].sku
    });
  }

  return t("cycleCountScopeManual");
}

function filterItemsForLaunchContext(items: Item[], context: InventoryActionContext) {
  if (context.containerNo) {
    return items.filter((item) => item.containerNo.trim().toUpperCase() === context.containerNo);
  }

  if (context.sourceKey) {
    return items.filter((item) => buildInventoryActionSourceKey(item.customerId, item.sku) === context.sourceKey);
  }

  if (context.customerId && context.sku) {
    const sourceKey = buildInventoryActionSourceKey(context.customerId, context.sku);
    return items.filter((item) => buildInventoryActionSourceKey(item.customerId, item.sku) === sourceKey);
  }

  return items;
}

function matchesCycleCountPalletToItem(pallet: PalletTrace, item: Item) {
  return (pallet.status === "OPEN" || pallet.status === "PARTIAL")
    && pallet.customerId === item.customerId
    && pallet.currentLocationId === item.locationId
    && normalizeStorageSection(pallet.currentStorageSection) === normalizeStorageSection(item.storageSection)
    && normalizeContainerNumber(pallet.currentContainerNo) === normalizeContainerNumber(item.containerNo)
    && getCycleCountablePalletQty(pallet, item.skuMasterId) > 0;
}

function getCycleCountablePalletQty(pallet: PalletTrace, skuMasterId: number) {
  return pallet.contents
    .filter((content) => content.skuMasterId === skuMasterId)
    .reduce((sum, content) => sum + Math.max(0, content.quantity), 0);
}

function buildCycleCountPalletCounts(
  pallets: PalletTrace[],
  skuMasterId: number,
  existingCounts: CycleCountPalletFormState[] = []
) {
  const existingCountByPalletId = new Map(existingCounts
    .filter((entry) => !entry.isNew)
    .map((entry) => [entry.palletId, entry] as const));
  const newEntries = existingCounts.filter((entry) => entry.isNew);

  return [
    ...pallets
    .map((pallet) => {
      const systemQty = getCycleCountablePalletQty(pallet, skuMasterId);
      if (systemQty <= 0) {
        return null;
      }

      const existingEntry = existingCountByPalletId.get(pallet.id);
      return {
        rowId: existingEntry?.rowId ?? createCycleCountClientId(),
        palletId: pallet.id,
        palletCode: pallet.palletCode,
        countedQty: Math.max(0, existingEntry?.countedQty ?? systemQty),
        isNew: false
      };
    })
    .filter((entry): entry is CycleCountPalletFormState => Boolean(entry)),
    ...newEntries
  ];
}

function sumCycleCountPalletCounts(entries: CycleCountPalletFormState[]) {
  return entries.reduce((sum, entry) => sum + Math.max(0, entry.countedQty), 0);
}

function areCycleCountPalletCountsEqual(left: CycleCountPalletFormState[], right: CycleCountPalletFormState[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const other = right[index];
    return other
      && entry.rowId === other.rowId
      && entry.palletId === other.palletId
      && entry.palletCode === other.palletCode
      && entry.countedQty === other.countedQty
      && entry.isNew === other.isNew;
  });
}

function normalizeContainerNumber(value: string) {
  return value.trim().toUpperCase();
}

function numberInputValue(value: number) {
  return value === 0 ? "" : String(value);
}

function formatSignedNumber(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
