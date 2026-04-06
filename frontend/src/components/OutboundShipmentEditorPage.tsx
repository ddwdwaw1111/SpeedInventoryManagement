import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import { Box, Button } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/api";
import { buildItemContainerBalances, formatContainerDistributionSummary as formatContainerDistributionSummaryValue, type ItemContainerBalance } from "../lib/containerBalances";
import { consumePendingOutboundShipmentEditorLaunchContext, type OutboundShipmentEditorLaunchContext } from "../lib/outboundShipmentEditorLaunchContext";
import { useI18n } from "../lib/i18n";
import { getOutboundExpectedShipDate } from "../lib/outboundDates";
import {
  DEFAULT_STORAGE_SECTION,
  normalizeStorageSection,
  type Item,
  type Movement,
  type OutboundDocument,
  type OutboundLinePalletPick,
  type OutboundDocumentPayload,
  type PalletTrace,
  type SKUMaster,
  type UserRole
} from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import { OutboundPickPlanPanel } from "./OutboundPickPlanPanel";
import { WorkspacePanelHeader } from "./WorkspacePanelChrome";

type OutboundWizardStep = 1 | 2 | 3;

type BatchOutboundFormState = {
  packingListNo: string;
  orderRef: string;
  expectedShipDate: string;
  actualShipDate: string;
  shipToName: string;
  shipToAddress: string;
  shipToContact: string;
  carrierName: string;
  documentNote: string;
};

type BatchOutboundLineState = {
  id: string;
  sourceKey: string;
  quantity: number;
  pallets: number;
  palletsDetailCtns: string;
  unitLabel: string;
  cartonSizeMm: string;
  netWeightKgs: number;
  grossWeightKgs: number;
  reason: string;
  pickPallets: OutboundLinePalletPick[];
  pickPalletsTouched: boolean;
};

type OutboundShipmentEditorLocalDraft = {
  version: 1;
  form: BatchOutboundFormState;
  lines: BatchOutboundLineState[];
  step: OutboundWizardStep;
};

type OutboundAllocationPreviewRow = {
  id: string;
  lineId: string;
  lineLabel: string;
  itemNumber: string;
  sku: string;
  description: string;
  locationName: string;
  storageSection: string;
  containerNo: string;
  palletId: number;
  palletCode: string;
  availableQty: number;
  allocatedQty: number;
};

type OutboundAllocationLineSummary = {
  lineId: string;
  lineLabel: string;
  sourceKey: string;
  itemNumber: string;
  sku: string;
  description: string;
  locationName: string;
  storageSection: string;
  requestedQty: number;
  allocatedQty: number;
  shortageQty: number;
  containerCount: number;
};

type OutboundAllocationPreviewResult = {
  rows: OutboundAllocationPreviewRow[];
  summaries: Map<string, OutboundAllocationLineSummary>;
  totalRequestedQty: number;
  totalAllocatedQty: number;
  totalContainerCount: number;
  splitLineCount: number;
  shortageLineCount: number;
};

type OutboundSourceOption = {
  sourceKey: string;
  customerId: number;
  customerName: string;
  locationId: number;
  locationName: string;
  skuMasterId: number;
  sku: string;
  itemNumber: string;
  description: string;
  unit: string;
  availableQty: number;
  palletCount: number;
  storageSections: string[];
  containerCount: number;
  containerSummary: string;
  candidates: OutboundPalletCandidate[];
};

type OutboundPalletCandidate = {
  id: string;
  palletId: number;
  palletCode: string;
  customerId: number;
  customerName: string;
  locationId: number;
  locationName: string;
  storageSection: string;
  containerNo: string;
  skuMasterId: number;
  sku: string;
  itemNumber: string;
  description: string;
  unit: string;
  availableQty: number;
  actualArrivalDate: string | null;
  createdAt: string;
};

