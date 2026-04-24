import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import { Box, Button } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

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
  locationId: string;
  sourceKey: string;
  sourceSearch: string;
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

type OutboundShipmentReviewItemGroup = {
  key: string;
  sku: string;
  itemNumber: string;
  description: string;
  totalQty: number;
  lineLabels: string[];
};

type OutboundShipmentReviewContainerGroup = {
  key: string;
  containerNo: string;
  storageSections: string[];
  totalQty: number;
  palletCount: number;
  lineCount: number;
  items: OutboundShipmentReviewItemGroup[];
};

type OutboundShipmentReviewWarehouseGroup = {
  key: string;
  locationName: string;
  totalQty: number;
  palletCount: number;
  lineCount: number;
  containerCount: number;
  containers: OutboundShipmentReviewContainerGroup[];
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

type WarehouseOption = {
  id: string;
  name: string;
};

type OutboundLineValidationState = {
  lineId: string;
  isActive: boolean;
  isReady: boolean;
  hasBlockingStep1: boolean;
  hasBlockingStep2: boolean;
  warehouseMessage: string;
  skuMessage: string;
  quantityMessage: string;
  pickMessage: string;
};

type OutboundStepOverview = {
  readyLines: number;
  blockedLines: number;
  totalRequestedQty: number;
  totalPickedQty: number;
  shortageLines: number;
  shortageQty: number;
  warehouseCount: number;
  containerCount: number;
  palletCount: number;
  reviewStatus: "ready" | "incomplete" | "shortage";
};

type RememberedOutboundHeaderDefaults = Pick<
  BatchOutboundFormState,
  "shipToName" | "shipToAddress" | "shipToContact" | "carrierName"
>;

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
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [outboundWizardStep, setOutboundWizardStep] = useState<OutboundWizardStep>(1);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [usedRememberedOutboundDefaults, setUsedRememberedOutboundDefaults] = useState(false);
  const [batchOutboundLineAddCount, setBatchOutboundLineAddCount] = useState(1);
  const [expandedOutboundPickPlans, setExpandedOutboundPickPlans] = useState<Record<string, boolean>>({});
  const [isEditorReady, setIsEditorReady] = useState(false);
  const pendingBatchLineIDRef = useRef<string | null>(null);
  const lastInitializedRouteRef = useRef<string | null>(null);
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
  const warehouseOptions = useMemo<WarehouseOption[]>(
    () => buildWarehouseOptions(availableOutboundSources),
    [availableOutboundSources]
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
  const outboundShipmentReviewGroups = useMemo(
    () => buildOutboundShipmentReviewGroups(batchOutboundAllocationPreview.rows),
    [batchOutboundAllocationPreview.rows]
  );
  const outboundPickPlanReservationsByLine = useMemo(
    () => buildOutboundPickPlanReservationMap(batchOutboundLines, selectableOutboundSources),
    [batchOutboundLines, selectableOutboundSources]
  );
  const outboundLineValidations = useMemo(
    () => buildOutboundLineValidations(batchOutboundLines, selectableOutboundSources, batchOutboundAllocationPreview, t),
    [batchOutboundAllocationPreview, batchOutboundLines, selectableOutboundSources, t]
  );
  const outboundStepOverview = useMemo(
    () => buildOutboundStepOverview(batchOutboundLines, outboundLineValidations, batchOutboundAllocationPreview, outboundShipmentReviewGroups),
    [batchOutboundAllocationPreview, batchOutboundLines, outboundLineValidations, outboundShipmentReviewGroups]
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
  const canEditOutboundNote = canManage && Boolean(document?.id);
  const isOutboundNoteDirty = canEditOutboundNote && batchOutboundForm.documentNote.trim() !== (document?.documentNote ?? "").trim();
  const hasNoAvailableSources = availableOutboundSources.length === 0 && !isEditingOutboundDraft && !isEditingConfirmedOutbound;
  const hasBlockingStep1Issues = outboundStepOverview.blockedLines > 0 || outboundStepOverview.readyLines === 0;
  const hasBlockingStep2Issues = outboundStepOverview.shortageLines > 0 || outboundStepOverview.readyLines === 0;

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
    const rememberedHeaderDefaults = loadRememberedOutboundHeaderDefaults();
    const sourceState = buildOutboundEditorSourceState({ document, launchContext, rememberedHeaderDefaults });

    setBatchOutboundForm(sourceState.form);
    setBatchOutboundLines(sourceState.lines);
    setUsedRememberedOutboundDefaults(sourceState.usedRememberedDefaults);
    setOutboundWizardStep(1);
    setErrorMessage("");
    setBatchSubmitting(false);
    setReviewConfirmed(false);
    setBatchOutboundLineAddCount(1);
    setExpandedOutboundPickPlans({});
    setIsEditorReady(true);
    lastInitializedRouteRef.current = routeKey;
  }, [document, documentId, isLoading, routeKey]);

  useEffect(() => {
    setReviewConfirmed(false);
  }, [batchOutboundForm, batchOutboundLines]);

  useEffect(() => {
    setBatchOutboundLines((current) => rebalanceAutoOutboundLineSelections(current, selectableOutboundSources));
  }, [batchOutboundLines, selectableOutboundSources]);

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

  async function handleSaveDocumentNote() {
    if (!document?.id || !canEditOutboundNote) {
      return;
    }

    setNoteSubmitting(true);
    setErrorMessage("");
    try {
      await api.updateOutboundDocumentNote(document.id, {
        documentNote: batchOutboundForm.documentNote || undefined
      });
      await onRefresh();
      showActionSuccess(t("shipmentNoteSavedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    } finally {
      setNoteSubmitting(false);
    }
  }

  function getSafeLineAddCount(value: number) {
    return Math.min(50, Math.max(1, Math.floor(value) || 1));
  }

  function focusShipmentEditorField(fieldID: string) {
    window.setTimeout(() => {
      const nextField = window.document.getElementById(fieldID);
      if (nextField instanceof HTMLInputElement || nextField instanceof HTMLSelectElement || nextField instanceof HTMLButtonElement) {
        nextField.focus();
        if (nextField instanceof HTMLInputElement) {
          nextField.select();
        }
      }
    }, 0);
  }

  function focusShipmentLineField(lineID: string, field: "warehouse" | "sku" | "quantity") {
    focusShipmentEditorField(`shipment-editor-${field}-${lineID}`);
  }

  function focusNextShipmentLine(lineID: string) {
    const lineIndex = batchOutboundLines.findIndex((line) => line.id === lineID);
    const nextLine = lineIndex >= 0 ? batchOutboundLines[lineIndex + 1] : null;
    if (nextLine) {
      focusShipmentLineField(nextLine.id, "warehouse");
      return;
    }
    focusShipmentEditorField("shipment-editor-next-action");
  }

  function handleShipmentLineFieldKeyDown(
    event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    lineID: string,
    field: "warehouse" | "sku" | "quantity"
  ) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    if (event.shiftKey) {
      if (field === "quantity") {
        focusShipmentLineField(lineID, "sku");
        return;
      }
      if (field === "sku") {
        focusShipmentLineField(lineID, "warehouse");
      }
      return;
    }

    if (field === "warehouse") {
      focusShipmentLineField(lineID, "sku");
      return;
    }
    if (field === "sku") {
      focusShipmentLineField(lineID, "quantity");
      return;
    }
    focusNextShipmentLine(lineID);
  }

  function addBatchOutboundLine(count = batchOutboundLineAddCount) {
    const safeCount = getSafeLineAddCount(count);
    const lastUsedLocationId = [...batchOutboundLines]
      .reverse()
      .find((line) => line.locationId.trim())?.locationId ?? "";
    const nextLines = Array.from({ length: safeCount }, () => createEmptyBatchOutboundLine({ locationId: lastUsedLocationId }));
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
        locationId: currentLine.locationId,
        sourceKey: "",
        sourceSearch: currentLine.sourceSearch,
        pallets: 0,
        palletsDetailCtns: "",
        pickPallets: [],
        pickPalletsTouched: false
      };
    }

    const nextPickPallets = buildAutoOutboundPalletSelections(currentLine.quantity, nextSource.candidates);
    return {
      ...currentLine,
      locationId: String(nextSource.locationId),
      sourceKey: nextSource.sourceKey,
      sourceSearch: formatOutboundSourceOptionLabel(nextSource),
      unitLabel: nextSource.unit?.toUpperCase() || currentLine.unitLabel || "PCS",
      pallets: countSelectedOutboundPallets(nextPickPallets),
      palletsDetailCtns: "",
      pickPallets: nextPickPallets,
      pickPalletsTouched: false
    };
  }

  function updateBatchOutboundLine(lineID: string, updates: Partial<BatchOutboundLineState>) {
    setBatchOutboundLines((current) => current.map((line) => line.id === lineID ? { ...line, ...updates } : line));
  }

  function updateBatchOutboundLineWarehouse(lineID: string, nextLocationId: string) {
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const normalizedLocationId = nextLocationId.trim();
      const selectedSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
      const shouldKeepSource = selectedSource && String(selectedSource.locationId) === normalizedLocationId;
      if (shouldKeepSource) {
        return {
          ...line,
          locationId: normalizedLocationId
        };
      }

      return {
        ...line,
        locationId: normalizedLocationId,
        sourceKey: "",
        sourceSearch: "",
        quantity: 0,
        pallets: 0,
        palletsDetailCtns: "",
        pickPallets: [],
        pickPalletsTouched: false
      };
    }));
  }

  function updateBatchOutboundLineSourceInput(
    lineID: string,
    nextSearchValue: string,
    sourceOptions: OutboundSourceOption[]
  ) {
    const resolvedSource = findOutboundSourceOptionBySearchValue(sourceOptions, nextSearchValue);
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      if (!nextSearchValue.trim()) {
        return {
          ...line,
          sourceKey: "",
          sourceSearch: "",
          quantity: 0,
          pallets: 0,
          palletsDetailCtns: "",
          pickPallets: [],
          pickPalletsTouched: false
        };
      }

      if (resolvedSource) {
        return buildOutboundLineDefaults({
          ...line,
          sourceSearch: nextSearchValue
        }, resolvedSource);
      }

      return {
        ...line,
        sourceKey: "",
        sourceSearch: nextSearchValue,
        pallets: 0,
        palletsDetailCtns: "",
        pickPallets: [],
        pickPalletsTouched: false
      };
    }));
  }

  function updateBatchOutboundLineQuantity(lineID: string, nextQuantity: number) {
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const selectedSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
      const nextPickPallets = line.pickPalletsTouched
        ? line.pickPallets
        : buildAutoOutboundPalletSelections(nextQuantity, selectedSource?.candidates ?? []);
      return {
        ...line,
        quantity: nextQuantity,
        pallets: countSelectedOutboundPallets(nextPickPallets),
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

  function startManualOutboundLinePick(lineID: string) {
    setExpandedOutboundPickPlans((current) => ({
      ...current,
      [lineID]: true
    }));
    let switchedToManual = false;
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID || line.pickPalletsTouched) {
        return line;
      }
      switchedToManual = true;
      return { ...line, pickPalletsTouched: true };
    }));
    if (switchedToManual) {
      showSuccess(t("manualPickEnabledSuccess"));
    }
  }

  function resetOutboundLinePickPallets(lineID: string) {
    let nextPalletCount = 0;
    let nextPickedQty = 0;
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }
      const selectedSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
      const nextPickPallets = buildAutoOutboundPalletSelections(line.quantity, selectedSource?.candidates ?? []);
      nextPalletCount = countSelectedOutboundPallets(nextPickPallets);
      nextPickedQty = nextPickPallets.reduce((sum, entry) => sum + entry.quantity, 0);
      return {
        ...line,
        pickPallets: nextPickPallets,
        pickPalletsTouched: false,
        pallets: nextPalletCount
      };
    }));
    showSuccess(t("autoPickRestoredSuccess", {
      pallets: nextPalletCount,
      qty: nextPickedQty
    }));
  }

  function clearOutboundLinePickPallets(lineID: string) {
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }
      return {
        ...line,
        pickPallets: [],
        pickPalletsTouched: true,
        pallets: 0
      };
    }));
    showSuccess(t("manualPickSelectionsClearedSuccess"));
  }

  function validateOutboundDraft(requireAllocationReady: boolean) {
    if (outboundStepOverview.readyLines === 0) {
      return t("batchOutboundRequireLine");
    }

    for (const line of batchOutboundLines) {
      const validation = outboundLineValidations.get(line.id);
      if (!validation?.isActive) {
        continue;
      }
      if (validation.hasBlockingStep1) {
        return validation.warehouseMessage || validation.skuMessage || validation.quantityMessage || t("chooseSkuAndQty");
      }
      if (requireAllocationReady && validation.hasBlockingStep2) {
        return validation.pickMessage || validation.quantityMessage || t("pickQtyMustMatchRequired");
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
            .map((line) => {
              const summary = batchOutboundAllocationPreview.summaries.get(line.id);
              const shouldExpand = line.pickPalletsTouched || (summary?.shortageQty ?? 0) > 0 || (summary?.containerCount ?? 0) > 1;
              return [line.id, shouldExpand] as const;
            })
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
            pallets: resolveOutboundLinePalletCount(line.pickPallets, line.pallets),
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

      saveRememberedOutboundHeaderDefaults(batchOutboundForm);
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
    if (document?.id && !canEditCurrentDocument) {
      return;
    }
    if (outboundWizardStep < 3) {
      moveOutboundWizardStep((outboundWizardStep + 1) as OutboundWizardStep);
      return;
    }
    if (!reviewConfirmed) {
      setErrorMessage(t("shipmentFinalConfirmRequired"));
      return;
    }

    void submitOutboundDocument("DRAFT");
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
                <label>{t("actualShipDate")}<input type="date" value={batchOutboundForm.actualShipDate} onChange={(event) => {
                  const nextValue = event.target.value;
                  setBatchOutboundForm((current) => ({
                    ...current,
                    actualShipDate: nextValue,
                    expectedShipDate: !current.expectedShipDate && nextValue ? nextValue : current.expectedShipDate
                  }));
                }} disabled={isReadOnly} /></label>
                <label>{t("shipToName")}<input value={batchOutboundForm.shipToName} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, shipToName: event.target.value }))} placeholder="Receiver name" disabled={isReadOnly} /></label>
                <label>{t("shipToContact")}<input value={batchOutboundForm.shipToContact} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, shipToContact: event.target.value }))} placeholder="+1 555 010 0200" disabled={isReadOnly} /></label>
                <label>{t("carrier")}<input value={batchOutboundForm.carrierName} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, carrierName: event.target.value }))} placeholder="FedEx" disabled={isReadOnly} /></label>
                <label className="sheet-form__wide">{t("shipToAddress")}<input value={batchOutboundForm.shipToAddress} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, shipToAddress: event.target.value }))} placeholder="Delivery address" disabled={isReadOnly} /></label>
                {usedRememberedOutboundDefaults ? (
                  <div className="sheet-form__wide rounded-2xl border border-sky-200/80 bg-sky-50/70 px-4 py-3 text-sm font-medium text-sky-800">
                    {t("shipmentHeaderDefaultsApplied")}
                  </div>
                ) : null}
                <div className="sheet-form__wide">
                  <label className="sheet-form__wide">{t("documentNotes")}<input value={batchOutboundForm.documentNote} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, documentNote: event.target.value }))} placeholder={t("outboundDocumentNotePlaceholder")} disabled={!canManage} /></label>
                  {document?.id && canManage ? (
                    <div className="sheet-form__actions" style={{ marginTop: "0.5rem" }}>
                      <button className="button button--ghost" type="button" onClick={() => void handleSaveDocumentNote()} disabled={noteSubmitting || !isOutboundNoteDirty}>
                        {noteSubmitting ? t("saving") : t("saveNote")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {outboundWizardStep !== 3 ? (
              <div className="batch-lines">
                <div className="batch-lines__toolbar batch-lines__toolbar--sticky !flex-col !items-stretch !gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
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
                  <div className="flex flex-wrap gap-2">
                    {outboundWizardStep === 1 ? (
                      <>
                        <span className="rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          {`${t("shipmentStepSummaryReadyLines")}: ${outboundStepOverview.readyLines}`}
                        </span>
                        <span className="rounded-full border border-amber-200/80 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                          {`${t("shipmentStepSummaryBlockedLines")}: ${outboundStepOverview.blockedLines}`}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="rounded-full border border-sky-200/80 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                          {`${t("requiredQty")}: ${outboundStepOverview.totalRequestedQty}`}
                        </span>
                        <span className="rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          {`${t("selectedQty")}: ${outboundStepOverview.totalPickedQty}`}
                        </span>
                        <span className="rounded-full border border-amber-200/80 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                          {`${t("remainingQty")}: ${outboundStepOverview.shortageQty}`}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <datalist id="outbound-unit-presets">
                  <option value="PCS" />
                  <option value="CTN" />
                  <option value="PLT" />
                  <option value="BAG" />
                </datalist>

                {batchOutboundLines.map((line, index) => {
                  const lineWarehouseSources = filterOutboundSourcesByLocation(selectableOutboundSources, line.locationId);
                  const selectedOutboundSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
                  const outboundAllocationSummary = batchOutboundAllocationPreview.summaries.get(line.id);
                  const outboundPickPlanRows = selectedOutboundSource
                    ? buildOutboundPickPlanRows(
                        line,
                        selectedOutboundSource,
                        line.pickPalletsTouched,
                        outboundPickPlanReservationsByLine.get(line.id)
                      )
                    : [];
                  const outboundStorageSections = selectedOutboundSource
                    ? selectedOutboundSource.storageSections.map((section) => normalizeStorageSection(section)).join(", ") || DEFAULT_STORAGE_SECTION
                    : DEFAULT_STORAGE_SECTION;
                  const outboundLocationDisplay = selectedOutboundSource
                    ? `${selectedOutboundSource.locationName} / ${outboundStorageSections}`
                    : "-";
                  const isOutboundPickPlanExpanded = Boolean(expandedOutboundPickPlans[line.id]);
                  const hasOutboundShortage = (outboundAllocationSummary?.shortageQty ?? 0) > 0;
                  const lineValidation = outboundLineValidations.get(line.id) ?? {
                    lineId: line.id,
                    isActive: false,
                    isReady: false,
                    hasBlockingStep1: false,
                    hasBlockingStep2: false,
                    warehouseMessage: "",
                    skuMessage: "",
                    quantityMessage: "",
                    pickMessage: ""
                  };
                  const lineUnitLabel = line.unitLabel || selectedOutboundSource?.unit.toUpperCase() || "PCS";
                  const linePalletCount = resolveOutboundLinePalletCount(line.pickPallets, line.pallets);
                  const lineSourceInputValue = line.sourceSearch || (selectedOutboundSource ? formatOutboundSourceOptionLabel(selectedOutboundSource) : "");
                  const skuInputListID = `shipment-editor-sku-options-${line.id}`;
                  const lineStatusLabel = lineValidation.hasBlockingStep1 || lineValidation.hasBlockingStep2
                    ? t("needsAttention")
                    : lineValidation.isReady
                      ? t("ready")
                      : t("reviewIncomplete");
                  const lineStatusTone = lineValidation.hasBlockingStep1 || lineValidation.hasBlockingStep2
                    ? "status-pill--alert"
                    : lineValidation.isReady
                      ? "status-pill--ok"
                      : "";

                  return (
                    <div className={`batch-line-card ${lineValidation.hasBlockingStep1 || lineValidation.hasBlockingStep2 ? "ring-1 ring-amber-200/80" : ""}`} key={line.id} id={`shipment-editor-line-${line.id}`}>
                      <div className="batch-line-card__header">
                        <div className="batch-line-card__title">
                          <strong>{t("shipmentSource")} #{index + 1}</strong>
                          <span className={`status-pill ${lineStatusTone}`}>{lineStatusLabel}</span>
                          {line.pickPalletsTouched ? (
                            <span className="status-pill status-pill--ok">{t("manualPick")}</span>
                          ) : null}
                        </div>
                        <button className="button button--danger button--small" type="button" onClick={() => removeBatchOutboundLine(line.id)} disabled={isReadOnly || batchOutboundLines.length === 1}>{t("removeLine")}</button>
                      </div>
                      {outboundWizardStep === 1 ? (
                        <div className="space-y-4">
                          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(17rem,0.9fr)]">
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.5fr)_minmax(9rem,0.7fr)_minmax(9rem,0.7fr)]">
                              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                                {t("currentStorage")}
                                <select
                                  id={`shipment-editor-warehouse-${line.id}`}
                                  value={line.locationId}
                                  onChange={(event) => {
                                    updateBatchOutboundLineWarehouse(line.id, event.target.value);
                                    focusShipmentLineField(line.id, "sku");
                                  }}
                                  onKeyDown={(event) => handleShipmentLineFieldKeyDown(event, line.id, "warehouse")}
                                  disabled={isReadOnly}
                                  aria-invalid={lineValidation.warehouseMessage ? "true" : "false"}
                                  className={`min-h-12 rounded-2xl border bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-[#143569]/40 ${lineValidation.warehouseMessage ? "border-amber-300 bg-amber-50/40" : "border-slate-200/80"}`}
                                >
                                  <option value="">{t("selectWarehouseFirst")}</option>
                                  {warehouseOptions.map((warehouse) => (
                                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                                  ))}
                                </select>
                                <span className={`text-xs ${lineValidation.warehouseMessage ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                                  {lineValidation.warehouseMessage || t("copyPreviousWarehouse")}
                                </span>
                              </label>
                              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                                {t("sku")}
                                <input
                                  id={`shipment-editor-sku-${line.id}`}
                                  type="text"
                                  list={skuInputListID}
                                  value={lineSourceInputValue}
                                  onChange={(event) => {
                                    updateBatchOutboundLineSourceInput(line.id, event.target.value, lineWarehouseSources);
                                    if (findOutboundSourceOptionBySearchValue(lineWarehouseSources, event.target.value)) {
                                      focusShipmentLineField(line.id, "quantity");
                                    }
                                  }}
                                  onKeyDown={(event) => handleShipmentLineFieldKeyDown(event, line.id, "sku")}
                                  disabled={isReadOnly || !line.locationId}
                                  aria-invalid={lineValidation.skuMessage ? "true" : "false"}
                                  placeholder={line.locationId ? t("typeSkuToSearch") : t("selectWarehouseFirst")}
                                  className={`min-h-12 rounded-2xl border bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-[#143569]/40 ${lineValidation.skuMessage ? "border-amber-300 bg-amber-50/40" : "border-slate-200/80"}`}
                                />
                                <datalist id={skuInputListID}>
                                  {lineWarehouseSources.map((item) => (
                                    <option key={item.sourceKey} value={formatOutboundSourceOptionLabel(item)} />
                                  ))}
                                </datalist>
                                <span className={`text-xs ${lineValidation.skuMessage ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                                  {lineValidation.skuMessage || (selectedOutboundSource
                                    ? `${selectedOutboundSource.customerName} · ${t("itemNumber")}: ${selectedOutboundSource.itemNumber || "-"} · ${selectedOutboundSource.sku}`
                                    : t("selectShipmentSource"))}
                                </span>
                              </label>
                              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                                {t("outQty")}
                                <input
                                  id={`shipment-editor-quantity-${line.id}`}
                                  type="number"
                                  min="0"
                                  max={selectedOutboundSource?.availableQty || undefined}
                                  value={numberInputValue(line.quantity)}
                                  onChange={(event) => updateBatchOutboundLineQuantity(line.id, Math.max(0, Math.min(selectedOutboundSource?.availableQty ?? Number.MAX_SAFE_INTEGER, Number(event.target.value || 0))))}
                                  onKeyDown={(event) => handleShipmentLineFieldKeyDown(event, line.id, "quantity")}
                                  disabled={isReadOnly || !selectedOutboundSource}
                                  aria-invalid={lineValidation.quantityMessage ? "true" : "false"}
                                  className={`min-h-12 rounded-2xl border bg-white px-3 py-2 text-right text-lg font-bold text-[#143569] outline-none transition focus:border-[#143569]/40 ${lineValidation.quantityMessage ? "border-amber-300 bg-amber-50/40" : "border-slate-200/80"}`}
                                />
                                <span className={`text-xs ${lineValidation.quantityMessage ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                                  {lineValidation.quantityMessage || (selectedOutboundSource
                                    ? `${t("maxLabel")} ${selectedOutboundSource.availableQty} ${lineUnitLabel} · ${t("lineAutoPickSummary", {
                                      selected: outboundAllocationSummary?.allocatedQty ?? 0,
                                      unit: lineUnitLabel,
                                      pallets: linePalletCount,
                                      containers: outboundAllocationSummary?.containerCount ?? 0
                                    })}`
                                    : t("selectSkuAfterWarehouse"))}
                                </span>
                              </label>
                              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t("pallets")}</div>
                                <div className="mt-1 text-3xl font-extrabold text-[#143569]">{linePalletCount}</div>
                                <div className="mt-2 space-y-1 text-xs text-slate-500">
                                  <div>{`${t("availableQty")}: ${selectedOutboundSource?.availableQty ?? 0}`}</div>
                                  <div>{`${t("containers")}: ${outboundAllocationSummary?.containerCount ?? 0}`}</div>
                                  <div>{`${t("selectedQty")}: ${outboundAllocationSummary?.allocatedQty ?? 0} ${lineUnitLabel}`}</div>
                                </div>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-4">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t("shipmentReviewStatus")}</div>
                                <span className={`status-pill ${lineStatusTone}`}>{lineStatusLabel}</span>
                              </div>
                              <div className="mt-3 space-y-2 text-sm text-slate-600">
                                <div className="flex items-center justify-between gap-3">
                                  <span>{t("requiredQty")}</span>
                                  <strong className="font-mono text-slate-700">{line.quantity || 0}</strong>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span>{t("selectedQty")}</span>
                                  <strong className="font-mono text-slate-700">{outboundAllocationSummary?.allocatedQty ?? 0}</strong>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span>{t("remainingQty")}</span>
                                  <strong className={`font-mono ${(outboundAllocationSummary?.shortageQty ?? 0) > 0 ? "text-amber-700" : "text-slate-700"}`}>{outboundAllocationSummary?.shortageQty ?? 0}</strong>
                                </div>
                              </div>
                              <div className="mt-3 text-xs text-slate-500">
                                {selectedOutboundSource
                                  ? `${selectedOutboundSource.description || selectedOutboundSource.sku} · ${t("containerDistribution")}: ${selectedOutboundSource.containerSummary || "-"}`
                                  : t("selectShipmentSource")}
                              </div>
                            </div>
                          </div>
                          <div className="rounded-2xl border border-dashed border-slate-200/80 bg-slate-50/60 px-4 py-4">
                            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t("optionalDetails")}</div>
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                                {t("unit")}
                                <input value={line.unitLabel} onChange={(event) => updateBatchOutboundLine(line.id, { unitLabel: event.target.value })} placeholder="PCS" disabled={isReadOnly} list="outbound-unit-presets" className="min-h-11 rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#143569]/40" />
                              </label>
                              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                                {t("cartonSize")}
                                <input value={line.cartonSizeMm} onChange={(event) => updateBatchOutboundLine(line.id, { cartonSizeMm: event.target.value })} placeholder="455*330*325" disabled={isReadOnly} className="min-h-11 rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#143569]/40" />
                              </label>
                              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                                {t("netWeight")}
                                <input type="number" min="0" step="0.01" value={numberInputValue(line.netWeightKgs)} onChange={(event) => updateBatchOutboundLine(line.id, { netWeightKgs: Math.max(0, Number(event.target.value || 0)) })} disabled={isReadOnly} className="min-h-11 rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-right text-sm text-slate-700 outline-none transition focus:border-[#143569]/40" />
                              </label>
                              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                                {t("grossWeight")}
                                <input type="number" min="0" step="0.01" value={numberInputValue(line.grossWeightKgs)} onChange={(event) => updateBatchOutboundLine(line.id, { grossWeightKgs: Math.max(0, Number(event.target.value || 0)) })} disabled={isReadOnly} className="min-h-11 rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-right text-sm text-slate-700 outline-none transition focus:border-[#143569]/40" />
                              </label>
                              <label className="grid gap-1.5 text-sm font-medium text-slate-700 md:col-span-2 xl:col-span-4">
                                {t("internalNotes")}
                                <input value={line.reason} onChange={(event) => updateBatchOutboundLine(line.id, { reason: event.target.value })} placeholder={t("outboundInternalNotePlaceholder")} disabled={isReadOnly} className="min-h-11 rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#143569]/40" />
                              </label>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      <div className="batch-line-card__meta">
                        <span className="batch-line-card__hint">
                          {selectedOutboundSource
                            ? `${selectedOutboundSource.customerName} | ${t("itemNumber")}: ${selectedOutboundSource.itemNumber || "-"} | ${selectedOutboundSource.sku} | ${selectedOutboundSource.description} | ${outboundLocationDisplay} | ${t("containerDistribution")}: ${selectedOutboundSource.containerSummary || "-"} | ${t("availableQty")}: ${selectedOutboundSource.availableQty}`
                            : t("selectShipmentSource")}
                        </span>
                      </div>
                      {selectedOutboundSource && outboundWizardStep === 2 ? (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginBottom: "0.25rem" }}>
                          {!line.pickPalletsTouched ? (
                            <button className="button button--ghost button--small" type="button" onClick={() => startManualOutboundLinePick(line.id)}>{t("switchToManualPick")}</button>
                          ) : null}
                          {line.pickPalletsTouched ? (
                            <button
                              className="button button--ghost button--small"
                              type="button"
                              onClick={() => clearOutboundLinePickPallets(line.id)}
                              disabled={(outboundAllocationSummary?.allocatedQty ?? 0) === 0}
                            >
                              {t("clearPickSelections")}
                            </button>
                          ) : null}
                          {line.pickPalletsTouched ? (
                            <button className="button button--ghost button--small" type="button" onClick={() => resetOutboundLinePickPallets(line.id)}>{t("resetToAutoPick")}</button>
                          ) : null}
                        </div>
                      ) : null}
                      {selectedOutboundSource && outboundWizardStep === 2 ? (
                        <OutboundPickPlanPanel
                          title={t("containerPickPlan")}
                          helperText={line.pickPalletsTouched ? t("pickPlanManualModeHint") : t("pickPlanAutoModeHint")}
                          autoPickLabel={line.pickPalletsTouched ? t("manualPick") : t("autoPick")}
                          selectPalletLabel={t("selectPallet")}
                          searchLabel={t("search")}
                          searchPlaceholder={t("pickPlanSearchPlaceholder")}
                          detailsLabel={t("details")}
                          skuLabel={t("sku")}
                          skuValue={selectedOutboundSource.sku}
                          itemNumberLabel={t("itemNumber")}
                          itemNumberValue={selectedOutboundSource.itemNumber || undefined}
                          locationLabel={t("currentStorage")}
                          locationValue={outboundLocationDisplay}
                          containersLabel={t("containers")}
                          containerCount={line.pickPalletsTouched
                            ? selectedOutboundSource.containerCount
                            : (outboundAllocationSummary?.containerCount ?? 0)}
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
                          fillRemainingLabel={t("fillRemaining")}
                          fullPalletLabel={t("useFullPallet")}
                          clearLabel={t("clear")}
                          repeatLastPickQtyLabel={t("repeatLastPickQty")}
                          increaseQtyLabel={t("increaseQty")}
                          decreaseQtyLabel={t("decreaseQty")}
                          maxHintLabel={t("maxLabel")}
                          searchShortcutHint={t("pickPlanSearchShortcutHint")}
                          canExpand={outboundPickPlanRows.length > 0}
                          expanded={isOutboundPickPlanExpanded}
                          onToggle={() => toggleOutboundPickPlan(line.id)}
                          emptyHint={t("pickAllocationPreviewEmpty")}
                          rows={outboundPickPlanRows.map((row) => ({
                            id: row.id,
                            palletId: row.palletId,
                            palletCode: row.palletCode,
                            containerNo: row.containerNo,
                            locationLabel: `${row.locationName} / ${normalizeStorageSection(row.storageSection)}`,
                            availableQty: row.availableQty,
                            allocatedQty: row.allocatedQty,
                            itemNumber: row.itemNumber || undefined
                          }))}
                          editable={!isReadOnly && line.pickPalletsTouched}
                          inputDisabled={isReadOnly}
                          onAllocatedQtyChange={(rowId, allocatedQty) => {
                            const palletRow = outboundPickPlanRows.find((row) => row.id === rowId);
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
                    <strong>{t("shipmentFinalConfirmTitle")}</strong>
                    <span>{t("shipmentFinalConfirmHint")}</span>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={`status-pill ${
                        outboundStepOverview.reviewStatus === "shortage"
                          ? "status-pill--alert"
                          : outboundStepOverview.reviewStatus === "ready"
                            ? "status-pill--ok"
                            : ""
                      }`}>
                        {outboundStepOverview.reviewStatus === "shortage"
                          ? t("shortageDetected")
                          : outboundStepOverview.reviewStatus === "ready"
                            ? t("readyToConfirm")
                            : t("reviewIncomplete")}
                      </span>
                      <span className="rounded-full border border-slate-200/80 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        {`${t("warehouses")}: ${outboundStepOverview.warehouseCount}`}
                      </span>
                      <span className="rounded-full border border-slate-200/80 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        {`${t("containers")}: ${outboundStepOverview.containerCount}`}
                      </span>
                      <span className="rounded-full border border-slate-200/80 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        {`${t("pallets")}: ${outboundStepOverview.palletCount}`}
                      </span>
                      <span className="rounded-full border border-slate-200/80 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        {`${t("selectedQty")}: ${outboundStepOverview.totalPickedQty}`}
                      </span>
                    </div>
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
                              `${t("pallets")}: ${resolveOutboundLinePalletCount(line.pickPallets, line.pallets)}`
                            ].join(" · ")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {outboundShipmentReviewGroups.length > 0 ? (
                  <div className="batch-lines" style={{ marginTop: "1rem" }}>
                    <div className="batch-line-card inbound-compact-card">
                      <div className="batch-line-card__header">
                        <div className="batch-line-card__title">
                          <strong>{t("shipmentGroupedSummaryTitle")}</strong>
                          <span className="status-pill status-pill--ok">{t("shipmentStepPickPlan")}</span>
                        </div>
                      </div>
                      <div className="batch-line-card__meta">
                        <span className="batch-line-card__hint">{t("shipmentGroupedSummaryHint")}</span>
                      </div>
                    </div>
                    {outboundShipmentReviewGroups.map((warehouseGroup) => (
                      <div className="batch-line-card" key={warehouseGroup.key}>
                        <div className="batch-line-card__header">
                          <div className="batch-line-card__title">
                            <strong>{warehouseGroup.locationName}</strong>
                            <span className="status-pill status-pill--ok">{`${t("containers")}: ${warehouseGroup.containerCount}`}</span>
                          </div>
                        </div>
                        <div className="batch-line-card__meta">
                          <span className="batch-line-card__hint">
                            {[
                              `${t("containers")}: ${warehouseGroup.containerCount}`,
                              `${t("pallets")}: ${warehouseGroup.palletCount}`,
                              `${t("selectedQty")}: ${warehouseGroup.totalQty}`,
                              `${t("totalLines")}: ${warehouseGroup.lineCount}`
                            ].join(" · ")}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {warehouseGroup.containers.map((containerGroup) => (
                            <div
                              key={containerGroup.key}
                              className="rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-700">
                                    {t("sourceContainer")}: <span className="font-mono">{containerGroup.containerNo || "-"}</span>
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {`${t("currentStorage")}: ${warehouseGroup.locationName} / ${containerGroup.storageSections.join(", ") || DEFAULT_STORAGE_SECTION}`}
                                  </div>
                                </div>
                                <span className="status-pill status-pill--ok">{`${t("pallets")}: ${containerGroup.palletCount}`}</span>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                                <span>{`${t("pallets")}: ${containerGroup.palletCount}`}</span>
                                <span>{`${t("selectedQty")}: ${containerGroup.totalQty}`}</span>
                                <span>{`${t("totalLines")}: ${containerGroup.lineCount}`}</span>
                              </div>
                              <div className="mt-3 space-y-2">
                                {containerGroup.items.map((itemGroup) => (
                                  <div
                                    key={itemGroup.key}
                                    className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-3"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-slate-700">
                                          <span className="font-mono">{itemGroup.sku}</span>
                                          {itemGroup.description ? ` · ${itemGroup.description}` : ""}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                                          {itemGroup.itemNumber ? <span className="font-mono">{itemGroup.itemNumber}</span> : null}
                                          <span>{`${t("shipmentLine")}: ${itemGroup.lineLabels.join(", ")}`}</span>
                                        </div>
                                      </div>
                                      <div className="text-sm font-semibold text-[#143569]">{itemGroup.totalQty}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {batchOutboundAllocationPreview.rows.length > 0 ? (
                  <Box sx={{ minWidth: 0, height: 260 }}>
                    <DataGrid
                      rows={batchOutboundAllocationPreview.rows}
                      columns={outboundAllocationPreviewColumns}
                      {...(batchOutboundAllocationPreview.rows.length > 10 ? { pagination: true as const } : {})}
                      pageSizeOptions={[10, 20, 50]}
                      disableRowSelectionOnClick
                      initialState={{ pagination: { paginationModel: { pageSize: Math.min(10, Math.max(batchOutboundAllocationPreview.rows.length, 1)), page: 0 } } }}
                      getRowHeight={() => 64}
                      sx={{ border: 0 }}
                    />
                  </Box>
                ) : (
                  <div className="sheet-note sheet-note--readonly">
                    {t("pickAllocationPreviewEmpty")}
                  </div>
                )}

                <label className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={reviewConfirmed}
                    onChange={(event) => setReviewConfirmed(event.target.checked)}
                    disabled={isReadOnly}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[#143569] focus:ring-[#143569]"
                  />
                  <span>{t("shipmentFinalConfirmCheckbox")}</span>
                </label>
              </div>
            ) : null}

            <div className="sheet-form__actions sticky bottom-3 z-20 rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur" style={{ marginTop: "1rem" }}>
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
                  <button id="shipment-editor-next-action" className="button button--primary" type="button" onClick={() => moveOutboundWizardStep((outboundWizardStep + 1) as OutboundWizardStep)} disabled={isReadOnly || hasNoAvailableSources || (outboundWizardStep === 1 ? hasBlockingStep1Issues : hasBlockingStep2Issues)}>{t("next")}</button>
                ) : !isEditingConfirmedOutbound ? (
                  <button className="button button--primary" type="submit" disabled={batchSubmitting || isReadOnly || hasNoAvailableSources || !reviewConfirmed || outboundStepOverview.reviewStatus !== "ready"}>{batchSubmitting ? t("saving") : isEditingOutboundDraft ? t("saveChanges") : t("scheduleShipment")}</button>
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

const OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY = "sim-outbound-shipment-editor-defaults";

function normalizeRememberedOutboundHeaderValue(value: string) {
  return value.trim();
}

function loadRememberedOutboundHeaderDefaults(): RememberedOutboundHeaderDefaults | null {
  try {
    const raw = window.sessionStorage.getItem(OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<RememberedOutboundHeaderDefaults>;
    const rememberedDefaults: RememberedOutboundHeaderDefaults = {
      shipToName: normalizeRememberedOutboundHeaderValue(parsed.shipToName || ""),
      shipToAddress: normalizeRememberedOutboundHeaderValue(parsed.shipToAddress || ""),
      shipToContact: normalizeRememberedOutboundHeaderValue(parsed.shipToContact || ""),
      carrierName: normalizeRememberedOutboundHeaderValue(parsed.carrierName || "")
    };

    return Object.values(rememberedDefaults).some(Boolean) ? rememberedDefaults : null;
  } catch {
    return null;
  }
}

function saveRememberedOutboundHeaderDefaults(form: BatchOutboundFormState) {
  const rememberedDefaults: RememberedOutboundHeaderDefaults = {
    shipToName: normalizeRememberedOutboundHeaderValue(form.shipToName),
    shipToAddress: normalizeRememberedOutboundHeaderValue(form.shipToAddress),
    shipToContact: normalizeRememberedOutboundHeaderValue(form.shipToContact),
    carrierName: normalizeRememberedOutboundHeaderValue(form.carrierName)
  };

  if (!Object.values(rememberedDefaults).some(Boolean)) {
    window.sessionStorage.removeItem(OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY, JSON.stringify(rememberedDefaults));
}

function createEmptyBatchOutboundLine(seed?: Partial<BatchOutboundLineState>): BatchOutboundLineState {
  return {
    id: seed?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    locationId: seed?.locationId ?? "",
    sourceKey: seed?.sourceKey ?? "",
    sourceSearch: seed?.sourceSearch ?? "",
    quantity: seed?.quantity ?? 0,
    pallets: seed?.pallets ?? 0,
    palletsDetailCtns: seed?.palletsDetailCtns ?? "",
    unitLabel: seed?.unitLabel ?? "PCS",
    cartonSizeMm: seed?.cartonSizeMm ?? "",
    netWeightKgs: seed?.netWeightKgs ?? 0,
    grossWeightKgs: seed?.grossWeightKgs ?? 0,
    reason: seed?.reason ?? "",
    pickPallets: seed?.pickPallets ?? [],
    pickPalletsTouched: seed?.pickPalletsTouched ?? false
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

function isOutboundLineEmpty(line: BatchOutboundLineState) {
  return (
    line.locationId.trim() === ""
    && line.sourceKey.trim() === ""
    && line.sourceSearch.trim() === ""
    && line.quantity <= 0
    && line.pallets <= 0
    && line.reason.trim() === ""
    && line.cartonSizeMm.trim() === ""
    && line.netWeightKgs <= 0
    && line.grossWeightKgs <= 0
  );
}

function buildOutboundLineValidations(
  lines: BatchOutboundLineState[],
  sourceOptions: OutboundSourceOption[],
  preview: OutboundAllocationPreviewResult,
  t: (key: string, vars?: Record<string, string | number>) => string
) {
  const validations = new Map<string, OutboundLineValidationState>();

  for (const line of lines) {
    const selectedSource = findOutboundSourceOption(sourceOptions, line.sourceKey);
    const allocationSummary = preview.summaries.get(line.id);
    const isActive = !isOutboundLineEmpty(line);
    const warehouseMessage = isActive && !line.locationId.trim() ? t("selectWarehouseFirst") : "";
    const skuMessage = isActive && line.locationId.trim() && !line.sourceKey.trim()
      ? (line.sourceSearch.trim() ? t("selectValidSkuOption") : t("selectSkuAfterWarehouse"))
      : "";
    let quantityMessage = "";
    if (isActive && line.sourceKey.trim() && line.quantity <= 0) {
      quantityMessage = t("outboundQtyRequired");
    } else if (selectedSource && line.quantity > selectedSource.availableQty) {
      quantityMessage = t("outboundQtyExceedsStock", {
        sku: selectedSource.sku,
        available: selectedSource.availableQty
      });
    }
    const hasBlockingStep1 = Boolean(warehouseMessage || skuMessage || quantityMessage);

    let pickMessage = "";
    if (!hasBlockingStep1 && selectedSource && line.quantity > 0) {
      const allocatedQty = allocationSummary?.allocatedQty ?? 0;
      if (allocatedQty !== line.quantity) {
        pickMessage = (allocationSummary?.shortageQty ?? 0) > 0
          ? t("outboundQtyExceedsStock", {
              sku: selectedSource.sku,
              available: allocatedQty
            })
          : t("pickQtyMustMatchRequired");
      }
    }

    validations.set(line.id, {
      lineId: line.id,
      isActive,
      isReady: isActive && !hasBlockingStep1 && !pickMessage,
      hasBlockingStep1,
      hasBlockingStep2: Boolean(pickMessage),
      warehouseMessage,
      skuMessage,
      quantityMessage,
      pickMessage
    });
  }

  return validations;
}

function buildOutboundStepOverview(
  lines: BatchOutboundLineState[],
  validations: Map<string, OutboundLineValidationState>,
  preview: OutboundAllocationPreviewResult,
  reviewGroups: OutboundShipmentReviewWarehouseGroup[]
): OutboundStepOverview {
  let readyLines = 0;
  let blockedLines = 0;
  for (const line of lines) {
    const validation = validations.get(line.id);
    if (!validation?.isActive) {
      continue;
    }
    if (validation.hasBlockingStep1) {
      blockedLines += 1;
      continue;
    }
    readyLines += 1;
  }

  const palletCount = new Set(preview.rows.map((row) => row.palletId)).size;
  const reviewStatus: OutboundStepOverview["reviewStatus"] = preview.shortageLineCount > 0
    ? "shortage"
    : readyLines === 0 || preview.totalAllocatedQty !== preview.totalRequestedQty
      ? "incomplete"
      : "ready";

  return {
    readyLines,
    blockedLines,
    totalRequestedQty: preview.totalRequestedQty,
    totalPickedQty: preview.totalAllocatedQty,
    shortageLines: preview.shortageLineCount,
    shortageQty: Math.max(0, preview.totalRequestedQty - preview.totalAllocatedQty),
    warehouseCount: reviewGroups.length,
    containerCount: preview.totalContainerCount,
    palletCount,
    reviewStatus
  };
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

function buildOutboundAllocationPreview(lines: BatchOutboundLineState[], sourceOptions: OutboundSourceOption[]): OutboundAllocationPreviewResult {
  const rows: OutboundAllocationPreviewRow[] = [];
  const summaries = new Map<string, OutboundAllocationLineSummary>();
  const reservationsBySourceKey = new Map<string, Map<number, number>>();
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

    const sourceReservations = getOutboundSourceReservations(reservationsBySourceKey, selectedSource.sourceKey);
    const selectedPalletQuantities = new Map(
      buildEffectiveOutboundLinePalletSelections(line, selectedSource, sourceReservations)
        .map((entry) => [entry.palletId, entry.quantity] as const)
    );
    for (const candidate of selectedSource.candidates) {
      const requestedQty = selectedPalletQuantities.get(candidate.palletId) ?? 0;
      if (requestedQty <= 0) {
        continue;
      }
      const availableQty = Math.max(0, candidate.availableQty - (sourceReservations.get(candidate.palletId) ?? 0));
      const allocatedQty = Math.min(requestedQty, availableQty);
      if (allocatedQty <= 0) {
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
        availableQty,
        allocatedQty
      });
      summary.allocatedQty += allocatedQty;
      sourceReservations.set(candidate.palletId, (sourceReservations.get(candidate.palletId) ?? 0) + allocatedQty);
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

function buildOutboundPickPlanRows(
  line: Pick<BatchOutboundLineState, "id" | "pickPallets">,
  source: Pick<OutboundSourceOption, "candidates" | "itemNumber" | "sku" | "description">,
  includeAllCandidates: boolean,
  priorReservations?: Map<number, number>
) {
  const selectedPalletQuantities = new Map(
    normalizeOutboundLinePalletPicks(line.pickPallets).map((entry) => [entry.palletId, entry.quantity] as const)
  );

  return source.candidates.flatMap((candidate) => {
    const allocatedQty = selectedPalletQuantities.get(candidate.palletId) ?? 0;
    if (!includeAllCandidates && allocatedQty <= 0) {
      return [];
    }
    const availableQty = Math.max(0, candidate.availableQty - (priorReservations?.get(candidate.palletId) ?? 0));

    return [{
      id: `${line.id}-${candidate.palletId}`,
      lineId: line.id,
      lineLabel: "",
      itemNumber: source.itemNumber || "",
      sku: source.sku,
      description: source.description,
      locationName: candidate.locationName,
      storageSection: normalizeStorageSection(candidate.storageSection),
      containerNo: candidate.containerNo || "",
      palletId: candidate.palletId,
      palletCode: candidate.palletCode,
      availableQty,
      allocatedQty
    }];
  });
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

function getOutboundSourceReservations(
  reservationsBySourceKey: Map<string, Map<number, number>>,
  sourceKey: string
) {
  const existing = reservationsBySourceKey.get(sourceKey);
  if (existing) {
    return existing;
  }
  const created = new Map<number, number>();
  reservationsBySourceKey.set(sourceKey, created);
  return created;
}

function reserveOutboundLinePalletSelections(
  reservations: Map<number, number>,
  selections: OutboundLinePalletPick[]
) {
  for (const selection of normalizeOutboundLinePalletPicks(selections)) {
    reservations.set(selection.palletId, (reservations.get(selection.palletId) ?? 0) + selection.quantity);
  }
}

function buildEffectiveOutboundLinePalletSelections(
  line: Pick<BatchOutboundLineState, "quantity" | "pickPallets" | "pickPalletsTouched">,
  source: Pick<OutboundSourceOption, "candidates">,
  reservations: Map<number, number>
) {
  if (line.pickPalletsTouched) {
    return normalizeOutboundLinePalletPicks(line.pickPallets);
  }
  return buildAutoOutboundPalletSelectionsWithReservations(line.quantity, source.candidates, reservations);
}

function rebalanceAutoOutboundLineSelections(lines: BatchOutboundLineState[], sourceOptions: OutboundSourceOption[]) {
  const reservationsBySourceKey = new Map<string, Map<number, number>>();
  let changed = false;

  const nextLines = lines.map((line) => {
    if (!line.sourceKey.trim()) {
      return line;
    }

    const selectedSource = findOutboundSourceOption(sourceOptions, line.sourceKey);
    if (!selectedSource) {
      return line;
    }

    const sourceReservations = getOutboundSourceReservations(reservationsBySourceKey, selectedSource.sourceKey);
    const nextPickPallets = buildEffectiveOutboundLinePalletSelections(line, selectedSource, sourceReservations);
    reserveOutboundLinePalletSelections(sourceReservations, nextPickPallets);

    if (line.pickPalletsTouched) {
      return line;
    }

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

  return changed ? nextLines : lines;
}

function buildOutboundPickPlanReservationMap(lines: BatchOutboundLineState[], sourceOptions: OutboundSourceOption[]) {
  const reservationsBySourceKey = new Map<string, Map<number, number>>();
  const reservationsByLineID = new Map<string, Map<number, number>>();

  for (const line of lines) {
    if (!line.sourceKey.trim()) {
      reservationsByLineID.set(line.id, new Map<number, number>());
      continue;
    }

    const selectedSource = findOutboundSourceOption(sourceOptions, line.sourceKey);
    if (!selectedSource) {
      reservationsByLineID.set(line.id, new Map<number, number>());
      continue;
    }

    const sourceReservations = getOutboundSourceReservations(reservationsBySourceKey, selectedSource.sourceKey);
    reservationsByLineID.set(line.id, new Map(sourceReservations));
    const effectiveSelections = buildEffectiveOutboundLinePalletSelections(line, selectedSource, sourceReservations);
    reserveOutboundLinePalletSelections(sourceReservations, effectiveSelections);
  }

  return reservationsByLineID;
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

function resolveOutboundLinePalletCount(entries: OutboundLinePalletPick[] | null | undefined, fallback = 0) {
  const selectedPalletCount = countSelectedOutboundPallets(entries ?? []);
  return selectedPalletCount > 0 ? selectedPalletCount : Math.max(0, fallback);
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
  return buildAutoOutboundPalletSelectionsWithReservations(quantity, candidates, new Map<number, number>());
}

function buildAutoOutboundPalletSelectionsWithReservations(
  quantity: number,
  candidates: OutboundPalletCandidate[],
  reservations: Map<number, number>
) {
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
    const reservedQty = reservations.get(candidate.palletId) ?? 0;
    const remainingAvailableQty = Math.max(0, candidate.availableQty - reservedQty);
    const selectedQty = Math.min(remainingAvailableQty, remainingQty);
    if (selectedQty <= 0) {
      continue;
    }
    selections.push({ palletId: candidate.palletId, quantity: selectedQty });
    remainingQty -= selectedQty;
  }
  return normalizeOutboundLinePalletPicks(selections);
}

function buildOutboundShipmentReviewGroups(rows: OutboundAllocationPreviewRow[]): OutboundShipmentReviewWarehouseGroup[] {
  const warehouseGroups = new Map<string, {
    key: string;
    locationName: string;
    totalQty: number;
    palletIds: Set<number>;
    lineIds: Set<string>;
    containers: Map<string, {
      key: string;
      containerNo: string;
      storageSections: Set<string>;
      totalQty: number;
      palletIds: Set<number>;
      lineIds: Set<string>;
      items: Map<string, {
        key: string;
        sku: string;
        itemNumber: string;
        description: string;
        totalQty: number;
        lineLabels: Set<string>;
      }>;
    }>;
  }>();

  for (const row of rows) {
    const warehouseKey = row.locationName || "-";
    const containerKey = row.containerNo || `${row.locationName}/${row.storageSection}`;
    const warehouseGroup = warehouseGroups.get(warehouseKey) ?? {
      key: warehouseKey,
      locationName: row.locationName || "-",
      totalQty: 0,
      palletIds: new Set<number>(),
      lineIds: new Set<string>(),
      containers: new Map()
    };
    const containerGroup = warehouseGroup.containers.get(containerKey) ?? {
      key: `${warehouseKey}|${containerKey}`,
      containerNo: row.containerNo || "-",
      storageSections: new Set<string>(),
      totalQty: 0,
      palletIds: new Set<number>(),
      lineIds: new Set<string>(),
      items: new Map()
    };
    const itemKey = `${row.itemNumber}|${row.sku}|${row.description}`;
    const itemGroup = containerGroup.items.get(itemKey) ?? {
      key: itemKey,
      sku: row.sku,
      itemNumber: row.itemNumber,
      description: row.description,
      totalQty: 0,
      lineLabels: new Set<string>()
    };

    warehouseGroup.totalQty += row.allocatedQty;
    warehouseGroup.palletIds.add(row.palletId);
    warehouseGroup.lineIds.add(row.lineId);

    containerGroup.totalQty += row.allocatedQty;
    containerGroup.storageSections.add(normalizeStorageSection(row.storageSection));
    containerGroup.palletIds.add(row.palletId);
    containerGroup.lineIds.add(row.lineId);

    itemGroup.totalQty += row.allocatedQty;
    itemGroup.lineLabels.add(row.lineLabel);

    containerGroup.items.set(itemKey, itemGroup);
    warehouseGroup.containers.set(containerKey, containerGroup);
    warehouseGroups.set(warehouseKey, warehouseGroup);
  }

  return [...warehouseGroups.values()]
    .map((warehouseGroup) => ({
      key: warehouseGroup.key,
      locationName: warehouseGroup.locationName,
      totalQty: warehouseGroup.totalQty,
      palletCount: warehouseGroup.palletIds.size,
      lineCount: warehouseGroup.lineIds.size,
      containerCount: warehouseGroup.containers.size,
      containers: [...warehouseGroup.containers.values()]
        .map((containerGroup) => ({
          key: containerGroup.key,
          containerNo: containerGroup.containerNo,
          storageSections: [...containerGroup.storageSections].sort(),
          totalQty: containerGroup.totalQty,
          palletCount: containerGroup.palletIds.size,
          lineCount: containerGroup.lineIds.size,
          items: [...containerGroup.items.values()]
            .map((itemGroup) => ({
              key: itemGroup.key,
              sku: itemGroup.sku,
              itemNumber: itemGroup.itemNumber,
              description: itemGroup.description,
              totalQty: itemGroup.totalQty,
              lineLabels: [...itemGroup.lineLabels].sort()
            }))
            .sort((left, right) => {
              const skuCompare = left.sku.localeCompare(right.sku);
              if (skuCompare !== 0) return skuCompare;
              return left.itemNumber.localeCompare(right.itemNumber);
            })
        }))
        .sort((left, right) => left.containerNo.localeCompare(right.containerNo))
    }))
    .sort((left, right) => left.locationName.localeCompare(right.locationName));
}

function buildWarehouseOptions(sourceOptions: OutboundSourceOption[]) {
  const uniqueWarehouses = new Map<string, WarehouseOption>();
  for (const source of sourceOptions) {
    const key = String(source.locationId);
    if (!uniqueWarehouses.has(key)) {
      uniqueWarehouses.set(key, { id: key, name: source.locationName });
    }
  }
  return [...uniqueWarehouses.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeOutboundSourceSearchValue(value: string) {
  return value.trim().toUpperCase();
}

function formatOutboundSourceOptionLabel(sourceOption: OutboundSourceOption) {
  return `${sourceOption.sku} | ${sourceOption.itemNumber || "-"} | ${sourceOption.customerName} | ${sourceOption.description}`;
}

function findOutboundSourceOptionBySearchValue(sourceOptions: OutboundSourceOption[], searchValue: string) {
  const normalizedSearchValue = normalizeOutboundSourceSearchValue(searchValue);
  if (!normalizedSearchValue) {
    return undefined;
  }

  const exactLabelMatches = sourceOptions.filter((sourceOption) => (
    normalizeOutboundSourceSearchValue(formatOutboundSourceOptionLabel(sourceOption)) === normalizedSearchValue
  ));
  if (exactLabelMatches.length === 1) {
    return exactLabelMatches[0];
  }

  const exactIdentifierMatches = sourceOptions.filter((sourceOption) => (
    normalizeOutboundSourceSearchValue(sourceOption.sku) === normalizedSearchValue
    || normalizeOutboundSourceSearchValue(sourceOption.itemNumber) === normalizedSearchValue
    || normalizeOutboundSourceSearchValue(sourceOption.customerName) === normalizedSearchValue
    || normalizeOutboundSourceSearchValue(sourceOption.description) === normalizedSearchValue
  ));
  if (exactIdentifierMatches.length === 1) {
    return exactIdentifierMatches[0];
  }

  return undefined;
}

function filterOutboundSourcesByLocation(sourceOptions: OutboundSourceOption[], locationId: string) {
  const normalizedLocationId = locationId.trim();
  if (!normalizedLocationId) {
    return [] as OutboundSourceOption[];
  }
  return sourceOptions.filter((sourceOption) => String(sourceOption.locationId) === normalizedLocationId);
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
    const candidatesByPalletID = new Map<number, OutboundPalletCandidate>();
    for (const candidate of source.candidates) {
      const existing = candidatesByPalletID.get(candidate.palletId);
      if (!existing) {
        candidatesByPalletID.set(candidate.palletId, { ...candidate });
        continue;
      }
      existing.availableQty += candidate.availableQty;
      if (!existing.actualArrivalDate || (candidate.actualArrivalDate && candidate.actualArrivalDate < existing.actualArrivalDate)) {
        existing.actualArrivalDate = candidate.actualArrivalDate;
      }
      if (candidate.createdAt < existing.createdAt) {
        existing.createdAt = candidate.createdAt;
      }
    }

    const sortedCandidates = [...candidatesByPalletID.values()].sort(compareOutboundPalletCandidates);
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
  launchContext,
  rememberedHeaderDefaults
}: {
  document: OutboundDocument | null;
  launchContext: OutboundShipmentEditorLaunchContext | null;
  rememberedHeaderDefaults: RememberedOutboundHeaderDefaults | null;
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
            locationId: String(line.locationId),
            sourceKey: buildOutboundSourceKey(document.customerId, line.locationId, line.skuMasterId),
            sourceSearch: "",
            quantity: line.quantity,
            pallets: resolveOutboundLinePalletCount(line.pickPallets, line.pallets || 0),
            palletsDetailCtns: line.palletsDetailCtns || "",
            unitLabel: line.unitLabel || "PCS",
            cartonSizeMm: line.cartonSizeMm || "",
            netWeightKgs: line.netWeightKgs || 0,
            grossWeightKgs: line.grossWeightKgs || 0,
            reason: line.lineNote || "",
            pickPallets: line.pickPallets ?? [],
            pickPalletsTouched: (line.pickPallets?.length ?? 0) > 0
          }))
        : [createEmptyBatchOutboundLine()],
      usedRememberedDefaults: false
    };
  }

  const emptyForm = createEmptyBatchOutboundForm(launchContext?.scheduledDate || "");
  const rememberedDefaults = rememberedHeaderDefaults ?? {
    shipToName: "",
    shipToAddress: "",
    shipToContact: "",
    carrierName: ""
  };
  const usedRememberedDefaults = Object.values(rememberedDefaults).some(Boolean);

  return {
    form: {
      ...emptyForm,
      ...rememberedDefaults
    },
    lines: [createEmptyBatchOutboundLine()],
    usedRememberedDefaults
  };
}
