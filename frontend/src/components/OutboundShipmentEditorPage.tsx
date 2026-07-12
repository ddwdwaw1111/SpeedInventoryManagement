import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/api";
import { normalizeDocumentStatus, normalizeOutboundTrackingStatus as normalizeOutboundTrackingStatusValue } from "../lib/documentTracking";
import { consumePendingOutboundShipmentEditorLaunchContext, type OutboundShipmentEditorLaunchContext } from "../lib/outboundShipmentEditorLaunchContext";
import { useI18n } from "../lib/i18n";
import { getOutboundExpectedShipDate } from "../lib/outboundDates";
import {
  DEFAULT_STORAGE_SECTION,
  normalizeStorageSection,
  type DocumentAttachment,
  type Item,
  type Movement,
  type OutboundDocument,
  type OutboundLinePalletPick,
  type OutboundDocumentPayload,
  type SKUMaster,
  type UserRole
} from "../lib/types";
import { DocumentAttachmentsPanel, type PendingDocumentAttachment } from "./DocumentAttachmentsPanel";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";
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
  pallets: number;
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
  palletCount: number;
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
  profileBacked: boolean;
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
  const [batchOutboundForm, setBatchOutboundForm] = useState<BatchOutboundFormState>(() => createEmptyBatchOutboundForm());
  const [batchOutboundLines, setBatchOutboundLines] = useState<BatchOutboundLineState[]>(() => [createEmptyBatchOutboundLine()]);
  const [errorMessage, setErrorMessage] = useState("");
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [outboundWizardStep, setOutboundWizardStep] = useState<OutboundWizardStep>(1);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [usedRememberedOutboundDefaults, setUsedRememberedOutboundDefaults] = useState(false);
  const [expandedOutboundPickPlans, setExpandedOutboundPickPlans] = useState<Record<string, boolean>>({});
  const [pendingAttachments, setPendingAttachments] = useState<PendingDocumentAttachment[]>([]);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const pendingBatchLineIDRef = useRef<string | null>(null);
  const lastInitializedRouteRef = useRef<string | null>(null);
  const skuMastersByID = useMemo(() => new Map(
    skuMasters.map((skuMaster) => [skuMaster.id, skuMaster] as const)
  ), [skuMasters]);
  const persistedOutboundSourcesByKey = useMemo(
    () => buildPersistedOutboundSourceOptionsFromDocument(document, skuMastersByID),
    [document, skuMastersByID]
  );
  const availableOutboundSources = useMemo(
    () => buildOutboundSourceOptionsFromItems(items),
    [items]
  );
  const selectableOutboundSources = useMemo(() => {
    const selectedKeys = new Set(
      batchOutboundLines
        .map((line) => line.sourceKey.trim())
        .filter(Boolean)
    );
    const mergedBySourceKey = new Map(
      availableOutboundSources.map((source) => [source.sourceKey, source] as const)
    );
    for (const selectedKey of selectedKeys) {
      const persistedSource = persistedOutboundSourcesByKey.get(selectedKey);
      if (!persistedSource) {
        continue;
      }
      const liveSource = mergedBySourceKey.get(selectedKey);
      if (!liveSource) {
        mergedBySourceKey.set(selectedKey, persistedSource);
        continue;
      }
      const persistedAvailableQty = persistedSource.availableQty;
      mergedBySourceKey.set(selectedKey, {
        ...liveSource,
        availableQty: Math.max(liveSource.availableQty, persistedAvailableQty),
        palletCount: Math.max(liveSource.palletCount, persistedSource.palletCount),
        candidates: liveSource.candidates.map((candidate) => ({
          ...candidate,
          availableQty: Math.max(candidate.availableQty, persistedAvailableQty)
        }))
      });
    }

    return [...mergedBySourceKey.values()].sort((left, right) => {
      const customerCompare = left.customerName.localeCompare(right.customerName);
      if (customerCompare !== 0) return customerCompare;
      const locationCompare = left.locationName.localeCompare(right.locationName);
      if (locationCompare !== 0) return locationCompare;
      return left.sku.localeCompare(right.sku);
    });
  }, [availableOutboundSources, batchOutboundLines, persistedOutboundSourcesByKey]);
  const isOutboundSourceBlocked = false;
  const batchOutboundAllocationPreview = useMemo(
    () => buildOutboundAllocationPreview(batchOutboundLines, selectableOutboundSources),
    [batchOutboundLines, selectableOutboundSources]
  );
  const outboundShipmentReviewGroups = useMemo(
    () => buildOutboundShipmentReviewGroups(batchOutboundAllocationPreview.rows),
    [batchOutboundAllocationPreview.rows]
  );
  const outboundLineValidations = useMemo(
    () => buildOutboundLineValidations(
      batchOutboundLines,
      selectableOutboundSources,
      batchOutboundAllocationPreview,
      t,
      isOutboundSourceBlocked
    ),
    [batchOutboundAllocationPreview, batchOutboundLines, isOutboundSourceBlocked, selectableOutboundSources, t]
  );
  const outboundStepOverview = useMemo(
    () => buildOutboundStepOverview(batchOutboundLines, outboundLineValidations, batchOutboundAllocationPreview, outboundShipmentReviewGroups),
    [batchOutboundAllocationPreview, batchOutboundLines, outboundLineValidations, outboundShipmentReviewGroups]
  );
  const validBatchOutboundLines = useMemo(
    () => batchOutboundLines.filter((line) => line.sourceKey.trim() !== "" && line.quantity > 0),
    [batchOutboundLines]
  );
  const isEditingOutboundDraft = normalizeDocumentStatus(document?.status ?? "") === "DRAFT";
  const isEditingConfirmedOutbound = normalizeDocumentStatus(document?.status ?? "") === "CONFIRMED";
  const isEditingExistingDocument = Boolean(documentId && document);
  const isEditorMissing = Boolean(documentId) && !document && !isLoading;
  const canEditCurrentDocument = !document || (!document.archivedAt && normalizeDocumentStatus(document.status) === "DRAFT");
  const isReadOnly = !canManage || !canEditCurrentDocument;
  const outboundPalletSourceMessage = "";
  const isOutboundSourceReadOnly = isReadOnly || isOutboundSourceBlocked;
  const hasNoAvailableSources = !isOutboundSourceBlocked && availableOutboundSources.length === 0 && !isEditingOutboundDraft && !isEditingConfirmedOutbound;
  const hasBlockingStep1Issues = outboundStepOverview.blockedLines > 0 || outboundStepOverview.readyLines === 0;
  const hasBlockingStep2Issues = outboundStepOverview.shortageLines > 0 || outboundStepOverview.readyLines === 0;

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
    setPendingAttachments([]);
    setExpandedOutboundPickPlans({});
    setIsEditorReady(true);
    lastInitializedRouteRef.current = routeKey;
  }, [document, documentId, isLoading, routeKey]);

  useEffect(() => {
    setReviewConfirmed(false);
  }, [batchOutboundForm, batchOutboundLines]);

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
    if (!canManage || !document?.id || batchSubmitting) {
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

  async function uploadPendingOutboundAttachments(documentID: number) {
    if (pendingAttachments.length === 0) {
      return;
    }
    let remainingAttachments = [...pendingAttachments];
    for (const pendingAttachment of pendingAttachments) {
      await api.uploadOutboundDocumentAttachment(
        documentID,
        pendingAttachment.file,
        pendingAttachment.displayName.trim() || pendingAttachment.file.name
      );
      remainingAttachments = remainingAttachments.filter((entry) => entry.id !== pendingAttachment.id);
      setPendingAttachments(remainingAttachments);
    }
  }

  async function handleUploadOutboundAttachment(file: File, displayName: string) {
    if (!document?.id) {
      throw new Error(t("saveDocumentBeforeUploadingAttachments"));
    }
    await api.uploadOutboundDocumentAttachment(document.id, file, displayName);
    showActionSuccess(t("attachmentsSavedSuccess"));
    await onRefresh();
  }

  async function getOutboundAttachmentDownloadUrl(attachment: DocumentAttachment) {
    const result = await api.getOutboundDocumentAttachmentDownloadUrl(attachment.documentId, attachment.id);
    return result.url;
  }

  async function handleDeleteOutboundAttachment(attachment: DocumentAttachment) {
    await api.deleteOutboundDocumentAttachment(attachment.documentId, attachment.id);
    showActionSuccess(t("attachmentDeletedSuccess"));
    await onRefresh();
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
      focusShipmentLineField(nextLine.id, "sku");
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
        focusShipmentLineField(lineID, "warehouse");
        return;
      }
      if (field === "warehouse") {
        focusShipmentLineField(lineID, "sku");
      }
      return;
    }

    if (field === "sku") {
      focusShipmentLineField(lineID, "warehouse");
      return;
    }
    if (field === "warehouse") {
      focusShipmentLineField(lineID, "quantity");
      return;
    }
    focusNextShipmentLine(lineID);
  }

  function addBatchOutboundLine() {
    const nextLine = createEmptyBatchOutboundLine();
    pendingBatchLineIDRef.current = nextLine.id;
    setBatchOutboundLines((current) => [...current, nextLine]);
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
	  pallets: currentLine.pallets,
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

      const resolvedSource = findOutboundSourceOptionBySearchValue(
        filterOutboundSourcesByLocation(selectableOutboundSources, normalizedLocationId),
        line.sourceSearch
      );
      if (resolvedSource) {
        return buildOutboundLineDefaults({
          ...line,
          locationId: normalizedLocationId
        }, resolvedSource);
      }

      return {
        ...line,
        locationId: normalizedLocationId,
        sourceKey: "",
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
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      if (!nextSearchValue.trim()) {
        return {
          ...line,
          sourceKey: "",
          sourceSearch: "",
          locationId: "",
          quantity: 0,
          pallets: 0,
          palletsDetailCtns: "",
          pickPallets: [],
          pickPalletsTouched: false
        };
      }

      const matchingSources = filterOutboundSourcesBySkuSearch(sourceOptions, nextSearchValue);
      const locationSources = line.locationId.trim()
        ? filterOutboundSourcesByLocation(matchingSources, line.locationId)
        : [];
      const resolvedSource = findOutboundSourceOptionBySearchValue(locationSources, nextSearchValue);
      if (resolvedSource) {
        return buildOutboundLineDefaults({
          ...line,
          sourceSearch: nextSearchValue
        }, resolvedSource);
      }

      const shouldKeepLocation = line.locationId.trim() !== ""
        && matchingSources.some((source) => String(source.locationId) === line.locationId.trim());
      return {
        ...line,
        locationId: shouldKeepLocation ? line.locationId : "",
        sourceKey: "",
        sourceSearch: nextSearchValue,
        quantity: 0,
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
        palletsDetailCtns: "",
        pickPallets: nextPickPallets
      };
    }));
  }

  function updateBatchOutboundLinePallets(lineID: string, nextPallets: number) {
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }
      const selectedSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
      return {
        ...line,
        pallets: nextPallets,
        pickPallets: buildAutoOutboundPalletSelections(line.quantity, selectedSource?.candidates ?? []),
        pickPalletsTouched: false
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
        pallets: line.pallets
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
    if (outboundPalletSourceMessage) {
      return outboundPalletSourceMessage;
    }
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
      if (requireAllocationReady && line.pallets <= 0) {
        return t("outboundPalletCountRequired");
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

    const validationError = validateOutboundDraft(status === "CONFIRMED");
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
            pallets: line.pallets,
            palletsDetailCtns: undefined,
            unitLabel: line.unitLabel || selectedOutboundSource.unit.toUpperCase() || "PCS",
            cartonSizeMm: line.cartonSizeMm || undefined,
            netWeightKgs: line.netWeightKgs,
            grossWeightKgs: line.grossWeightKgs,
            lineNote: line.reason || undefined,
            pickAllocations: selectedOutboundSource.candidates.slice(0, 1).map((candidate) => ({
              itemNumber: selectedOutboundSource.itemNumber || undefined,
              locationId: candidate.locationId,
              locationName: candidate.locationName,
              storageSection: candidate.storageSection,
              containerNo: candidate.containerNo,
              allocatedQty: line.quantity,
              pallets: line.pallets
            }))
          };
        })
      };

      const savedDocument = document?.id
        ? await api.updateOutboundDocument(document.id, payload)
        : await api.createOutboundDocument(payload);

      saveRememberedOutboundHeaderDefaults(batchOutboundForm);
      try {
        await uploadPendingOutboundAttachments(savedDocument.id);
      } catch (attachmentError) {
        await onRefresh();
        if (!document?.id) {
          onOpenOutboundDocument(savedDocument.id);
        }
        showActionError(attachmentError, t("attachmentUploadFailed"));
        return;
      }
      await onRefresh();

      if (status === "DRAFT") {
        showActionSuccess(t("shipmentSavedSuccess"));
        onBackToList();
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
      <div className="space-y-3 pb-6">
        <section className="rounded-[18px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
          {canManage && isEditingConfirmedOutbound && document?.id ? (
            <div className="inbound-entry-topbar">
              <div className="inbound-entry-topbar__actions">
                <button
                  type="button"
                  onClick={() => void handleCopyCurrentShipment()}
                  aria-busy={batchSubmitting}
                  disabled={batchSubmitting}
                  className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {batchSubmitting ? <InlineLoadingIndicator /> : null}
                  {t("reEnterShipment")}
                </button>
              </div>
            </div>
          ) : null}

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
            <div className="shipment-wizard__steps shipment-wizard__steps--compact">
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
                  disabled={isOutboundSourceReadOnly}
                >
                  <span className="shipment-wizard__step-index">{step}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <DocumentAttachmentsPanel
              attachments={document?.attachments ?? []}
              pendingAttachments={pendingAttachments}
              disabled={!canManage || Boolean(document?.archivedAt)}
              canUploadNow={Boolean(document?.id)}
              onPendingAttachmentsChange={setPendingAttachments}
              onUpload={handleUploadOutboundAttachment}
              onGetDownloadUrl={getOutboundAttachmentDownloadUrl}
              onDelete={canManage ? handleDeleteOutboundAttachment : undefined}
            />

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
                  <label className="sheet-form__wide">{t("documentNotes")}<input value={batchOutboundForm.documentNote} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, documentNote: event.target.value }))} placeholder={t("outboundDocumentNotePlaceholder")} disabled={isReadOnly || !canManage} /></label>
                </div>
              </div>
            ) : null}

            {outboundWizardStep !== 3 ? (
              <div className="batch-lines">
                <div className="batch-lines__toolbar batch-lines__toolbar--sticky !flex-col !items-stretch !gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <strong>{outboundWizardStep === 2 ? t("pickAllocations") : t("outboundLines")}</strong>
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
                  const selectedOutboundSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
                  const lineSourceInputValue = line.sourceSearch || (selectedOutboundSource ? formatOutboundSourceOptionLabel(selectedOutboundSource) : "");
                  const lineSkuSources = filterOutboundSourcesBySkuSearch(selectableOutboundSources, lineSourceInputValue);
                  const lineWarehouseOptions = buildWarehouseOptions(lineSkuSources);
                  const outboundAllocationSummary = batchOutboundAllocationPreview.summaries.get(line.id);
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
                  const skuInputListID = `shipment-editor-sku-options-${line.id}`;
                  const warehouseInputHint = lineValidation.warehouseMessage
                    || (lineSourceInputValue.trim()
                      ? `${lineWarehouseOptions.length} ${t("warehouses")}`
                      : t("selectSkuFirst"));
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
                        </div>
                        <button className="button button--danger button--small" type="button" onClick={() => removeBatchOutboundLine(line.id)} disabled={isReadOnly || batchOutboundLines.length === 1}>{t("removeLine")}</button>
                      </div>
                      {outboundWizardStep === 2 && lineValidation.pickMessage ? (
                        <InlineAlert severity="warning">{lineValidation.pickMessage}</InlineAlert>
                      ) : null}
                      {outboundWizardStep === 1 ? (
                        <div className="space-y-2.5">
                          <div className="grid gap-2.5">
                            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-[minmax(0,1.7fr)_minmax(12rem,0.8fr)_minmax(8.5rem,0.45fr)_minmax(9.5rem,0.4fr)]">
                              <label className="grid content-start gap-1 text-xs font-semibold text-slate-700">
                                {t("sku")}
                                <input
                                  id={`shipment-editor-sku-${line.id}`}
                                  type="text"
                                  list={skuInputListID}
                                  value={lineSourceInputValue}
                                  onChange={(event) => {
                                    updateBatchOutboundLineSourceInput(line.id, event.target.value, selectableOutboundSources);
                                    if (hasExactOutboundSourceSearchMatch(selectableOutboundSources, event.target.value)) {
                                      focusShipmentLineField(line.id, "warehouse");
                                    }
                                  }}
                                  onKeyDown={(event) => handleShipmentLineFieldKeyDown(event, line.id, "sku")}
                                  disabled={isOutboundSourceReadOnly}
                                  aria-invalid={lineValidation.skuMessage ? "true" : "false"}
                                  placeholder={t("typeSkuToSearch")}
                                  className={`min-h-10 rounded-xl border bg-white px-3 py-1.5 text-sm font-medium text-slate-700 outline-none transition focus:border-[#143569]/60 focus:ring-2 focus:ring-[#143569]/10 ${lineValidation.skuMessage ? "border-amber-400 bg-amber-50/40" : "border-slate-300/90"}`}
                                />
                                <datalist id={skuInputListID}>
                                  {buildOutboundSkuSearchOptions(selectableOutboundSources).map((option) => (
                                    <option key={option} value={option} />
                                  ))}
                                </datalist>
                                {lineValidation.skuMessage || !selectedOutboundSource ? (
                                  <span className={`text-xs ${lineValidation.skuMessage ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                                    {lineValidation.skuMessage || t("selectShipmentSource")}
                                  </span>
                                ) : null}
                              </label>
                              <label className="grid content-start gap-1 text-xs font-semibold text-slate-700">
                                {t("currentStorage")}
                                <select
                                  id={`shipment-editor-warehouse-${line.id}`}
                                  value={line.locationId}
                                  onChange={(event) => {
                                    const nextLocationId = event.target.value;
                                    updateBatchOutboundLineWarehouse(line.id, nextLocationId);
                                    const nextWarehouseSources = filterOutboundSourcesByLocation(lineSkuSources, nextLocationId);
                                    if (findOutboundSourceOptionBySearchValue(nextWarehouseSources, lineSourceInputValue)) {
                                      focusShipmentLineField(line.id, "quantity");
                                      return;
                                    }
                                    focusShipmentLineField(line.id, "sku");
                                  }}
                                  onKeyDown={(event) => handleShipmentLineFieldKeyDown(event, line.id, "warehouse")}
                                  disabled={isOutboundSourceReadOnly || !lineSourceInputValue.trim()}
                                  aria-invalid={lineValidation.warehouseMessage ? "true" : "false"}
                                  className={`min-h-10 rounded-xl border bg-white px-3 py-1.5 text-sm font-medium text-slate-700 outline-none transition focus:border-[#143569]/60 focus:ring-2 focus:ring-[#143569]/10 ${lineValidation.warehouseMessage ? "border-amber-400 bg-amber-50/40" : "border-slate-300/90"}`}
                                >
                                  <option value="">{lineSourceInputValue.trim() ? t("selectWarehouseAfterSku") : t("selectSkuFirst")}</option>
                                  {lineWarehouseOptions.map((warehouse) => (
                                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                                  ))}
                                </select>
                                {lineValidation.warehouseMessage || !selectedOutboundSource ? (
                                  <span className={`text-xs ${lineValidation.warehouseMessage ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                                    {warehouseInputHint}
                                  </span>
                                ) : null}
                              </label>
                              <label className="grid content-start gap-1 text-xs font-semibold text-slate-700">
                                {t("outQty")}
                                <input
                                  id={`shipment-editor-quantity-${line.id}`}
                                  type="number"
                                  min="0"
                                  max={selectedOutboundSource?.availableQty || undefined}
                                  value={numberInputValue(line.quantity)}
                                  onChange={(event) => updateBatchOutboundLineQuantity(line.id, Math.max(0, Math.min(selectedOutboundSource?.availableQty ?? Number.MAX_SAFE_INTEGER, Number(event.target.value || 0))))}
                                  onKeyDown={(event) => handleShipmentLineFieldKeyDown(event, line.id, "quantity")}
                                  disabled={isOutboundSourceReadOnly || !selectedOutboundSource}
                                  aria-invalid={lineValidation.quantityMessage ? "true" : "false"}
                                  className={`min-h-10 rounded-xl border bg-white px-3 py-1.5 text-right text-base font-bold text-[#143569] outline-none transition focus:border-[#143569]/60 focus:ring-2 focus:ring-[#143569]/10 ${lineValidation.quantityMessage ? "border-amber-400 bg-amber-50/40" : "border-slate-300/90"}`}
                                />
                                {lineValidation.quantityMessage || !selectedOutboundSource || line.quantity <= 0 ? (
                                  <span className={`text-xs ${lineValidation.quantityMessage ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                                    {lineValidation.quantityMessage || (selectedOutboundSource
                                      ? `${t("maxLabel")} ${selectedOutboundSource.availableQty} ${lineUnitLabel}`
                                      : (lineSourceInputValue.trim() ? t("selectWarehouseAfterSku") : t("selectSkuFirst")))}
                                  </span>
                                ) : null}
                              </label>
                              <label className="grid content-start gap-1 rounded-xl border border-amber-300/80 bg-amber-50/70 px-3 py-2 text-xs font-semibold text-slate-700">
                                {t("pallets")}
                                <input
                                  type="number"
                                  min="0"
                                  max={selectedOutboundSource?.palletCount || undefined}
                                  value={numberInputValue(line.pallets)}
                                  onChange={(event) => updateBatchOutboundLinePallets(
                                    line.id,
                                    Math.max(0, Math.min(selectedOutboundSource?.palletCount ?? Number.MAX_SAFE_INTEGER, Number(event.target.value || 0)))
                                  )}
                                  disabled={isOutboundSourceReadOnly || !selectedOutboundSource}
                                  aria-label={`${t("pallets")} #${index + 1}`}
                                  className="min-h-10 rounded-lg border border-amber-300 bg-white px-3 text-right text-base font-bold text-[#143569] outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-300/30"
                                />
                                <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                                  <div className="whitespace-nowrap">{`${t("sourceContainer")}: ${selectedOutboundSource?.candidates[0]?.containerNo || "-"}`}</div>
                                  <div className="whitespace-nowrap">{`${t("availableQty")}: ${selectedOutboundSource?.availableQty ?? 0}`}</div>
                                  <div className="whitespace-nowrap">{`${t("selectedQty")}: ${outboundAllocationSummary?.allocatedQty ?? 0} ${lineUnitLabel}`}</div>
                                </div>
                              </label>
                            </div>
                          </div>
                          <details className="rounded-xl border border-dashed border-slate-200/80 bg-slate-50/50 px-3 py-2">
                            <summary className="cursor-pointer select-none text-xs font-semibold text-slate-500">{t("optionalDetails")}</summary>
                            <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                              <label className="grid gap-1 text-xs font-medium text-slate-700">
                                {t("unit")}
                                <input value={line.unitLabel} onChange={(event) => updateBatchOutboundLine(line.id, { unitLabel: event.target.value })} placeholder="PCS" disabled={isReadOnly} list="outbound-unit-presets" className="min-h-9 rounded-xl border border-slate-300/90 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-[#143569]/60 focus:ring-2 focus:ring-[#143569]/10" />
                              </label>
                              <label className="grid gap-1 text-xs font-medium text-slate-700">
                                {t("cartonSize")}
                                <input value={line.cartonSizeMm} onChange={(event) => updateBatchOutboundLine(line.id, { cartonSizeMm: event.target.value })} placeholder="455*330*325" disabled={isReadOnly} className="min-h-9 rounded-xl border border-slate-300/90 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-[#143569]/60 focus:ring-2 focus:ring-[#143569]/10" />
                              </label>
                              <label className="grid gap-1 text-xs font-medium text-slate-700">
                                {t("netWeight")}
                                <input type="number" min="0" step="0.01" value={numberInputValue(line.netWeightKgs)} onChange={(event) => updateBatchOutboundLine(line.id, { netWeightKgs: Math.max(0, Number(event.target.value || 0)) })} disabled={isReadOnly} className="min-h-9 rounded-xl border border-slate-300/90 bg-white px-3 py-1.5 text-right text-sm text-slate-700 outline-none transition focus:border-[#143569]/60 focus:ring-2 focus:ring-[#143569]/10" />
                              </label>
                              <label className="grid gap-1 text-xs font-medium text-slate-700">
                                {t("grossWeight")}
                                <input type="number" min="0" step="0.01" value={numberInputValue(line.grossWeightKgs)} onChange={(event) => updateBatchOutboundLine(line.id, { grossWeightKgs: Math.max(0, Number(event.target.value || 0)) })} disabled={isReadOnly} className="min-h-9 rounded-xl border border-slate-300/90 bg-white px-3 py-1.5 text-right text-sm text-slate-700 outline-none transition focus:border-[#143569]/60 focus:ring-2 focus:ring-[#143569]/10" />
                              </label>
                              <label className="grid gap-1 text-xs font-medium text-slate-700 md:col-span-2 xl:col-span-4">
                                {t("internalNotes")}
                                <input value={line.reason} onChange={(event) => updateBatchOutboundLine(line.id, { reason: event.target.value })} placeholder={t("outboundInternalNotePlaceholder")} disabled={isReadOnly} className="min-h-9 rounded-xl border border-slate-300/90 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-[#143569]/60 focus:ring-2 focus:ring-[#143569]/10" />
                              </label>
                            </div>
                          </details>
                        </div>
                      ) : null}
                      {outboundWizardStep === 2 && selectedOutboundSource ? (
                        <div className="grid gap-2.5 md:grid-cols-4">
                          <div className="rounded-xl border border-sky-200/80 bg-sky-50/70 px-3 py-2.5">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-600">{t("sourceContainer")}</div>
                            <div className="mt-1 font-mono text-sm font-bold text-[#143569]">{selectedOutboundSource.candidates[0]?.containerNo || "-"}</div>
                          </div>
                          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("sku")}</div>
                            <div className="mt-1 font-mono text-sm font-bold text-slate-700">{selectedOutboundSource.sku}</div>
                          </div>
                          <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2.5">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-600">{t("selectedQty")}</div>
                            <div className="mt-1 text-sm font-bold text-emerald-800">{line.quantity} {lineUnitLabel}</div>
                          </div>
                          <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2.5">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-600">{t("pallets")}</div>
                            <div className="mt-1 text-sm font-bold text-amber-800">{line.pallets}</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {outboundWizardStep === 1 ? (
                  <button
                    className="outbound-line-add-box"
                    type="button"
                    onClick={() => addBatchOutboundLine()}
                    disabled={isOutboundSourceReadOnly}
                    aria-label={t("addOutboundLine")}
                  >
                    <AddCircleOutlineOutlinedIcon fontSize="small" />
                  </button>
                ) : null}
              </div>
            ) : null}

            {outboundWizardStep === 3 ? (
              <div className="batch-allocation-preview batch-allocation-preview--compact">
                <div
                  data-testid="shipment-final-summary"
                  className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2"
                >
                  <span className="rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    {`${t("warehouses")}: ${outboundStepOverview.warehouseCount}`}
                  </span>
                  <span className="rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    {`${t("containers")}: ${outboundStepOverview.containerCount}`}
                  </span>
                  <span className="rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    {`${t("pallets")}: ${outboundStepOverview.palletCount}`}
                  </span>
                  <span className="rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    {`${t("selectedQty")}: ${outboundStepOverview.totalPickedQty}`}
                  </span>
                </div>

                {batchOutboundAllocationPreview.shortageLineCount > 0 ? (
                  <InlineAlert severity="warning">
                    {t("pickAllocationPreviewShortage")}
                  </InlineAlert>
                ) : null}

                {outboundShipmentReviewGroups.length > 0 ? (
                  <div className="batch-lines">
                    {outboundShipmentReviewGroups.map((warehouseGroup) => (
                      <div className="batch-line-card" key={warehouseGroup.key}>
                        <div className="batch-line-card__header">
                          <div className="batch-line-card__title flex-wrap">
                            <strong>{warehouseGroup.locationName}</strong>
                          </div>
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {warehouseGroup.containers.map((containerGroup) => (
                            <div
                              key={containerGroup.key}
                              className="rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2.5"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-700">
                                    {t("sourceContainer")}: <span className="font-mono">{containerGroup.containerNo || "-"}</span>
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {`${t("currentStorage")}: ${warehouseGroup.locationName} / ${containerGroup.storageSections.join(", ") || DEFAULT_STORAGE_SECTION}`}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-2 space-y-1.5">
                                {containerGroup.items.map((itemGroup) => (
                                  <div
                                    key={itemGroup.key}
                                    className="rounded-lg border border-slate-200/70 bg-slate-50/70 px-2.5 py-2"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-slate-700">
                                          <span className="font-mono">{itemGroup.sku}</span>
                                          {itemGroup.description ? ` · ${itemGroup.description}` : ""}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                                          {itemGroup.itemNumber ? <span className="font-mono">{itemGroup.itemNumber}</span> : null}
                                          <span>{`${t("shipmentLine")}: ${itemGroup.lineLabels.join(", ")}`}</span>
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold text-amber-700">
                                          {[itemGroup.palletCount].map((palletCount) => (
                                            <span
                                              key="pallet-count"
                                              className="rounded-md border border-amber-200/80 bg-amber-50 px-1.5 py-0.5"
                                              title={`${t("pallets")}: ${palletCount}`}
                                            >
                                              {`${t("pallets")}: ${palletCount}`}
                                            </span>
                                          ))}
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

            <div className="sheet-form__actions shipment-action-bar sticky bottom-3 z-20 rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur" style={{ marginTop: "1rem" }}>
              <div className="shipment-action-bar__secondary">
                <button className="button button--ghost" type="button" onClick={onBackToList}>{t("cancel")}</button>
                {isEditingConfirmedOutbound ? (
                  <button className="button button--ghost" type="button" disabled={batchSubmitting} onClick={() => void handleCopyCurrentShipment()} aria-busy={batchSubmitting}>
                    {batchSubmitting ? <InlineLoadingIndicator /> : null}
                    {t("reEnterShipment")}
                  </button>
                ) : outboundWizardStep < 3 ? (
                  <button className="button button--ghost" type="button" disabled={batchSubmitting || isOutboundSourceReadOnly || hasNoAvailableSources} onClick={() => void submitOutboundDocument("DRAFT")} aria-busy={batchSubmitting}>
                    {batchSubmitting ? <InlineLoadingIndicator /> : null}
                    {batchSubmitting ? t("saving") : isEditingOutboundDraft ? t("saveChanges") : t("scheduleShipment")}
                  </button>
                ) : null}
              </div>
              <div className="shipment-action-bar__primary shipment-wizard__actions">
                {outboundWizardStep > 1 && !isEditingConfirmedOutbound ? (
                  <button className="button button--ghost" type="button" onClick={() => moveOutboundWizardStep((outboundWizardStep - 1) as OutboundWizardStep)} disabled={isOutboundSourceReadOnly}>{t("back")}</button>
                ) : null}
                {outboundWizardStep < 3 && !isEditingConfirmedOutbound ? (
                  <button id="shipment-editor-next-action" className="button button--primary" type="button" onClick={() => moveOutboundWizardStep((outboundWizardStep + 1) as OutboundWizardStep)} disabled={isOutboundSourceReadOnly || hasNoAvailableSources || (outboundWizardStep === 1 ? hasBlockingStep1Issues : hasBlockingStep2Issues)}>{t("next")}</button>
                ) : !isEditingConfirmedOutbound ? (
                  <button className="button button--primary" type="submit" disabled={batchSubmitting || isOutboundSourceReadOnly || hasNoAvailableSources || !reviewConfirmed || outboundStepOverview.reviewStatus !== "ready"} aria-busy={batchSubmitting}>
                    {batchSubmitting ? <InlineLoadingIndicator /> : null}
                    {batchSubmitting ? t("saving") : isEditingOutboundDraft ? t("saveChanges") : t("scheduleShipment")}
                  </button>
                ) : null}
              </div>
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
  t: (key: string, vars?: Record<string, string | number>) => string,
  skipAvailabilityChecks = false
) {
  const validations = new Map<string, OutboundLineValidationState>();

  for (const line of lines) {
    const selectedSource = findOutboundSourceOption(sourceOptions, line.sourceKey);
    const allocationSummary = preview.summaries.get(line.id);
    const isActive = !isOutboundLineEmpty(line);
    const sourceSearchValue = line.sourceSearch || (selectedSource ? formatOutboundSourceOptionLabel(selectedSource) : "");
    const hasSkuInput = sourceSearchValue.trim() !== "" || line.sourceKey.trim() !== "";
    const matchingSkuSources = hasSkuInput ? filterOutboundSourcesBySkuSearch(sourceOptions, sourceSearchValue) : [];
    const skuMessage = isActive && !hasSkuInput
      ? t("selectSkuFirst")
      : isActive && matchingSkuSources.length === 0
        ? t("selectValidSkuOption")
        : isActive && line.locationId.trim() && !line.sourceKey.trim()
        ? t("selectValidSkuOption")
        : "";
    const warehouseMessage = isActive && hasSkuInput && matchingSkuSources.length > 0 && !line.locationId.trim()
      ? t("selectWarehouseAfterSku")
      : "";
    let quantityMessage = "";
    if (isActive && line.sourceKey.trim() && line.quantity <= 0) {
      quantityMessage = t("outboundQtyRequired");
    } else if (isActive && line.sourceKey.trim() && line.pallets <= 0) {
      quantityMessage = t("outboundPalletCountRequired");
    } else if (!skipAvailabilityChecks && selectedSource && line.quantity > selectedSource.availableQty) {
      quantityMessage = t("outboundQtyExceedsStock", {
        sku: selectedSource.sku,
        available: selectedSource.availableQty
      });
    } else if (!skipAvailabilityChecks && selectedSource && line.pallets > selectedSource.palletCount) {
      quantityMessage = t("outboundPalletsExceedsStock", {
        available: selectedSource.palletCount
      });
    }
    const hasBlockingStep1 = Boolean(warehouseMessage || skuMessage || quantityMessage);

    let pickMessage = "";
    if (!skipAvailabilityChecks && !hasBlockingStep1 && selectedSource && line.quantity > 0) {
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

  const palletCount = lines.reduce((sum, line) => (
    line.sourceKey.trim() && line.quantity > 0 ? sum + Math.max(0, line.pallets) : sum
  ), 0);
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
        allocatedQty,
        pallets: line.pallets
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
  line: Pick<BatchOutboundLineState, "id" | "quantity" | "pallets" | "pickPallets" | "pickPalletsTouched">,
  source: Pick<OutboundSourceOption, "candidates" | "itemNumber" | "sku" | "description">,
  includeAllCandidates: boolean,
  priorReservations?: Map<number, number>
) {
  const selectedPalletQuantities = new Map(
    buildEffectiveOutboundLinePalletSelections(line, source, priorReservations ?? new Map<number, number>())
      .map((entry) => [entry.palletId, entry.quantity] as const)
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
      allocatedQty,
      pallets: line.pallets
    }];
  });
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
  line: Pick<BatchOutboundLineState, "quantity" | "pallets" | "pickPallets" | "pickPalletsTouched">,
  source: Pick<OutboundSourceOption, "candidates">,
  reservations: Map<number, number>
) {
  const normalizedSelections = normalizeOutboundLinePalletPicks(line.pickPallets);
  if (line.pickPalletsTouched) {
    return normalizedSelections;
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

    if (
      areOutboundLinePalletPicksEqual(line.pickPallets, nextPickPallets)
    ) {
      return line;
    }

    changed = true;
    return {
      ...line,
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
    if (entry.quantity <= 0) {
      continue;
    }
    if (entry.palletId <= 0) {
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
	const orderedCandidates = [...candidates].sort(compareOutboundPalletCandidates);
  let remainingQty = quantity;
  const selections: OutboundLinePalletPick[] = [];
	for (const candidate of orderedCandidates) {
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
    palletCount: number;
    lineIds: Set<string>;
    containers: Map<string, {
      key: string;
      containerNo: string;
      storageSections: Set<string>;
      totalQty: number;
      palletCount: number;
      lineIds: Set<string>;
      items: Map<string, {
        key: string;
        sku: string;
        itemNumber: string;
        description: string;
        totalQty: number;
        palletCount: number;
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
      palletCount: 0,
      lineIds: new Set<string>(),
      containers: new Map()
    };
    const containerGroup = warehouseGroup.containers.get(containerKey) ?? {
      key: `${warehouseKey}|${containerKey}`,
      containerNo: row.containerNo || "-",
      storageSections: new Set<string>(),
      totalQty: 0,
      palletCount: 0,
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
      palletCount: 0,
      lineLabels: new Set<string>()
    };

    warehouseGroup.totalQty += row.allocatedQty;
    warehouseGroup.palletCount += row.pallets;
    warehouseGroup.lineIds.add(row.lineId);

    containerGroup.totalQty += row.allocatedQty;
    containerGroup.storageSections.add(normalizeStorageSection(row.storageSection));
    containerGroup.palletCount += row.pallets;
    containerGroup.lineIds.add(row.lineId);

    itemGroup.totalQty += row.allocatedQty;
    itemGroup.palletCount += row.pallets;
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
      palletCount: warehouseGroup.palletCount,
      lineCount: warehouseGroup.lineIds.size,
      containerCount: warehouseGroup.containers.size,
      containers: [...warehouseGroup.containers.values()]
        .map((containerGroup) => ({
          key: containerGroup.key,
          containerNo: containerGroup.containerNo,
          storageSections: [...containerGroup.storageSections].sort(),
          totalQty: containerGroup.totalQty,
          palletCount: containerGroup.palletCount,
          lineCount: containerGroup.lineIds.size,
          items: [...containerGroup.items.values()]
            .map((itemGroup) => ({
              key: itemGroup.key,
              sku: itemGroup.sku,
              itemNumber: itemGroup.itemNumber,
              description: itemGroup.description,
              totalQty: itemGroup.totalQty,
              palletCount: itemGroup.palletCount,
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
  const containerNo = sourceOption.candidates[0]?.containerNo || "-";
  return `${sourceOption.sku} | ${sourceOption.itemNumber || "-"} | ${sourceOption.customerName} | ${containerNo} | ${sourceOption.description}`;
}

function buildOutboundSkuSearchOptions(sourceOptions: OutboundSourceOption[]) {
  const options = new Set<string>();
  for (const sourceOption of sourceOptions) {
    options.add(formatOutboundSourceOptionLabel(sourceOption));
  }
  return [...options].sort((left, right) => left.localeCompare(right));
}

function getExactOutboundSourceSearchMatches(sourceOptions: OutboundSourceOption[], searchValue: string) {
  const normalizedSearchValue = normalizeOutboundSourceSearchValue(searchValue);
  if (!normalizedSearchValue) {
    return [] as OutboundSourceOption[];
  }

  const exactLabelMatches = sourceOptions.filter((sourceOption) => (
    normalizeOutboundSourceSearchValue(formatOutboundSourceOptionLabel(sourceOption)) === normalizedSearchValue
  ));
  if (exactLabelMatches.length > 0) {
    return exactLabelMatches;
  }

  return sourceOptions.filter((sourceOption) => (
    normalizeOutboundSourceSearchValue(sourceOption.sku) === normalizedSearchValue
    || normalizeOutboundSourceSearchValue(sourceOption.itemNumber) === normalizedSearchValue
    || normalizeOutboundSourceSearchValue(sourceOption.customerName) === normalizedSearchValue
    || normalizeOutboundSourceSearchValue(sourceOption.description) === normalizedSearchValue
  ));
}

function hasExactOutboundSourceSearchMatch(sourceOptions: OutboundSourceOption[], searchValue: string) {
  return getExactOutboundSourceSearchMatches(sourceOptions, searchValue).length > 0;
}

function findOutboundSourceOptionBySearchValue(sourceOptions: OutboundSourceOption[], searchValue: string) {
  const exactMatches = getExactOutboundSourceSearchMatches(sourceOptions, searchValue);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  return undefined;
}

function filterOutboundSourcesBySkuSearch(sourceOptions: OutboundSourceOption[], searchValue: string) {
  const normalizedSearchValue = normalizeOutboundSourceSearchValue(searchValue);
  if (!normalizedSearchValue) {
    return [] as OutboundSourceOption[];
  }

  return sourceOptions.filter((sourceOption) => {
    const normalizedLabel = normalizeOutboundSourceSearchValue(formatOutboundSourceOptionLabel(sourceOption));
    return normalizedLabel === normalizedSearchValue
      || normalizedLabel.includes(normalizedSearchValue)
      || normalizeOutboundSourceSearchValue(sourceOption.sku) === normalizedSearchValue
      || normalizeOutboundSourceSearchValue(sourceOption.itemNumber) === normalizedSearchValue;
  });
}

function filterOutboundSourcesByLocation(sourceOptions: OutboundSourceOption[], locationId: string) {
  const normalizedLocationId = locationId.trim();
  if (!normalizedLocationId) {
    return [] as OutboundSourceOption[];
  }
  return sourceOptions.filter((sourceOption) => String(sourceOption.locationId) === normalizedLocationId);
}

function buildOutboundSourceKey(
  customerId: number,
  locationId: number,
  skuMasterId: number,
  storageSection = "",
  containerNo = ""
) {
  return [
    customerId,
    locationId,
    skuMasterId,
    normalizeStorageSection(storageSection),
    containerNo.trim().toUpperCase()
  ].join("|");
}

function findOutboundSourceOption(sourceOptions: OutboundSourceOption[], sourceKey: string) {
  const normalizedSourceKey = sourceKey.trim();
  if (!normalizedSourceKey) {
    return undefined;
  }
  return sourceOptions.find((sourceOption) => sourceOption.sourceKey === normalizedSourceKey);
}

function buildPersistedOutboundSourceOptionsFromDocument(
  document: OutboundDocument | null,
  skuMastersByID: Map<number, SKUMaster>
) {
  const persistedSources = new Map<string, OutboundSourceOption>();
  if (!document) {
    return persistedSources;
  }

  for (const line of document.lines) {
    const allocations = line.pickAllocations.length > 0
      ? line.pickAllocations
      : [{
          id: line.id,
          lineId: line.id,
          itemNumber: line.itemNumber,
          locationId: line.locationId,
          locationName: line.locationName,
          storageSection: line.storageSection,
          containerNo: "",
          allocatedQty: line.quantity,
          pallets: line.pallets,
          createdAt: line.createdAt
        }];
    const skuMasterUnit = skuMastersByID.get(line.skuMasterId)?.unit || "PCS";
    allocations.forEach((allocation, index) => {
      const storageSection = normalizeStorageSection(allocation.storageSection || line.storageSection);
      const containerNo = allocation.containerNo?.trim().toUpperCase() || "";
      const sourceKey = buildOutboundSourceKey(
        document.customerId,
        allocation.locationId || line.locationId,
        line.skuMasterId,
        storageSection,
        containerNo
      );
      if (persistedSources.has(sourceKey)) {
        return;
      }
      const availableQty = Math.max(0, allocation.allocatedQty || line.quantity);
      const palletCount = Math.max(0, allocation.pallets ?? line.pallets ?? 0);
      const candidateID = Math.max(1, line.id * 1000 + index + 1);
      const locationId = allocation.locationId || line.locationId;
      const locationName = allocation.locationName || line.locationName;
      persistedSources.set(sourceKey, {
        sourceKey,
        customerId: document.customerId,
        customerName: document.customerName,
        locationId,
        locationName,
        skuMasterId: line.skuMasterId,
        sku: line.sku,
        itemNumber: line.itemNumber || allocation.itemNumber || "",
        description: line.description || "",
        unit: (line.unitLabel || skuMasterUnit).toUpperCase(),
        availableQty,
        palletCount,
        storageSections: [storageSection],
        containerCount: containerNo ? 1 : 0,
        containerSummary: containerNo ? `${containerNo} (${availableQty})` : "",
        candidates: [{
          id: `persisted-${line.id}-${index}`,
          palletId: candidateID,
          palletCode: containerNo || `POSITION-${line.id}-${index + 1}`,
          customerId: document.customerId,
          customerName: document.customerName,
          locationId,
          locationName,
          storageSection,
          containerNo,
          skuMasterId: line.skuMasterId,
          sku: line.sku,
          itemNumber: line.itemNumber || allocation.itemNumber || "",
          description: line.description || "",
          unit: (line.unitLabel || skuMasterUnit).toUpperCase(),
          availableQty,
          profileBacked: false,
          actualArrivalDate: null,
          createdAt: allocation.createdAt || line.createdAt
        }]
      });
    });
  }

  return persistedSources;
}

export function buildOutboundSourceOptionsFromItems(items: Item[]): OutboundSourceOption[] {
  const sources = new Map<string, OutboundSourceOption>();
  for (const item of items) {
    if (item.availableQty <= 0 || item.containerNo.trim() === "") {
      continue;
    }
    const storageSection = normalizeStorageSection(item.storageSection);
    const containerNo = item.containerNo.trim().toUpperCase();
    const description = displayDescription(item);
    const sourceKey = buildOutboundSourceKey(item.customerId, item.locationId, item.skuMasterId, storageSection, containerNo);
    const existing = sources.get(sourceKey);
    if (existing) {
      existing.availableQty += item.availableQty;
      existing.palletCount += Math.max(0, item.pallets);
      existing.containerSummary = `${containerNo} (${existing.availableQty})`;
      if (existing.candidates[0]) {
        existing.candidates[0].availableQty += item.availableQty;
      }
      continue;
    }

    const candidate: OutboundPalletCandidate = {
        id: `item-${item.id}`,
        palletId: item.id,
        palletCode: containerNo,
        customerId: item.customerId,
        customerName: item.customerName,
        locationId: item.locationId,
        locationName: item.locationName,
        storageSection,
        containerNo,
        skuMasterId: item.skuMasterId,
        sku: item.sku,
        itemNumber: item.itemNumber || "",
        description,
        unit: (item.unit || "PCS").toUpperCase(),
        availableQty: item.availableQty,
        profileBacked: false,
        actualArrivalDate: item.deliveryDate,
        createdAt: item.createdAt
    };
    sources.set(sourceKey, {
        sourceKey,
        customerId: item.customerId,
        customerName: item.customerName,
        locationId: item.locationId,
        locationName: item.locationName,
        skuMasterId: item.skuMasterId,
        sku: item.sku,
        itemNumber: item.itemNumber || "",
        description,
        unit: candidate.unit,
        availableQty: item.availableQty,
        palletCount: Math.max(0, item.pallets),
        storageSections: [storageSection],
        containerCount: 1,
        containerSummary: `${containerNo} (${item.availableQty})`,
        candidates: [candidate]
    });
  }

  return [...sources.values()].sort((left, right) => {
    const customerCompare = left.customerName.localeCompare(right.customerName);
    if (customerCompare !== 0) return customerCompare;
    const locationCompare = left.locationName.localeCompare(right.locationName);
    if (locationCompare !== 0) return locationCompare;
    const containerCompare = left.candidates[0].containerNo.localeCompare(right.candidates[0].containerNo);
    if (containerCompare !== 0) return containerCompare;
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
        ? document.lines.flatMap((line) => {
            const allocations = line.pickAllocations.length > 0
              ? line.pickAllocations
              : [{
                  id: line.id,
                  lineId: line.id,
                  itemNumber: line.itemNumber,
                  locationId: line.locationId,
                  locationName: line.locationName,
                  storageSection: line.storageSection,
                  containerNo: "",
                  allocatedQty: line.quantity,
                  pallets: line.pallets,
                  createdAt: line.createdAt
                }];
            return allocations.map((allocation, index) => {
              const locationId = allocation.locationId || line.locationId;
              const storageSection = normalizeStorageSection(allocation.storageSection || line.storageSection);
              const containerNo = allocation.containerNo?.trim().toUpperCase() || "";
              return {
                id: allocations.length === 1 ? String(line.id) : `${line.id}-${index + 1}`,
                locationId: String(locationId),
                sourceKey: buildOutboundSourceKey(document.customerId, locationId, line.skuMasterId, storageSection, containerNo),
                sourceSearch: "",
                quantity: allocation.allocatedQty || line.quantity,
                pallets: Math.max(0, allocation.pallets ?? line.pallets ?? 0),
                palletsDetailCtns: "",
                unitLabel: line.unitLabel || "PCS",
                cartonSizeMm: line.cartonSizeMm || "",
                netWeightKgs: line.netWeightKgs || 0,
                grossWeightKgs: line.grossWeightKgs || 0,
                reason: line.lineNote || "",
                pickPallets: [],
                pickPalletsTouched: false
              };
            });
          })
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