type OutboundShipmentEditorPageProps = {
  routeKey: string;
  documentId: number | null;
  document: OutboundDocument | null;
  items: Item[];
  skuMasters: SKUMaster[];
  movements: Movement[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onBackToList: () => void;
  onOpenOutboundDocument: (documentId: number) => void;
  onOpenShipmentEditor: (documentId?: number | null, context?: OutboundShipmentEditorLaunchContext) => void;
};

export function OutboundShipmentEditorPage({
  routeKey,
  documentId,
  document,
  items,
  skuMasters,
  movements,
  currentUserRole,
  isLoading,
  onRefresh,
  onBackToList,
  onOpenOutboundDocument,
  onOpenShipmentEditor
}: OutboundShipmentEditorPageProps) {
  const { t } = useI18n();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const [pallets, setPallets] = useState<PalletTrace[]>([]);
  const [batchOutboundForm, setBatchOutboundForm] = useState<BatchOutboundFormState>(() => createEmptyBatchOutboundForm());
  const [batchOutboundLines, setBatchOutboundLines] = useState<BatchOutboundLineState[]>(() => [createEmptyBatchOutboundLine()]);
  const [errorMessage, setErrorMessage] = useState("");
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [outboundWizardStep, setOutboundWizardStep] = useState<OutboundWizardStep>(1);
  const [batchOutboundLineAddCount, setBatchOutboundLineAddCount] = useState(1);
  const [expandedOutboundPickPlans, setExpandedOutboundPickPlans] = useState<Record<string, boolean>>({});
  const [hasRestoredLocalDraft, setHasRestoredLocalDraft] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const pendingBatchLineIDRef = useRef<string | null>(null);
  const lastInitializedRouteRef = useRef<string | null>(null);
  const draftStorageKey = useMemo(() => getOutboundShipmentEditorDraftStorageKey(documentId), [documentId]);
  const skuMastersBySku = useMemo(() => new Map(
    skuMasters.map((skuMaster) => [normalizeSkuLookupValue(skuMaster.sku), skuMaster] as const)
  ), [skuMasters]);
  const skuMastersByID = useMemo(() => new Map(
    skuMasters.map((skuMaster) => [skuMaster.id, skuMaster] as const)
  ), [skuMasters]);
  const availableOutboundSources = useMemo(
    () => pallets.length > 0
      ? buildOutboundSourceOptionsFromPallets(pallets, skuMastersByID)
      : buildOutboundSourceOptions(items.filter((item) => item.availableQty > 0), movements),
    [items, movements, pallets, skuMastersByID]
  );
  const selectableOutboundSources = useMemo(() => {
    const selectedKeys = new Set(
      batchOutboundLines
        .map((line) => line.sourceKey.trim())
        .filter(Boolean)
    );

    const merged = [...availableOutboundSources];
    for (const selectedKey of selectedKeys) {
      const selectedItem = items.find((item) => buildOutboundSourceKey(item.customerId, item.locationId, item.skuMasterId) === selectedKey);
      const source = selectedItem
        ? buildOutboundSourceOptions(items.filter((item) =>
          item.customerId === selectedItem.customerId
          && item.locationId === selectedItem.locationId
          && item.skuMasterId === selectedItem.skuMasterId
        ), movements)[0]
        : null;
      if (source && !merged.some((item) => item.sourceKey === source.sourceKey)) {
        merged.push(source);
      }
    }

    return merged.sort((left, right) => {
      const customerCompare = left.customerName.localeCompare(right.customerName);
      if (customerCompare !== 0) return customerCompare;
      const locationCompare = left.locationName.localeCompare(right.locationName);
      if (locationCompare !== 0) return locationCompare;
      return left.sku.localeCompare(right.sku);
    });
  }, [availableOutboundSources, batchOutboundLines, items, movements]);
  const batchOutboundAllocationPreview = useMemo(
    () => buildOutboundAllocationPreview(batchOutboundLines, selectableOutboundSources),
    [batchOutboundLines, selectableOutboundSources]
  );
  const validBatchOutboundLines = useMemo(
    () => batchOutboundLines.filter((line) => line.sourceKey.trim() !== "" && line.quantity > 0),
    [batchOutboundLines]
  );
  const outboundAllocationPreviewColumns = useMemo<GridColDef<OutboundAllocationPreviewRow>[]>(() => [
    { field: "lineLabel", headerName: t("shipmentLine"), minWidth: 120, renderCell: (params) => params.row.lineLabel },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 150, flex: 1, renderCell: (params) => `${params.row.locationName} / ${normalizeStorageSection(params.row.storageSection)}` },
    { field: "containerNo", headerName: t("sourceContainer"), minWidth: 170, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.containerNo || "-"}</span> },
    { field: "palletCode", headerName: t("palletCode"), minWidth: 150, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.palletCode || "-"}</span> },
    { field: "allocatedQty", headerName: t("pickQty"), minWidth: 100, type: "number" },
    { field: "itemNumber", headerName: t("itemNumber"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.itemNumber || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 110, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 220, flex: 1.2, renderCell: (params) => params.row.description || "-" }
  ], [t]);
  const isEditingOutboundDraft = normalizeDocumentStatus(document?.status ?? "") === "DRAFT";
  const isEditingConfirmedOutbound = normalizeDocumentStatus(document?.status ?? "") === "CONFIRMED";
  const isEditingExistingDocument = Boolean(documentId && document);
  const isEditorMissing = Boolean(documentId) && !document && !isLoading;
  const canEditCurrentDocument = !document || (!document.archivedAt && normalizeDocumentStatus(document.status) === "DRAFT");
  const isReadOnly = !canManage || !canEditCurrentDocument;
  const hasNoAvailableSources = availableOutboundSources.length === 0 && !isEditingOutboundDraft && !isEditingConfirmedOutbound;

  useEffect(() => {
    let active = true;

    async function loadPallets() {
      try {
        const nextPallets = await api.getPallets(50000);
        if (!active) {
          return;
        }
        setPallets(nextPallets);
      } catch {
        if (active) {
          setPallets([]);
        }
      }
    }

    void loadPallets();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!pendingBatchLineIDRef.current) {
      return;
    }

    const nextLine = window.document.getElementById(`shipment-editor-line-${pendingBatchLineIDRef.current}`);
    if (!nextLine) {
      return;
    }

    nextLine.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const firstInput = nextLine.querySelector("input, select");
    if (firstInput instanceof HTMLInputElement || firstInput instanceof HTMLSelectElement) {
      firstInput.focus();
      if (firstInput instanceof HTMLInputElement) {
        firstInput.select();
      }
    }

    pendingBatchLineIDRef.current = null;
  }, [batchOutboundLines]);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (lastInitializedRouteRef.current === routeKey) {
      return;
    }
    if (documentId && !document) {
      lastInitializedRouteRef.current = routeKey;
      setIsEditorReady(true);
      return;
    }

    const launchContext = consumePendingOutboundShipmentEditorLaunchContext();
    const localDraft = loadOutboundShipmentEditorDraft(draftStorageKey);
    const sourceState = buildOutboundEditorSourceState({ document, launchContext });

    if (localDraft) {
      setBatchOutboundForm(localDraft.form);
      setBatchOutboundLines(localDraft.lines.length > 0 ? localDraft.lines : [createEmptyBatchOutboundLine()]);
      setOutboundWizardStep(localDraft.step);
      setHasRestoredLocalDraft(true);
    } else {
      setBatchOutboundForm(sourceState.form);
      setBatchOutboundLines(sourceState.lines);
      setOutboundWizardStep(1);
      setHasRestoredLocalDraft(false);
    }

    setErrorMessage("");
    setBatchSubmitting(false);
    setBatchOutboundLineAddCount(1);
    setExpandedOutboundPickPlans({});
    setIsEditorReady(true);
    lastInitializedRouteRef.current = routeKey;
  }, [document, documentId, draftStorageKey, isLoading, routeKey]);

  useEffect(() => {
    if (!isEditorReady || isReadOnly) {
      return;
    }

    saveOutboundShipmentEditorDraft(draftStorageKey, {
      version: 1,
      form: batchOutboundForm,
      lines: batchOutboundLines,
      step: outboundWizardStep
    });
  }, [batchOutboundForm, batchOutboundLines, draftStorageKey, isEditorReady, isReadOnly, outboundWizardStep]);

  useEffect(() => {
    setBatchOutboundLines((current) => {
      let changed = false;
      const nextLines = current.map((line) => {
        if (!line.sourceKey.trim() || line.pickPalletsTouched) {
          return line;
        }
        const selectedSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
        if (!selectedSource) {
          return line;
        }
        const nextPickPallets = buildAutoOutboundPalletSelections(line.quantity, selectedSource.candidates);
        const nextPalletCount = countSelectedOutboundPallets(nextPickPallets);
        if (
          areOutboundLinePalletPicksEqual(line.pickPallets, nextPickPallets)
          && line.pallets === nextPalletCount
        ) {
          return line;
        }
        changed = true;
        return {
          ...line,
          pallets: nextPalletCount,
          pickPallets: nextPickPallets
        };
      });
      return changed ? nextLines : current;
    });
  }, [selectableOutboundSources]);

  function showActionError(error: unknown, fallbackMessage: string) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    setErrorMessage(message);
    showError(message);
  }

  function showActionSuccess(message: string) {
    setErrorMessage("");
    showSuccess(message);
  }

  async function handleCopyCurrentShipment() {
    if (!canManage || !document?.id) {
      return;
    }

    setBatchSubmitting(true);
    setErrorMessage("");
    try {
      const copiedDocument = await api.copyOutboundDocument(document.id);
      await onRefresh();
      showActionSuccess(t("shipmentCopiedSuccess"));
      onOpenShipmentEditor(copiedDocument.id);
    } catch (error) {
      showActionError(error, t("couldNotCopyDocument"));
    } finally {
      setBatchSubmitting(false);
    }
  }

  function resetToSourceState() {
    const sourceState = buildOutboundEditorSourceState({ document, launchContext: null });
    setBatchOutboundForm(sourceState.form);
    setBatchOutboundLines(sourceState.lines);
    setOutboundWizardStep(1);
    setExpandedOutboundPickPlans({});
    setHasRestoredLocalDraft(false);
    clearOutboundShipmentEditorDraft(draftStorageKey);
  }

  function getSafeLineAddCount(value: number) {
    return Math.min(50, Math.max(1, Math.floor(value) || 1));
  }

  function addBatchOutboundLine(count = batchOutboundLineAddCount) {
    const safeCount = getSafeLineAddCount(count);
    const nextLines = Array.from({ length: safeCount }, () => createEmptyBatchOutboundLine());
    pendingBatchLineIDRef.current = nextLines[0]?.id ?? null;
    setBatchOutboundLines((current) => [...current, ...nextLines]);
  }

  function removeBatchOutboundLine(lineID: string) {
    setBatchOutboundLines((current) => current.length === 1 ? current : current.filter((line) => line.id !== lineID));
  }

  function buildOutboundLineDefaults(currentLine: BatchOutboundLineState, nextSource: OutboundSourceOption | undefined) {
    if (!nextSource) {
      return {
        ...currentLine,
        sourceKey: "",
        pickPallets: [],
        pickPalletsTouched: false
      };
    }

    const previousSource = findOutboundSourceOption(selectableOutboundSources, currentLine.sourceKey);
    const previousSkuMaster = previousSource ? skuMastersBySku.get(normalizeSkuLookupValue(previousSource.sku)) : undefined;
    const nextSkuMaster = skuMastersBySku.get(normalizeSkuLookupValue(nextSource.sku));
    const previousAutoPalletPlan = buildAutoPalletPlan(currentLine.quantity, previousSkuMaster?.defaultUnitsPerPallet ?? 0);
    const nextAutoPalletPlan = buildAutoPalletPlan(currentLine.quantity, nextSkuMaster?.defaultUnitsPerPallet ?? 0);
    const shouldRefreshPallets = currentLine.pallets <= 0 || (previousSkuMaster !== undefined && currentLine.pallets === previousAutoPalletPlan.pallets);
    const nextPickPallets = buildAutoOutboundPalletSelections(currentLine.quantity, nextSource.candidates);
    return {
      ...currentLine,
      sourceKey: nextSource.sourceKey,
      unitLabel: nextSource.unit?.toUpperCase() || currentLine.unitLabel || "PCS",
      pallets: shouldRefreshPallets ? Math.max(nextAutoPalletPlan.pallets, nextPickPallets.length) : currentLine.pallets,
      palletsDetailCtns: "",
      pickPallets: nextPickPallets,
      pickPalletsTouched: false
    };
  }

  function updateBatchOutboundLine(lineID: string, updates: Partial<BatchOutboundLineState>) {
    setBatchOutboundLines((current) => current.map((line) => line.id === lineID ? { ...line, ...updates } : line));
  }

  function updateBatchOutboundLineQuantity(lineID: string, nextQuantity: number) {
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const selectedSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
      const skuMaster = selectedSource ? skuMastersBySku.get(normalizeSkuLookupValue(selectedSource.sku)) : undefined;
      const previousAutoPalletPlan = buildAutoPalletPlan(line.quantity, skuMaster?.defaultUnitsPerPallet ?? 0);
      const nextAutoPalletPlan = buildAutoPalletPlan(nextQuantity, skuMaster?.defaultUnitsPerPallet ?? 0);
      const shouldKeepAutoPallets = line.pallets <= 0 || line.pallets === previousAutoPalletPlan.pallets;
      const nextPickPallets = line.pickPalletsTouched
        ? line.pickPallets
        : buildAutoOutboundPalletSelections(nextQuantity, selectedSource?.candidates ?? []);
      return {
        ...line,
        quantity: nextQuantity,
        pallets: line.pickPalletsTouched
          ? countSelectedOutboundPallets(nextPickPallets)
          : shouldKeepAutoPallets ? Math.max(nextAutoPalletPlan.pallets, nextPickPallets.length) : line.pallets,
        palletsDetailCtns: "",
        pickPallets: nextPickPallets
      };
    }));
  }

  function updateBatchOutboundLinePickPalletQuantity(lineID: string, palletID: number, nextQuantity: number) {
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }
      const nextPickPallets = normalizeOutboundLinePalletPicks([
        ...line.pickPallets.filter((entry) => entry.palletId !== palletID),
        ...(nextQuantity > 0 ? [{ palletId: palletID, quantity: nextQuantity }] : [])
      ]);
      return {
        ...line,
        pickPallets: nextPickPallets,
        pickPalletsTouched: true,
        pallets: countSelectedOutboundPallets(nextPickPallets)
      };
    }));
  }

  function toggleOutboundPickPlan(lineId: string) {
    setExpandedOutboundPickPlans((current) => ({
      ...current,
      [lineId]: !current[lineId]
    }));
  }

  function resetOutboundLinePickPallets(lineID: string) {
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }
      const selectedSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
      const skuMaster = selectedSource ? skuMastersBySku.get(normalizeSkuLookupValue(selectedSource.sku)) : undefined;
      const nextAutoPalletPlan = buildAutoPalletPlan(line.quantity, skuMaster?.defaultUnitsPerPallet ?? 0);
      const nextPickPallets = buildAutoOutboundPalletSelections(line.quantity, selectedSource?.candidates ?? []);
      return {
        ...line,
        pickPallets: nextPickPallets,
        pickPalletsTouched: false,
        pallets: Math.max(nextAutoPalletPlan.pallets, nextPickPallets.length)
      };
    }));
  }

  function validateOutboundDraft(requireAllocationReady: boolean) {
    if (validBatchOutboundLines.length === 0) {
      return t("batchOutboundRequireLine");
    }

    for (const line of validBatchOutboundLines) {
      const selectedOutboundSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
      if (!selectedOutboundSource) {
        return t("chooseSkuAndQty");
      }

      if (!requireAllocationReady) {
        continue;
      }

      const allocationSummary = batchOutboundAllocationPreview.summaries.get(line.id);
      if (!allocationSummary || allocationSummary.shortageQty > 0 || allocationSummary.allocatedQty !== line.quantity) {
        return t("outboundQtyExceedsStock", {
          sku: selectedOutboundSource.sku,
          available: allocationSummary?.allocatedQty ?? 0
        });
      }
    }

    return "";
  }

  function moveOutboundWizardStep(nextStep: OutboundWizardStep) {
    if (nextStep === outboundWizardStep) {
      return;
    }
    if (nextStep === 2) {
      const validationError = validateOutboundDraft(false);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }
    }
    if (nextStep === 3) {
      const validationError = validateOutboundDraft(true);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }
    }

    setErrorMessage("");
    if (nextStep === 2) {
      setExpandedOutboundPickPlans(
        Object.fromEntries(
          batchOutboundLines
            .filter((line) => line.sourceKey.trim() !== "")
            .map((line) => [line.id, true] as const)
        )
      );
    }
    setOutboundWizardStep(nextStep);
  }

  async function submitOutboundDocument(status: "DRAFT" | "CONFIRMED") {
    if (isEditingConfirmedOutbound) {
      setErrorMessage(t("confirmedShipmentImmutableNotice"));
      return;
    }

    setBatchSubmitting(true);
    setErrorMessage("");

    const validationError = validateOutboundDraft(true);
    if (validationError) {
      setErrorMessage(validationError);
      setBatchSubmitting(false);
      return;
    }

    try {
      const payload: OutboundDocumentPayload = {
        packingListNo: batchOutboundForm.packingListNo || undefined,
        orderRef: batchOutboundForm.orderRef || undefined,
        expectedShipDate: batchOutboundForm.expectedShipDate || undefined,
        actualShipDate: batchOutboundForm.actualShipDate || undefined,
        shipToName: batchOutboundForm.shipToName || undefined,
        shipToAddress: batchOutboundForm.shipToAddress || undefined,
        shipToContact: batchOutboundForm.shipToContact || undefined,
        carrierName: batchOutboundForm.carrierName || undefined,
        status,
        trackingStatus: status === "DRAFT"
          ? normalizeOutboundTrackingStatusValue(document?.trackingStatus, document?.status)
          : "SHIPPED",
        documentNote: batchOutboundForm.documentNote || undefined,
        lines: validBatchOutboundLines.map((line) => {
          const selectedOutboundSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
          if (!selectedOutboundSource) {
            throw new Error(t("chooseSkuAndQty"));
          }

          return {
            customerId: selectedOutboundSource.customerId,
            locationId: selectedOutboundSource.locationId,
            skuMasterId: selectedOutboundSource.skuMasterId,
            quantity: line.quantity,
            pallets: line.pallets > 0 ? line.pallets : countSelectedOutboundPallets(line.pickPallets),
            palletsDetailCtns: undefined,
            unitLabel: line.unitLabel || selectedOutboundSource.unit.toUpperCase() || "PCS",
            cartonSizeMm: line.cartonSizeMm || undefined,
            netWeightKgs: line.netWeightKgs,
            grossWeightKgs: line.grossWeightKgs,
            lineNote: line.reason || undefined,
            pickPallets: line.pickPallets.length > 0 ? line.pickPallets : undefined
          };
        })
      };

      const savedDocument = document?.id
        ? await api.updateOutboundDocument(document.id, payload)
        : await api.createOutboundDocument(payload);

      clearOutboundShipmentEditorDraft(draftStorageKey);
      setHasRestoredLocalDraft(false);
      await onRefresh();

      if (status === "DRAFT") {
        showActionSuccess(t("shipmentSavedSuccess"));
        if (!document?.id) {
          onOpenShipmentEditor(savedDocument.id);
        }
        return;
      }

      showActionSuccess(document?.id ? t("shipmentSavedSuccess") : t("shipmentConfirmedSuccess"));
      onOpenOutboundDocument(savedDocument.id);
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    } finally {
      setBatchSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (outboundWizardStep < 3) {
      moveOutboundWizardStep((outboundWizardStep + 1) as OutboundWizardStep);
      return;
    }

    void submitOutboundDocument("CONFIRMED");
  }

  if (isEditorMissing) {
    return (
      <main className="workspace-main">
        <div className="space-y-6 pb-6">
          <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
            <WorkspacePanelHeader title={t("shipmentEditorMissingTitle")} description={t("shipmentEditorMissingDesc")} />
            <div className="sheet-form__actions" style={{ marginTop: "1rem" }}>
              <button className="button button--primary" type="button" onClick={onBackToList}>{t("navShipping")}</button>
            </div>
          </section>
        </div>
        {feedbackToast}
      </main>
    );
  }

  if (!isEditorReady) {
    return (
      <main className="workspace-main">
        <div className="space-y-6 pb-6">
          <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
            <WorkspacePanelHeader title={t("loadingRecords")} description={t("shipmentEditorPageDesc")} />
          </section>
        </div>
        {feedbackToast}
      </main>
    );
  }

  return (
    <main className="workspace-main">
      <div className="space-y-6 pb-6">
        <section className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,#f4f8ff_0%,#eef4fb_100%)] px-5 py-5 shadow-[0_18px_48px_rgba(10,31,68,0.06)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 ring-1 ring-slate-200/70">
                <span>{t("shipmentEditorPage")}</span>
              </div>
              <div>
                <h1 className="font-headline text-3xl font-extrabold tracking-tight text-[#0d2d63]">
                  {document
                    ? (isEditingConfirmedOutbound ? t("shipmentEditorConfirmedTitle") : t("shipmentEditorDraftTitle"))
                    : t("shipmentEditorNewTitle")}
                </h1>
                <p className="mt-1.5 max-w-3xl text-sm text-slate-600">
                  {t("shipmentEditorPageDesc")}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {canManage && isEditingConfirmedOutbound && document?.id ? (
                <button
                  type="button"
                  onClick={() => void handleCopyCurrentShipment()}
                  className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50"
                >
                  {t("reEnterShipment")}
                </button>
              ) : null}
              {document?.id ? (
                <button
                  type="button"
                  onClick={() => onOpenOutboundDocument(document.id)}
                  className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50"
                >
                  <OpenInNewRoundedIcon sx={{ fontSize: 18 }} />
                  {t("details")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onBackToList}
                className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-[#143569] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(20,53,105,0.18)] transition hover:bg-[#102f5f]"
              >
                {t("back")}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
          <WorkspacePanelHeader title={t("shipmentEditorPage")} description={t("shipmentEditorStepHint")} />

          {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
          {hasRestoredLocalDraft ? (
            <InlineAlert severity="info">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{t("shipmentLocalDraftRestored")}</span>
                <button className="button button--ghost" type="button" onClick={resetToSourceState}>{t("discardLocalDraft")}</button>
              </div>
            </InlineAlert>
          ) : null}
          {isEditingConfirmedOutbound ? (
            <InlineAlert severity="warning">{t("confirmedShipmentImmutableNotice")}</InlineAlert>
          ) : null}
          {isReadOnly && !isEditingConfirmedOutbound ? (
            <InlineAlert severity="warning">{t("readOnlyModeNotice")}</InlineAlert>
          ) : null}
          {hasNoAvailableSources ? (
            <InlineAlert severity="warning">{t("noAvailableStockRows")}</InlineAlert>
          ) : null}

          <form onSubmit={handleSubmit}>
            <div className="shipment-wizard__steps">
              {([
                [1, t("shipmentStepInfo")],
                [2, t("shipmentStepPickPlan")],
                [3, t("shipmentStepReview")]
              ] as const).map(([step, label]) => (
                <button
                  key={step}
                  type="button"
                  className={`shipment-wizard__step ${outboundWizardStep === step ? "shipment-wizard__step--active" : ""}`}
                  onClick={() => moveOutboundWizardStep(step)}
                  disabled={isReadOnly}
                >
                  <span className="shipment-wizard__step-index">{step}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {outboundWizardStep === 1 ? (
              <div className="sheet-form sheet-form--compact">
                <label>{t("packingListNo")}<input value={batchOutboundForm.packingListNo} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, packingListNo: event.target.value }))} placeholder="TGCUS180265" disabled={isReadOnly} /></label>
                <label>{t("orderRef")}<input value={batchOutboundForm.orderRef} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, orderRef: event.target.value }))} placeholder="J73504" disabled={isReadOnly} /></label>
                <label>{t("expectedShipDate")}<input type="date" value={batchOutboundForm.expectedShipDate} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, expectedShipDate: event.target.value }))} disabled={isReadOnly} /></label>
                <label>{t("actualShipDate")}<input type="date" value={batchOutboundForm.actualShipDate} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, actualShipDate: event.target.value }))} disabled={isReadOnly} /></label>
                <label>{t("shipToName")}<input value={batchOutboundForm.shipToName} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, shipToName: event.target.value }))} placeholder="Receiver name" disabled={isReadOnly} /></label>
                <label>{t("shipToContact")}<input value={batchOutboundForm.shipToContact} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, shipToContact: event.target.value }))} placeholder="+1 555 010 0200" disabled={isReadOnly} /></label>
                <label>{t("carrier")}<input value={batchOutboundForm.carrierName} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, carrierName: event.target.value }))} placeholder="FedEx" disabled={isReadOnly} /></label>
                <label className="sheet-form__wide">{t("shipToAddress")}<input value={batchOutboundForm.shipToAddress} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, shipToAddress: event.target.value }))} placeholder="Delivery address" disabled={isReadOnly} /></label>
                <label className="sheet-form__wide">{t("documentNotes")}<input value={batchOutboundForm.documentNote} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, documentNote: event.target.value }))} placeholder={t("outboundDocumentNotePlaceholder")} disabled={isReadOnly} /></label>
              </div>
            ) : null}

            {outboundWizardStep !== 3 ? (
              <div className="batch-lines">
                <div className="batch-lines__toolbar batch-lines__toolbar--sticky">
                  <strong>{outboundWizardStep === 2 ? t("pickAllocations") : t("outboundLines")}</strong>
                  {outboundWizardStep === 1 ? (
                    <div className="batch-lines__adder">
                      <label className="batch-lines__adder-label">
                        {t("rowsToAdd")}
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={batchOutboundLineAddCount}
                          onChange={(event) => setBatchOutboundLineAddCount(getSafeLineAddCount(Number(event.target.value || 1)))}
                          disabled={isReadOnly}
                        />
                      </label>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AddCircleOutlineOutlinedIcon />}
                        onClick={() => addBatchOutboundLine()}
                        disabled={isReadOnly}
                      >
                        {t("addOutboundLine")}
                      </Button>
                    </div>
                  ) : (
                    <span className="batch-line-card__hint">{t("pickPlanStepHint")}</span>
                  )}
                </div>
                <datalist id="outbound-unit-presets">
                  <option value="PCS" />
                  <option value="CTN" />
                  <option value="PLT" />
                  <option value="BAG" />
                </datalist>

                {batchOutboundLines.map((line, index) => {
                  const selectedOutboundSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
                  const outboundAllocationSummary = batchOutboundAllocationPreview.summaries.get(line.id);
                  const outboundAllocationRows = batchOutboundAllocationPreview.rows.filter((row) => row.lineId === line.id);
                  const outboundStorageSections = selectedOutboundSource
                    ? selectedOutboundSource.storageSections.map((section) => normalizeStorageSection(section)).join(", ") || DEFAULT_STORAGE_SECTION
                    : DEFAULT_STORAGE_SECTION;
                  const outboundLocationDisplay = selectedOutboundSource
                    ? `${selectedOutboundSource.locationName} / ${outboundStorageSections}`
                    : "-";
                  const isOutboundPickPlanExpanded = Boolean(expandedOutboundPickPlans[line.id]);
                  const hasOutboundShortage = (outboundAllocationSummary?.shortageQty ?? 0) > 0;

                  return (
                    <div className="batch-line-card" key={line.id} id={`shipment-editor-line-${line.id}`}>
                      <div className="batch-line-card__header">
                        <div className="batch-line-card__title">
                          <strong>{t("shipmentSource")} #{index + 1}</strong>
                          <span className={`status-pill ${selectedOutboundSource ? "status-pill--ok" : "status-pill--alert"}`}>
                            {selectedOutboundSource ? t("selected") : t("selectShipmentSource")}
                          </span>
                          {outboundWizardStep === 1 && selectedOutboundSource && line.quantity > 0 && line.quantity > selectedOutboundSource.availableQty ? (
                            <span className="status-pill status-pill--alert">{t("insufficientStock")}</span>
                          ) : null}
                        </div>
                        <button className="button button--danger button--small" type="button" onClick={() => removeBatchOutboundLine(line.id)} disabled={isReadOnly || batchOutboundLines.length === 1}>{t("removeLine")}</button>
                      </div>
                      {outboundWizardStep === 1 ? (
                        <div className="batch-line-grid batch-line-grid--outbound">
                          <label className="batch-line-grid__description">
                            {t("shipmentSource")}
                            <select
                              value={line.sourceKey}
                              onChange={(event) => {
                                const nextItem = findOutboundSourceOption(selectableOutboundSources, event.target.value);
                                setBatchOutboundLines((current) => current.map((currentLine) =>
                                  currentLine.id === line.id ? buildOutboundLineDefaults(currentLine, nextItem) : currentLine
                                ));
                              }}
                              disabled={isReadOnly}
                            >
                              <option value="">{t("selectShipmentSource")}</option>
                              {selectableOutboundSources.map((item) => (
                                <option key={item.sourceKey} value={item.sourceKey}>
                                  {`${item.customerName} | ${item.locationName} / ${item.storageSections.join(", ") || DEFAULT_STORAGE_SECTION} | ${t("containers")}: ${item.containerCount} | ${t("itemNumber")}: ${item.itemNumber || "-"} | ${item.sku} - ${item.description} (${t("availableQty")}: ${item.availableQty})`}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>{t("availableQty")}<input value={selectedOutboundSource ? String(selectedOutboundSource.availableQty) : ""} readOnly /></label>
                          <label>{t("outQty")}<input type="number" min="0" value={numberInputValue(line.quantity)} onChange={(event) => updateBatchOutboundLineQuantity(line.id, Math.max(0, Number(event.target.value || 0)))} disabled={isReadOnly} /></label>
                          <label>{t("pallets")}<input type="number" min="0" value={numberInputValue(line.pallets)} readOnly disabled /></label>
                          <label>{t("unit")}<input value={line.unitLabel} onChange={(event) => updateBatchOutboundLine(line.id, { unitLabel: event.target.value })} placeholder="PCS" disabled={isReadOnly} list="outbound-unit-presets" /></label>
                          <label>{t("cartonSize")}<input value={line.cartonSizeMm} onChange={(event) => updateBatchOutboundLine(line.id, { cartonSizeMm: event.target.value })} placeholder="455*330*325" disabled={isReadOnly} /></label>
                          <label>{t("netWeight")}<input type="number" min="0" step="0.01" value={numberInputValue(line.netWeightKgs)} onChange={(event) => updateBatchOutboundLine(line.id, { netWeightKgs: Math.max(0, Number(event.target.value || 0)) })} disabled={isReadOnly} /></label>
                          <label>{t("grossWeight")}<input type="number" min="0" step="0.01" value={numberInputValue(line.grossWeightKgs)} onChange={(event) => updateBatchOutboundLine(line.id, { grossWeightKgs: Math.max(0, Number(event.target.value || 0)) })} disabled={isReadOnly} /></label>
                          <label className="batch-line-grid__detail">{t("internalNotes")}<input value={line.reason} onChange={(event) => updateBatchOutboundLine(line.id, { reason: event.target.value })} placeholder={t("outboundInternalNotePlaceholder")} disabled={isReadOnly} /></label>
                        </div>
                      ) : null}
                      <div className="batch-line-card__meta">
                        <span className="batch-line-card__hint">
                          {selectedOutboundSource
                            ? `${selectedOutboundSource.customerName} | ${t("itemNumber")}: ${selectedOutboundSource.itemNumber || "-"} | ${selectedOutboundSource.sku} | ${selectedOutboundSource.description} | ${outboundLocationDisplay} | ${t("containerDistribution")}: ${selectedOutboundSource.containerSummary || "-"} | ${t("availableQty")}: ${selectedOutboundSource.availableQty}`
                            : t("selectShipmentSource")}
                        </span>
                      </div>
                      {selectedOutboundSource && outboundWizardStep === 2 && line.pickPalletsTouched ? (
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.25rem" }}>
                          <button className="button button--ghost button--small" type="button" onClick={() => resetOutboundLinePickPallets(line.id)}>{t("resetToAutoPick")}</button>
                        </div>
                      ) : null}
                      {selectedOutboundSource && outboundWizardStep === 2 ? (
                        <OutboundPickPlanPanel
                          title={t("containerPickPlan")}
                          helperText={t("pickPlanAutoModeHint")}
                          autoPickLabel={t("autoPick")}
                          detailsLabel={t("details")}
                          skuLabel={t("sku")}
                          skuValue={selectedOutboundSource.sku}
                          itemNumberLabel={t("itemNumber")}
                          itemNumberValue={selectedOutboundSource.itemNumber || undefined}
                          locationLabel={t("currentStorage")}
                          locationValue={outboundLocationDisplay}
                          containersLabel={t("containers")}
                          containerCount={outboundAllocationSummary?.containerCount ?? 0}
                          availableQtyLabel={t("availableQty")}
                          availableQtyValue={selectedOutboundSource.availableQty}
                          requiredQtyLabel={t("requiredQty")}
                          requiredQtyValue={line.quantity}
                          selectedQtyLabel={t("selectedQty")}
                          selectedQtyValue={outboundAllocationSummary?.allocatedQty ?? 0}
                          remainingQtyLabel={t("remainingQty")}
                          remainingQtyValue={outboundAllocationSummary?.shortageQty ?? 0}
                          sourceContainerLabel={t("sourceContainer")}
                          pickQtyLabel={t("pickQty")}
                          unitLabel={line.unitLabel || selectedOutboundSource.unit.toUpperCase() || "PCS"}
                          palletLabel={t("pallet")}
                          canExpand={outboundAllocationRows.length > 0}
                          expanded={isOutboundPickPlanExpanded}
                          onToggle={() => toggleOutboundPickPlan(line.id)}
                          emptyHint={t("pickAllocationPreviewEmpty")}
                          rows={outboundAllocationRows.map((row) => ({
                            id: row.id,
                            palletId: row.palletId,
                            palletCode: row.palletCode,
                            containerNo: row.containerNo,
                            locationLabel: `${row.locationName} / ${normalizeStorageSection(row.storageSection)}`,
                            availableQty: row.availableQty,
                            allocatedQty: row.allocatedQty,
                            itemNumber: row.itemNumber || undefined
                          }))}
                          editable={!isReadOnly}
                          inputDisabled={isReadOnly}
                          onAllocatedQtyChange={(rowId, allocatedQty) => {
                            const palletRow = outboundAllocationRows.find((row) => row.id === rowId);
                            if (!palletRow) {
                              return;
                            }
                            updateBatchOutboundLinePickPalletQuantity(line.id, palletRow.palletId, allocatedQty);
                          }}
                          shortageMessage={hasOutboundShortage ? t("outboundQtyExceedsStock", {
                            sku: selectedOutboundSource.sku,
                            available: outboundAllocationSummary?.allocatedQty ?? 0
                          }) : null}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {outboundWizardStep === 3 ? (
              <div className="batch-allocation-preview">
                <div className="batch-allocation-preview__header">
                  <div>
                    <strong>{t("pickAllocationPreview")}</strong>
                    <span>{t("reviewStepHint")}</span>
                  </div>
                  <div className="batch-allocation-preview__stats">
                    <div className="batch-allocation-preview__stat">
                      <strong>{batchOutboundAllocationPreview.totalContainerCount}</strong>
                      <span>{t("containers")}</span>
                    </div>
                    <div className="batch-allocation-preview__stat">
                      <strong>{batchOutboundAllocationPreview.rows.length}</strong>
                      <span>{t("pickRows")}</span>
                    </div>
                    <div className="batch-allocation-preview__stat">
                      <strong>{batchOutboundAllocationPreview.splitLineCount}</strong>
                      <span>{t("splitLines")}</span>
                    </div>
                    <div className="batch-allocation-preview__stat">
                      <strong>{validBatchOutboundLines.length}</strong>
                      <span>{t("totalLines")}</span>
                    </div>
                  </div>
                </div>

                {batchOutboundAllocationPreview.shortageLineCount > 0 ? (
                  <InlineAlert severity="warning">
                    {t("pickAllocationPreviewShortage")}
                  </InlineAlert>
                ) : null}

                <div className="batch-lines">
                  <div className="batch-line-card inbound-compact-card">
                    <div className="batch-line-card__header">
                      <div className="batch-line-card__title">
                        <strong>{batchOutboundForm.packingListNo.trim() || t("packingListNo")}</strong>
                        <span className="status-pill status-pill--ok">{t("shipmentStepReview")}</span>
                      </div>
                    </div>
                    <div className="batch-line-card__meta">
                      <span className="batch-line-card__hint">
                        {[
                          batchOutboundForm.actualShipDate || batchOutboundForm.expectedShipDate || "-",
                          batchOutboundForm.shipToName.trim() || "-",
                          batchOutboundForm.carrierName.trim() || "-"
                        ].join(" | ")}
                      </span>
                      <span className="batch-line-card__hint">
                        {batchOutboundForm.shipToAddress.trim() || t("shipToAddress")}
                      </span>
                    </div>
                  </div>
                  {validBatchOutboundLines.map((line, index) => {
                    const selectedOutboundSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
                    const allocationSummary = batchOutboundAllocationPreview.summaries.get(line.id);
                    return (
                      <div className="batch-line-card" key={line.id}>
                        <div className="batch-line-card__header">
                          <div className="batch-line-card__title">
                            <strong>{t("shipmentLine")} #{index + 1}</strong>
                            <span className={`status-pill ${(allocationSummary?.shortageQty ?? 0) > 0 ? "status-pill--alert" : "status-pill--ok"}`}>
                              {(allocationSummary?.shortageQty ?? 0) > 0 ? t("remainingQty") : t("selected")}
                            </span>
                          </div>
                          <span className="cell--mono">{selectedOutboundSource?.sku || "-"}</span>
                        </div>
                        <div className="batch-line-card__meta">
                          <span className="batch-line-card__hint">{selectedOutboundSource?.description || t("selectShipmentSource")}</span>
                          <span className="batch-line-card__hint">
                            {[
                              `${t("requiredQty")}: ${line.quantity}`,
                              `${t("selectedQty")}: ${allocationSummary?.allocatedQty ?? 0}`,
                              `${t("remainingQty")}: ${allocationSummary?.shortageQty ?? 0}`,
                              `${t("pallets")}: ${line.pallets}`
                            ].join(" · ")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {batchOutboundAllocationPreview.rows.length > 0 ? (
                  <Box sx={{ minWidth: 0, height: 260 }}>
                    <DataGrid
                      rows={batchOutboundAllocationPreview.rows}
                      columns={outboundAllocationPreviewColumns}
                      pagination
                      pageSizeOptions={[5, 10, 20]}
                      disableRowSelectionOnClick
                      initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
                      getRowHeight={() => 64}
                      sx={{ border: 0 }}
                    />
                  </Box>
                ) : (
                  <div className="sheet-note sheet-note--readonly">
                    {t("pickAllocationPreviewEmpty")}
                  </div>
                )}
              </div>
            ) : null}

            <div className="sheet-form__actions" style={{ marginTop: "1rem" }}>
              {isEditingConfirmedOutbound ? (
                <button className="button button--ghost" type="button" disabled={batchSubmitting} onClick={() => void handleCopyCurrentShipment()}>{t("reEnterShipment")}</button>
              ) : (
                <button className="button button--ghost" type="button" disabled={batchSubmitting || isReadOnly || hasNoAvailableSources} onClick={() => void submitOutboundDocument("DRAFT")}>{batchSubmitting ? t("saving") : isEditingOutboundDraft ? t("saveChanges") : t("scheduleShipment")}</button>
              )}
              <div className="shipment-wizard__actions">
                {outboundWizardStep > 1 ? (
                  <button className="button button--ghost" type="button" onClick={() => moveOutboundWizardStep((outboundWizardStep - 1) as OutboundWizardStep)} disabled={isReadOnly}>{t("back")}</button>
                ) : null}
                {outboundWizardStep < 3 ? (
                  <button className="button button--primary" type="button" onClick={() => moveOutboundWizardStep((outboundWizardStep + 1) as OutboundWizardStep)} disabled={isReadOnly}>{t("next")}</button>
                ) : !isEditingConfirmedOutbound ? (
                  <button className="button button--primary" type="submit" disabled={batchSubmitting || isReadOnly || hasNoAvailableSources}>{batchSubmitting ? t("saving") : isEditingOutboundDraft ? t("saveChanges") : t("confirmShipment")}</button>
                ) : null}
              </div>
              <button className="button button--ghost" type="button" onClick={onBackToList}>{t("cancel")}</button>
            </div>
          </form>
        </section>
      </div>
      {feedbackToast}
    </main>
  );
}

function createEmptyBatchOutboundForm(expectedShipDate = ""): BatchOutboundFormState {
  return {
    packingListNo: "",
    orderRef: "",
    expectedShipDate,
    actualShipDate: "",
    shipToName: "",
    shipToAddress: "",
    shipToContact: "",
    carrierName: "",
    documentNote: ""
  };
}

function createEmptyBatchOutboundLine(): BatchOutboundLineState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceKey: "",
    quantity: 0,
    pallets: 0,
    palletsDetailCtns: "",
    unitLabel: "PCS",
    cartonSizeMm: "",
    netWeightKgs: 0,
    grossWeightKgs: 0,
    reason: "",
    pickPallets: [],
    pickPalletsTouched: false
  };
}

function normalizeSkuLookupValue(value: string) {
  return value.trim().toUpperCase();
}

function displayDescription(item: Pick<Item, "description" | "name">) {
  return item.description || item.name;
}

function numberInputValue(value: number) {
  return value === 0 ? "" : String(value);
}

function normalizeDocumentStatus(status: string) {
  return status.trim().toUpperCase();
}

function normalizeOutboundTrackingStatusValue(trackingStatus?: string | null, documentStatus?: string | null) {
  const normalizedStatus = normalizeDocumentStatus(documentStatus || "");
  if (normalizedStatus === "CONFIRMED") {
    return "SHIPPED";
  }
  const normalizedTrackingStatus = (trackingStatus || "").trim().toUpperCase();
  if (normalizedTrackingStatus === "PICKING" || normalizedTrackingStatus === "PACKED" || normalizedTrackingStatus === "SHIPPED") {
    return normalizedTrackingStatus;
  }
  return "SCHEDULED";
}

function buildAutoPalletPlan(totalQty: number, unitsPerPallet: number) {
  if (totalQty <= 0 || unitsPerPallet <= 0) {
    return { pallets: 0, detail: "" };
  }

  const fullPallets = Math.floor(totalQty / unitsPerPallet);
  const remainder = totalQty % unitsPerPallet;
  const pallets = fullPallets + (remainder > 0 ? 1 : 0);

  if (fullPallets === 0) {
    return { pallets, detail: `1*${totalQty}` };
  }

  if (remainder === 0) {
    return { pallets, detail: `${pallets}*${unitsPerPallet}` };
  }

  return { pallets, detail: `${fullPallets}*${unitsPerPallet}+1*${remainder}` };
}

function buildOutboundAllocationPreview(lines: BatchOutboundLineState[], sourceOptions: OutboundSourceOption[]): OutboundAllocationPreviewResult {
  const rows: OutboundAllocationPreviewRow[] = [];
  const summaries = new Map<string, OutboundAllocationLineSummary>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.sourceKey.trim() || line.quantity <= 0) {
      continue;
    }

    const selectedSource = findOutboundSourceOption(sourceOptions, line.sourceKey);
    if (!selectedSource) {
      continue;
    }

    const summary: OutboundAllocationLineSummary = {
      lineId: line.id,
      lineLabel: `#${index + 1}`,
      sourceKey: selectedSource.sourceKey,
      itemNumber: selectedSource.itemNumber || "",
      sku: selectedSource.sku,
      description: selectedSource.description,
      locationName: selectedSource.locationName,
      storageSection: selectedSource.storageSections[0] || DEFAULT_STORAGE_SECTION,
      requestedQty: line.quantity,
      allocatedQty: 0,
      shortageQty: 0,
      containerCount: 0
    };

    const selectedPalletQuantities = new Map(
      normalizeOutboundLinePalletPicks(line.pickPallets).map((entry) => [entry.palletId, entry.quantity] as const)
    );
    for (const candidate of selectedSource.candidates) {
      const allocatedQty = selectedPalletQuantities.get(candidate.palletId) ?? 0;
      if (allocatedQty <= 0 || allocatedQty > candidate.availableQty) {
        continue;
      }

      rows.push({
        id: `${line.id}-${candidate.palletId}`,
        lineId: line.id,
        lineLabel: summary.lineLabel,
        itemNumber: selectedSource.itemNumber || summary.itemNumber,
        sku: selectedSource.sku,
        description: selectedSource.description,
        locationName: candidate.locationName,
        storageSection: normalizeStorageSection(candidate.storageSection),
        containerNo: candidate.containerNo || "",
        palletId: candidate.palletId,
        palletCode: candidate.palletCode,
        availableQty: candidate.availableQty,
        allocatedQty
      });
      summary.allocatedQty += allocatedQty;
    }

    const containers = new Set(
      rows
        .filter((row) => row.lineId === line.id)
        .map((row) => row.containerNo || `${row.locationName}/${row.storageSection}`)
    );
    summary.containerCount = containers.size;
    summary.shortageQty = Math.max(0, line.quantity - summary.allocatedQty);
    summaries.set(line.id, summary);
  }

  return {
    rows,
    summaries,
    totalRequestedQty: Array.from(summaries.values()).reduce((sum, summary) => sum + summary.requestedQty, 0),
    totalAllocatedQty: Array.from(summaries.values()).reduce((sum, summary) => sum + summary.allocatedQty, 0),
    totalContainerCount: new Set(rows.map((row) => row.containerNo || `${row.locationName}/${row.storageSection}`)).size,
    splitLineCount: Array.from(summaries.values()).filter((summary) => summary.containerCount > 1).length,
    shortageLineCount: Array.from(summaries.values()).filter((summary) => summary.shortageQty > 0).length
  };
}

function compareOutboundAllocationCandidates(left: Item, right: Item) {
  const leftDeliveryDate = left.deliveryDate || "";
  const rightDeliveryDate = right.deliveryDate || "";
  if (!leftDeliveryDate && rightDeliveryDate) return 1;
  if (leftDeliveryDate && !rightDeliveryDate) return -1;
  if (leftDeliveryDate !== rightDeliveryDate) return leftDeliveryDate.localeCompare(rightDeliveryDate);

  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt);
  }

  return left.id - right.id;
}

function compareOutboundPalletCandidates(left: OutboundPalletCandidate, right: OutboundPalletCandidate) {
  const leftArrival = left.actualArrivalDate || left.createdAt || "";
  const rightArrival = right.actualArrivalDate || right.createdAt || "";
  if (!leftArrival && rightArrival) return 1;
  if (leftArrival && !rightArrival) return -1;
  if (leftArrival !== rightArrival) return leftArrival.localeCompare(rightArrival);
  if (left.locationName !== right.locationName) return left.locationName.localeCompare(right.locationName);
  if (left.storageSection !== right.storageSection) return left.storageSection.localeCompare(right.storageSection);
  if (left.containerNo !== right.containerNo) return left.containerNo.localeCompare(right.containerNo);
  return left.palletCode.localeCompare(right.palletCode);
}

function normalizeOutboundLinePalletPicks(entries: OutboundLinePalletPick[] | null | undefined) {
  const normalized = new Map<number, number>();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry.palletId <= 0 || entry.quantity <= 0) {
      continue;
    }
    normalized.set(entry.palletId, (normalized.get(entry.palletId) ?? 0) + entry.quantity);
  }
  return [...normalized.entries()].map(([palletId, quantity]) => ({ palletId, quantity }));
}

function countSelectedOutboundPallets(entries: OutboundLinePalletPick[]) {
  return normalizeOutboundLinePalletPicks(entries).filter((entry) => entry.quantity > 0).length;
}

function areOutboundLinePalletPicksEqual(
  left: OutboundLinePalletPick[] | null | undefined,
  right: OutboundLinePalletPick[] | null | undefined
) {
  const normalizedLeft = normalizeOutboundLinePalletPicks(left);
  const normalizedRight = normalizeOutboundLinePalletPicks(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((entry, index) => (
    entry.palletId === normalizedRight[index]?.palletId
    && entry.quantity === normalizedRight[index]?.quantity
  ));
}

function buildAutoOutboundPalletSelections(quantity: number, candidates: OutboundPalletCandidate[]) {
  if (quantity <= 0) {
    return [];
  }

  let remainingQty = quantity;
  const selections: OutboundLinePalletPick[] = [];
  for (const candidate of [...candidates].sort(compareOutboundPalletCandidates)) {
    if (remainingQty <= 0) {
      break;
    }
    if (candidate.palletId <= 0) {
      continue;
    }
    const selectedQty = Math.min(candidate.availableQty, remainingQty);
    if (selectedQty <= 0) {
      continue;
    }
    selections.push({ palletId: candidate.palletId, quantity: selectedQty });
    remainingQty -= selectedQty;
  }
  return selections;
}

function buildOutboundSourceKey(customerId: number, locationId: number, skuMasterId: number) {
  return `${customerId}|${locationId}|${skuMasterId}`;
}

function findOutboundSourceOption(sourceOptions: OutboundSourceOption[], sourceKey: string) {
  const normalizedSourceKey = sourceKey.trim();
  if (!normalizedSourceKey) {
    return undefined;
  }
  return sourceOptions.find((sourceOption) => sourceOption.sourceKey === normalizedSourceKey);
}

function buildOutboundSourceOptions(items: Item[], movements: Movement[]): OutboundSourceOption[] {
  const containerBalances = buildItemContainerBalances(items, movements);
  const grouped = new Map<string, { representative: Item; items: Item[] }>();

  for (const item of [...items].sort(compareOutboundAllocationCandidates)) {
    const key = buildOutboundSourceKey(item.customerId, item.locationId, item.skuMasterId);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { representative: item, items: [item] });
      continue;
    }

    existing.items.push(item);
  }

  return [...grouped.entries()].map(([sourceKey, { representative, items: sourceItems }]) => {
    const candidates = containerBalances.filter((balance) => balance.sourceKey === sourceKey);
    const sourceItemWithNumber = sourceItems.find((item) => item.itemNumber.trim());
    const sourceItemWithDescription = sourceItems.find((item) => displayDescription(item).trim());
    const sourceItemNumber = sourceItemWithNumber?.itemNumber || "";
    const sourceDescription = sourceItemWithDescription ? displayDescription(sourceItemWithDescription) : displayDescription(representative);
    const sourceUnit = sourceItems.find((item) => item.unit.trim())?.unit || representative.unit;
    const normalizedCandidates: OutboundPalletCandidate[] = candidates.map((candidate, index) => ({
      id: candidate.id,
      palletId: -((index + 1) * 100000 + representative.id),
      palletCode: "",
      customerId: candidate.customerId,
      customerName: representative.customerName,
      locationId: candidate.locationId,
      locationName: candidate.locationName,
      storageSection: normalizeStorageSection(candidate.storageSection),
      containerNo: candidate.containerNo,
      skuMasterId: representative.skuMasterId,
      sku: representative.sku,
      itemNumber: sourceItemWithNumber?.itemNumber || "",
      description: sourceItemWithDescription ? displayDescription(sourceItemWithDescription) : displayDescription(representative),
      unit: (sourceItems.find((item) => item.unit.trim())?.unit || representative.unit || "PCS").toUpperCase(),
      availableQty: candidate.availableQty,
      actualArrivalDate: representative.deliveryDate || null,
      createdAt: representative.createdAt
    }));
    const sections = new Set<string>();
    let availableQty = 0;

    for (const candidate of candidates) {
      availableQty += candidate.availableQty;
      if (candidate.storageSection) {
        sections.add(candidate.storageSection);
      }
    }

    return {
      sourceKey,
      customerId: representative.customerId,
      customerName: representative.customerName,
      locationId: representative.locationId,
      locationName: representative.locationName,
      skuMasterId: representative.skuMasterId,
      sku: representative.sku,
      itemNumber: sourceItemNumber,
      description: sourceDescription,
      unit: sourceUnit,
      availableQty,
      palletCount: normalizedCandidates.length,
      storageSections: [...sections].sort(),
      containerCount: new Set(candidates.map((candidate) => candidate.containerNo || `${candidate.locationName}/${normalizeStorageSection(candidate.storageSection)}`)).size,
      containerSummary: formatContainerDistributionSummaryValue(candidates),
      candidates: normalizedCandidates
    };
  }).sort((left, right) => {
    const customerCompare = left.customerName.localeCompare(right.customerName);
    if (customerCompare !== 0) return customerCompare;
    const locationCompare = left.locationName.localeCompare(right.locationName);
    if (locationCompare !== 0) return locationCompare;
    return left.sku.localeCompare(right.sku);
  });
}

function buildOutboundSourceOptionsFromPallets(pallets: PalletTrace[], skuMastersByID: Map<number, SKUMaster>): OutboundSourceOption[] {
  const candidates: OutboundPalletCandidate[] = [];
  for (const pallet of pallets) {
    if (pallet.status !== "OPEN" && pallet.status !== "PARTIAL") {
      continue;
    }
    for (const content of pallet.contents) {
      const availableQty = Math.max(0, content.quantity - (content.allocatedQty ?? 0) - (content.damagedQty ?? 0) - (content.holdQty ?? 0));
      if (availableQty <= 0) {
        continue;
      }
      const skuMaster = skuMastersByID.get(content.skuMasterId);
      candidates.push({
        id: `${pallet.id}-${content.id}`,
        palletId: pallet.id,
        palletCode: pallet.palletCode,
        customerId: pallet.customerId,
        customerName: pallet.customerName,
        locationId: pallet.currentLocationId,
        locationName: pallet.currentLocationName,
        storageSection: normalizeStorageSection(pallet.currentStorageSection),
        containerNo: pallet.currentContainerNo || "",
        skuMasterId: content.skuMasterId,
        sku: content.sku,
        itemNumber: content.itemNumber || "",
        description: content.description || pallet.description || "",
        unit: (skuMaster?.unit || "PCS").toUpperCase(),
        availableQty,
        actualArrivalDate: pallet.actualArrivalDate,
        createdAt: pallet.createdAt
      });
    }
  }

  const grouped = new Map<string, OutboundSourceOption>();
  for (const candidate of candidates.sort(compareOutboundPalletCandidates)) {
    const sourceKey = buildOutboundSourceKey(candidate.customerId, candidate.locationId, candidate.skuMasterId);
    const existing = grouped.get(sourceKey);
    if (!existing) {
      grouped.set(sourceKey, {
        sourceKey,
        customerId: candidate.customerId,
        customerName: candidate.customerName,
        locationId: candidate.locationId,
        locationName: candidate.locationName,
        skuMasterId: candidate.skuMasterId,
        sku: candidate.sku,
        itemNumber: candidate.itemNumber,
        description: candidate.description,
        unit: candidate.unit,
        availableQty: candidate.availableQty,
        palletCount: 1,
        storageSections: [candidate.storageSection],
        containerCount: 1,
        containerSummary: "",
        candidates: [candidate]
      });
      continue;
    }

    existing.availableQty += candidate.availableQty;
    existing.palletCount += 1;
    if (!existing.storageSections.includes(candidate.storageSection)) {
      existing.storageSections.push(candidate.storageSection);
    }
    existing.candidates.push(candidate);
  }

  return [...grouped.values()].map((source) => {
    const sortedCandidates = [...source.candidates].sort(compareOutboundPalletCandidates);
    return {
      ...source,
      storageSections: [...source.storageSections].sort(),
      containerCount: new Set(sortedCandidates.map((candidate) => candidate.containerNo || `${candidate.locationName}/${candidate.storageSection}`)).size,
      containerSummary: formatContainerDistributionSummaryValue(sortedCandidates.map((candidate) => ({
        containerNo: candidate.containerNo,
        availableQty: candidate.availableQty,
        locationName: candidate.locationName,
        storageSection: candidate.storageSection
      }))),
      candidates: sortedCandidates
    };
  }).sort((left, right) => {
    const customerCompare = left.customerName.localeCompare(right.customerName);
    if (customerCompare !== 0) return customerCompare;
    const locationCompare = left.locationName.localeCompare(right.locationName);
    if (locationCompare !== 0) return locationCompare;
    return left.sku.localeCompare(right.sku);
  });
}

function buildOutboundEditorSourceState({
  document,
  launchContext
}: {
  document: OutboundDocument | null;
  launchContext: OutboundShipmentEditorLaunchContext | null;
}) {
  if (document) {
    return {
      form: {
        packingListNo: document.packingListNo || "",
        orderRef: document.orderRef || "",
        expectedShipDate: getOutboundExpectedShipDate(document)?.slice(0, 10) ?? "",
        actualShipDate: document.actualShipDate ? document.actualShipDate.slice(0, 10) : "",
        shipToName: document.shipToName || "",
        shipToAddress: document.shipToAddress || "",
        shipToContact: document.shipToContact || "",
        carrierName: document.carrierName || "",
        documentNote: document.documentNote || ""
      },
      lines: document.lines.length > 0
        ? document.lines.map((line) => ({
            id: String(line.id),
            sourceKey: buildOutboundSourceKey(document.customerId, line.locationId, line.skuMasterId),
            quantity: line.quantity,
            pallets: line.pallets || 0,
            palletsDetailCtns: line.palletsDetailCtns || "",
            unitLabel: line.unitLabel || "PCS",
            cartonSizeMm: line.cartonSizeMm || "",
            netWeightKgs: line.netWeightKgs || 0,
            grossWeightKgs: line.grossWeightKgs || 0,
            reason: line.lineNote || "",
            pickPallets: line.pickPallets ?? [],
            pickPalletsTouched: (line.pickPallets?.length ?? 0) > 0
          }))
        : [createEmptyBatchOutboundLine()]
    };
  }

  return {
    form: createEmptyBatchOutboundForm(launchContext?.scheduledDate || ""),
    lines: [createEmptyBatchOutboundLine()]
  };
}

function getOutboundShipmentEditorDraftStorageKey(documentId: number | null) {
  return `sim-outbound-shipment-editor-draft:${documentId && documentId > 0 ? documentId : "new"}`;
}

function loadOutboundShipmentEditorDraft(storageKey: string) {
  const raw = window.sessionStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as OutboundShipmentEditorLocalDraft;
    if (parsed.version !== 1) {
      return null;
    }
    const legacyForm = parsed.form as BatchOutboundFormState & { outDate?: string };
    parsed.form = {
      packingListNo: String(legacyForm.packingListNo ?? ""),
      orderRef: String(legacyForm.orderRef ?? ""),
      expectedShipDate: String(legacyForm.expectedShipDate ?? legacyForm.outDate ?? ""),
      actualShipDate: String(legacyForm.actualShipDate ?? ""),
      shipToName: String(legacyForm.shipToName ?? ""),
      shipToAddress: String(legacyForm.shipToAddress ?? ""),
      shipToContact: String(legacyForm.shipToContact ?? ""),
      carrierName: String(legacyForm.carrierName ?? ""),
      documentNote: String(legacyForm.documentNote ?? "")
    };
    parsed.lines = Array.isArray(parsed.lines)
      ? parsed.lines.map((line) => ({
          ...line,
          pickPallets: normalizeOutboundLinePalletPicks((line as Partial<BatchOutboundLineState>).pickPallets),
          pickPalletsTouched: Array.isArray((line as Partial<BatchOutboundLineState>).pickPallets)
            ? normalizeOutboundLinePalletPicks((line as Partial<BatchOutboundLineState>).pickPallets).length > 0
            : false
        }))
      : [];
    return parsed;
  } catch {
    return null;
  }
}

function saveOutboundShipmentEditorDraft(storageKey: string, draft: OutboundShipmentEditorLocalDraft) {
  window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
}

function clearOutboundShipmentEditorDraft(storageKey: string) {
  window.sessionStorage.removeItem(storageKey);
}
