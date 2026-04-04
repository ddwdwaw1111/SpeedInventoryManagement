import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/api";
import type { InboundHandlingMode, InboundLaunchIntent } from "../lib/activityManagementLaunchContext";
import { consumePendingInboundReceiptEditorLaunchContext, type InboundReceiptEditorLaunchContext } from "../lib/inboundReceiptEditorLaunchContext";
import { useI18n } from "../lib/i18n";
import {
  DEFAULT_STORAGE_SECTION,
  getLocationSectionOptions,
  normalizeStorageSection,
  type Customer,
  type InboundDocument,
  type InboundDocumentPayload,
  type InboundPalletBreakdown,
  type Item,
  type Location,
  type SKUMaster,
  type UserRole
} from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import { InboundPalletBreakdownPanel } from "./InboundPalletBreakdownPanel";
import { WorkspacePanelHeader } from "./WorkspacePanelChrome";

type InboundWizardStep = 1 | 2 | 3;
type InboundReceiptVariance = "MATCHED" | "SHORT" | "OVER";

type BatchInboundFormState = {
  deliveryDate: string;
  containerNo: string;
  handlingMode: InboundHandlingMode;
  customerId: string;
  locationId: string;
  storageSection: string;
  unitLabel: string;
  documentNote: string;
};

type BatchInboundPalletBreakdownState = {
  id: string;
  quantity: number;
};

type BatchInboundLineState = {
  id: string;
  sku: string;
  description: string;
  storageSection: string;
  reorderLevel: number;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  unitsPerPallet: number;
  palletsDetailCtns: string;
  palletBreakdown: BatchInboundPalletBreakdownState[];
  palletBreakdownExplicit: boolean;
  palletBreakdownTouched: boolean;
  lineNote: string;
};

type InboundReceiptEditorLocalDraft = {
  version: 1;
  form: BatchInboundFormState;
  lines: BatchInboundLineState[];
  step: InboundWizardStep;
  inboundEditorIntent: InboundLaunchIntent | null;
};

type InboundReceiptEditorPageProps = {
  routeKey: string;
  documentId: number | null;
  document: InboundDocument | null;
  items: Item[];
  skuMasters: SKUMaster[];
  locations: Location[];
  customers: Customer[];
  inboundDocuments: InboundDocument[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onBackToList: () => void;
  onOpenInboundDetail: (documentId: number) => void;
  onOpenReceiptEditor: (documentId?: number | null, context?: InboundReceiptEditorLaunchContext) => void;
};

export function InboundReceiptEditorPage({
  routeKey,
  documentId,
  document,
  items,
  skuMasters,
  locations,
  customers,
  inboundDocuments,
  currentUserRole,
  isLoading,
  onRefresh,
  onBackToList,
  onOpenInboundDetail,
  onOpenReceiptEditor
}: InboundReceiptEditorPageProps) {
  const { t } = useI18n();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const [batchForm, setBatchForm] = useState<BatchInboundFormState>(() => createEmptyBatchInboundForm());
  const [batchLines, setBatchLines] = useState<BatchInboundLineState[]>(() => [createEmptyBatchInboundLine()]);
  const [errorMessage, setErrorMessage] = useState("");
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [inboundWizardStep, setInboundWizardStep] = useState<InboundWizardStep>(1);
  const [batchInboundLineAddCount, setBatchInboundLineAddCount] = useState(1);
  const [inboundEditorIntent, setInboundEditorIntent] = useState<InboundLaunchIntent | null>(null);
  const [expandedPalletBreakdowns, setExpandedPalletBreakdowns] = useState<Record<string, boolean>>({});
  const [hasRestoredLocalDraft, setHasRestoredLocalDraft] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const pendingBatchLineIDRef = useRef<string | null>(null);
  const lastInitializedRouteRef = useRef<string | null>(null);
  const draftStorageKey = useMemo(() => getInboundReceiptEditorDraftStorageKey(documentId), [documentId]);
  const skuMastersBySku = useMemo(() => new Map(
    skuMasters.map((skuMaster) => [normalizeSkuLookupValue(skuMaster.sku), skuMaster] as const)
  ), [skuMasters]);
  const batchLocation = locations.find((location) => location.id === Number(batchForm.locationId));
  const batchCustomer = customers.find((customer) => customer.id === Number(batchForm.customerId));
  const batchSectionOptions = useMemo(() => getLocationSectionOptions(batchLocation), [batchLocation]);
  const inboundContainerWarnings = useMemo(
    () => buildInboundContainerWarnings(batchForm.containerNo, inboundDocuments, document?.id ?? null),
    [batchForm.containerNo, document?.id, inboundDocuments]
  );
  const validBatchInboundLines = useMemo(
    () => batchLines.filter((line) => line.sku.trim() && (line.receivedQty > 0 || line.expectedQty > 0)),
    [batchLines]
  );
  const inboundWizardSummary = useMemo(() => {
    let matchedLines = 0;
    let shortLines = 0;
    let overLines = 0;

    for (const line of validBatchInboundLines) {
      switch (getInboundReceiptVariance(line.expectedQty, line.receivedQty)) {
        case "SHORT":
          shortLines += 1;
          break;
        case "OVER":
          overLines += 1;
          break;
        default:
          matchedLines += 1;
          break;
      }
    }

    return {
      lineCount: validBatchInboundLines.length,
      totalExpectedQty: validBatchInboundLines.reduce((sum, line) => sum + line.expectedQty, 0),
      totalReceivedQty: validBatchInboundLines.reduce((sum, line) => sum + (line.receivedQty > 0 ? line.receivedQty : line.expectedQty), 0),
      totalPallets: validBatchInboundLines.reduce((sum, line) => sum + line.pallets, 0),
      matchedLines,
      shortLines,
      overLines,
      varianceLines: shortLines + overLines
    };
  }, [validBatchInboundLines]);
  const isEditingInboundDraft = normalizeDocumentStatus(document?.status ?? "") === "DRAFT";
  const isEditingConfirmedInbound = normalizeDocumentStatus(document?.status ?? "") === "CONFIRMED";
  const isEditingExistingDocument = Boolean(documentId && document);
  const isEditorMissing = Boolean(documentId) && !document && !isLoading;
  const canEditCurrentDocument = !document || (!document.archivedAt && ["DRAFT", "CONFIRMED"].includes(normalizeDocumentStatus(document.status)));
  const isReadOnly = !canManage || !canEditCurrentDocument;

  useEffect(() => {
    if (!pendingBatchLineIDRef.current) {
      return;
    }

    const nextLine = window.document.getElementById(`receipt-editor-line-${pendingBatchLineIDRef.current}`);
    if (!nextLine) {
      return;
    }

    nextLine.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const firstInput = nextLine.querySelector("input");
    if (firstInput instanceof HTMLInputElement) {
      firstInput.focus();
      firstInput.select();
    }

    pendingBatchLineIDRef.current = null;
  }, [batchLines]);

  useEffect(() => {
    const fallbackSection = batchSectionOptions[0] || DEFAULT_STORAGE_SECTION;
    if (!batchSectionOptions.includes(batchForm.storageSection)) {
      setBatchForm((current) => ({ ...current, storageSection: fallbackSection }));
    }
  }, [batchForm.storageSection, batchSectionOptions]);

  useEffect(() => {
    const fallbackSection = batchSectionOptions[0] || DEFAULT_STORAGE_SECTION;
    setBatchLines((current) => {
      const needsUpdate = current.some((line) => !batchSectionOptions.includes(line.storageSection));
      if (!needsUpdate) {
        return current;
      }

      return current.map((line) => (
        batchSectionOptions.includes(line.storageSection) ? line : { ...line, storageSection: fallbackSection }
      ));
    });
  }, [batchSectionOptions]);

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

    const launchContext = consumePendingInboundReceiptEditorLaunchContext();
    const localDraft = loadInboundReceiptEditorDraft(draftStorageKey);
    const sourceState = buildInboundEditorSourceState({
      document,
      customers,
      locations,
      launchContext,
      skuMastersBySku
    });

    if (localDraft) {
      setBatchForm(localDraft.form);
      setBatchLines(localDraft.lines.length > 0 ? localDraft.lines : [createEmptyBatchInboundLine()]);
      setInboundWizardStep(localDraft.step);
      setInboundEditorIntent(localDraft.inboundEditorIntent);
      setHasRestoredLocalDraft(true);
    } else {
      setBatchForm(sourceState.form);
      setBatchLines(sourceState.lines);
      setInboundWizardStep(1);
      setInboundEditorIntent(sourceState.inboundEditorIntent);
      setHasRestoredLocalDraft(false);
    }

    setErrorMessage("");
    setBatchSubmitting(false);
    setBatchInboundLineAddCount(1);
    setExpandedPalletBreakdowns({});
    setIsEditorReady(true);
    lastInitializedRouteRef.current = routeKey;
  }, [customers, document, documentId, draftStorageKey, isLoading, locations, routeKey, skuMastersBySku]);

  useEffect(() => {
    if (!isEditorReady || isReadOnly) {
      return;
    }

    saveInboundReceiptEditorDraft(draftStorageKey, {
      version: 1,
      form: batchForm,
      lines: batchLines,
      step: inboundWizardStep,
      inboundEditorIntent
    });
  }, [batchForm, batchLines, draftStorageKey, inboundEditorIntent, inboundWizardStep, isEditorReady, isReadOnly]);

  function showActionError(error: unknown, fallbackMessage: string) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    setErrorMessage(message);
    showError(message);
  }

  function showActionSuccess(message: string) {
    setErrorMessage("");
    showSuccess(message);
  }

  function resetToSourceState() {
    const sourceState = buildInboundEditorSourceState({
      document,
      customers,
      locations,
      launchContext: null,
      skuMastersBySku
    });
    setBatchForm(sourceState.form);
    setBatchLines(sourceState.lines);
    setInboundWizardStep(1);
    setInboundEditorIntent(sourceState.inboundEditorIntent);
    setExpandedPalletBreakdowns({});
    setHasRestoredLocalDraft(false);
    clearInboundReceiptEditorDraft(draftStorageKey);
  }

  function togglePalletBreakdown(lineId: string) {
    setExpandedPalletBreakdowns((current) => ({
      ...current,
      [lineId]: !current[lineId]
    }));
  }

  function getSafeLineAddCount(value: number) {
    return Math.min(50, Math.max(1, Math.floor(value) || 1));
  }

  function addBatchLine(count = batchInboundLineAddCount) {
    const safeCount = getSafeLineAddCount(count);
    const nextLines = Array.from({ length: safeCount }, () =>
      createEmptyBatchInboundLine(normalizeStorageSection(batchForm.storageSection || batchSectionOptions[0]))
    );
    pendingBatchLineIDRef.current = nextLines[0]?.id ?? null;
    setBatchLines((current) => [...current, ...nextLines]);
  }

  function removeBatchLine(lineID: string) {
    setBatchLines((current) => current.length === 1 ? current : current.filter((line) => line.id !== lineID));
  }

  function updateBatchLineSku(lineID: string, nextSkuValue: string) {
    setBatchLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const previousSkuMaster = skuMastersBySku.get(normalizeSkuLookupValue(line.sku));
      const nextSkuMaster = skuMastersBySku.get(normalizeSkuLookupValue(nextSkuValue));
      if (!nextSkuMaster) {
        return {
          ...line,
          sku: nextSkuValue
        };
      }

      const previousDescription = previousSkuMaster ? getSKUMasterDescription(previousSkuMaster) : "";
      const nextDescription = getSKUMasterDescription(nextSkuMaster);
      const totalQty = line.receivedQty;
      const previousAutoPalletPlan = buildAutoPalletPlan(totalQty, getEffectiveInboundUnitsPerPallet(line, previousSkuMaster));
      const nextAutoPalletPlan = buildAutoPalletPlan(totalQty, getEffectiveInboundUnitsPerPallet(line, nextSkuMaster));
      const shouldRefreshDescription = !line.description.trim() || (previousDescription && line.description.trim() === previousDescription);
      const shouldRefreshReorder = line.reorderLevel <= 0 || (previousSkuMaster !== undefined && line.reorderLevel === previousSkuMaster.reorderLevel);
      const shouldRefreshPallets = line.pallets <= 0 || (previousSkuMaster !== undefined && line.pallets === previousAutoPalletPlan.pallets);
      const nextPallets = shouldRefreshPallets ? nextAutoPalletPlan.pallets : line.pallets;
      const shouldPreserveExplicitBreakdown = line.palletBreakdownExplicit || line.palletBreakdownTouched;
      const nextPalletBreakdown = shouldPreserveExplicitBreakdown
        ? line.palletBreakdown
        : buildInboundPalletBreakdown(totalQty, nextPallets, getEffectiveInboundUnitsPerPallet(line, nextSkuMaster));
      const nextPalletDetail = shouldPreserveExplicitBreakdown
        ? line.palletsDetailCtns
        : formatInboundPalletBreakdownDetail(nextPalletBreakdown);

      return {
        ...line,
        sku: nextSkuValue,
        description: shouldRefreshDescription ? nextDescription : line.description,
        storageSection: normalizeStorageSection(line.storageSection || batchForm.storageSection || batchSectionOptions[0]),
        reorderLevel: shouldRefreshReorder ? nextSkuMaster.reorderLevel : line.reorderLevel,
        pallets: nextPallets,
        palletBreakdown: nextPalletBreakdown,
        palletBreakdownExplicit: line.palletBreakdownExplicit,
        palletsDetailCtns: nextPalletDetail
      };
    }));
  }

  function updateBatchLine(lineID: string, updates: Partial<BatchInboundLineState>) {
    setBatchLines((current) => current.map((line) => line.id === lineID ? { ...line, ...updates } : line));
  }

  function updateBatchLineExpectedQty(lineID: string, nextExpectedQty: number) {
    setBatchLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const skuMaster = skuMastersBySku.get(normalizeSkuLookupValue(line.sku));
      const unitsPerPallet = getEffectiveInboundUnitsPerPallet(line, skuMaster);
      const previousSuggested = calculateSuggestedReorderLevel(line.expectedQty, line.receivedQty);
      const nextReceivedQty = line.receivedQty;
      const nextSuggested = calculateSuggestedReorderLevel(nextExpectedQty, nextReceivedQty);
      const shouldKeepAutoReorder = line.reorderLevel <= 0 || line.reorderLevel === previousSuggested;
      const previousAutoPalletPlan = buildAutoPalletPlan(line.receivedQty, unitsPerPallet);
      const nextAutoPalletPlan = buildAutoPalletPlan(nextReceivedQty, unitsPerPallet);
      const shouldKeepAutoPallets = line.pallets <= 0 || line.pallets === previousAutoPalletPlan.pallets;
      const nextPallets = shouldKeepAutoPallets ? nextAutoPalletPlan.pallets : line.pallets;
      const shouldPreserveExplicitBreakdown = line.palletBreakdownExplicit || line.palletBreakdownTouched;
      const nextPalletBreakdown = shouldPreserveExplicitBreakdown
        ? line.palletBreakdown
        : buildInboundPalletBreakdown(nextReceivedQty, nextPallets, unitsPerPallet);
      const nextPalletDetail = shouldPreserveExplicitBreakdown
        ? line.palletsDetailCtns
        : formatInboundPalletBreakdownDetail(nextPalletBreakdown);

      return {
        ...line,
        expectedQty: nextExpectedQty,
        reorderLevel: shouldKeepAutoReorder ? nextSuggested : line.reorderLevel,
        pallets: nextPallets,
        palletBreakdown: nextPalletBreakdown,
        palletBreakdownExplicit: line.palletBreakdownExplicit,
        palletsDetailCtns: nextPalletDetail
      };
    }));
  }

  function updateBatchLineReceivedQty(lineID: string, nextReceivedQty: number) {
    setBatchLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const skuMaster = skuMastersBySku.get(normalizeSkuLookupValue(line.sku));
      const unitsPerPallet = getEffectiveInboundUnitsPerPallet(line, skuMaster);
      const previousSuggested = calculateSuggestedReorderLevel(line.expectedQty, line.receivedQty);
      const nextSuggested = calculateSuggestedReorderLevel(line.expectedQty, nextReceivedQty);
      const shouldKeepAutoReorder = line.reorderLevel <= 0 || line.reorderLevel === previousSuggested;
      const previousAutoPalletPlan = buildAutoPalletPlan(line.receivedQty, unitsPerPallet);
      const nextAutoPalletPlan = buildAutoPalletPlan(nextReceivedQty, unitsPerPallet);
      const shouldKeepAutoPallets = line.pallets <= 0 || line.pallets === previousAutoPalletPlan.pallets;
      const nextPallets = shouldKeepAutoPallets ? nextAutoPalletPlan.pallets : line.pallets;
      const shouldPreserveExplicitBreakdown = line.palletBreakdownExplicit || line.palletBreakdownTouched;
      const nextPalletBreakdown = shouldPreserveExplicitBreakdown
        ? line.palletBreakdown
        : buildInboundPalletBreakdown(nextReceivedQty, nextPallets, unitsPerPallet);
      const nextPalletDetail = shouldPreserveExplicitBreakdown
        ? line.palletsDetailCtns
        : formatInboundPalletBreakdownDetail(nextPalletBreakdown);

      return {
        ...line,
        receivedQty: nextReceivedQty,
        reorderLevel: shouldKeepAutoReorder ? nextSuggested : line.reorderLevel,
        pallets: nextPallets,
        palletBreakdown: nextPalletBreakdown,
        palletBreakdownExplicit: line.palletBreakdownExplicit,
        palletsDetailCtns: nextPalletDetail
      };
    }));
  }

  function autofillBatchLineReceivedQty(lineID: string) {
    setBatchLines((current) => current.map((line) => {
      if (line.id !== lineID || line.receivedQty > 0 || line.expectedQty <= 0) {
        return line;
      }

      const skuMaster = skuMastersBySku.get(normalizeSkuLookupValue(line.sku));
      const unitsPerPallet = getEffectiveInboundUnitsPerPallet(line, skuMaster);
      const nextReceivedQty = line.expectedQty;
      const previousSuggested = calculateSuggestedReorderLevel(line.expectedQty, line.receivedQty);
      const nextSuggested = calculateSuggestedReorderLevel(line.expectedQty, nextReceivedQty);
      const shouldKeepAutoReorder = line.reorderLevel <= 0 || line.reorderLevel === previousSuggested;
      const previousAutoPalletPlan = buildAutoPalletPlan(line.receivedQty, unitsPerPallet);
      const nextAutoPalletPlan = buildAutoPalletPlan(nextReceivedQty, unitsPerPallet);
      const shouldKeepAutoPallets = line.pallets <= 0 || line.pallets === previousAutoPalletPlan.pallets;
      const nextPallets = shouldKeepAutoPallets ? nextAutoPalletPlan.pallets : line.pallets;
      const shouldPreserveExplicitBreakdown = line.palletBreakdownExplicit || line.palletBreakdownTouched;
      const nextPalletBreakdown = shouldPreserveExplicitBreakdown
        ? line.palletBreakdown
        : buildInboundPalletBreakdown(nextReceivedQty, nextPallets, unitsPerPallet);
      const nextPalletDetail = shouldPreserveExplicitBreakdown
        ? line.palletsDetailCtns
        : formatInboundPalletBreakdownDetail(nextPalletBreakdown);

      return {
        ...line,
        receivedQty: nextReceivedQty,
        reorderLevel: shouldKeepAutoReorder ? nextSuggested : line.reorderLevel,
        pallets: nextPallets,
        palletBreakdown: nextPalletBreakdown,
        palletBreakdownExplicit: line.palletBreakdownExplicit,
        palletsDetailCtns: nextPalletDetail
      };
    }));
  }

  function updateBatchLinePallets(lineID: string, nextPallets: number) {
    setBatchLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const previousSuggested = getSuggestedPalletsDetail(line.receivedQty, line.pallets);
      const skuMaster = skuMastersBySku.get(normalizeSkuLookupValue(line.sku));
      const nextPalletBreakdown = buildInboundPalletBreakdown(line.receivedQty, nextPallets, getEffectiveInboundUnitsPerPallet(line, skuMaster));
      const nextSuggested = formatInboundPalletBreakdownDetail(nextPalletBreakdown);
      const shouldKeepAutoPalletsDetail = !line.palletsDetailCtns || line.palletsDetailCtns === previousSuggested || !line.palletBreakdownTouched;

      return {
        ...line,
        pallets: nextPallets,
        palletBreakdown: nextPalletBreakdown,
        palletBreakdownExplicit: false,
        palletBreakdownTouched: false,
        palletsDetailCtns: shouldKeepAutoPalletsDetail ? nextSuggested : line.palletsDetailCtns
      };
    }));
  }

  function updateBatchLineUnitsPerPallet(lineID: string, nextUnitsPerPallet: number) {
    setBatchLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const normalizedUnitsPerPallet = Math.max(0, nextUnitsPerPallet);
      const skuMaster = skuMastersBySku.get(normalizeSkuLookupValue(line.sku));
      const effectiveUnitsPerPallet = normalizedUnitsPerPallet > 0
        ? normalizedUnitsPerPallet
        : getEffectiveInboundUnitsPerPallet({ unitsPerPallet: 0 }, skuMaster);
      const nextAutoPalletPlan = buildAutoPalletPlan(line.receivedQty, effectiveUnitsPerPallet);
      const nextPalletBreakdown = buildInboundPalletBreakdown(line.receivedQty, nextAutoPalletPlan.pallets, effectiveUnitsPerPallet);

      return {
        ...line,
        unitsPerPallet: normalizedUnitsPerPallet,
        pallets: nextAutoPalletPlan.pallets,
        palletBreakdown: nextPalletBreakdown,
        palletBreakdownExplicit: false,
        palletBreakdownTouched: false,
        palletsDetailCtns: formatInboundPalletBreakdownDetail(nextPalletBreakdown)
      };
    }));
  }

  function updateBatchLinePalletBreakdownQuantity(lineID: string, palletLineID: string, nextQuantity: number) {
    setBatchLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const nextPalletBreakdown = line.palletBreakdown.map((entry) =>
        entry.id === palletLineID
          ? { ...entry, quantity: Math.max(0, nextQuantity) }
          : entry
      );

      return {
        ...line,
        palletBreakdown: nextPalletBreakdown,
        palletBreakdownExplicit: true,
        palletBreakdownTouched: true,
        palletsDetailCtns: formatInboundPalletBreakdownDetail(nextPalletBreakdown)
      };
    }));
  }

  function resetBatchLinePalletBreakdown(lineID: string) {
    setBatchLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const skuMaster = skuMastersBySku.get(normalizeSkuLookupValue(line.sku));
      const nextPalletBreakdown = buildInboundPalletBreakdown(line.receivedQty, line.pallets, getEffectiveInboundUnitsPerPallet(line, skuMaster));
      return {
        ...line,
        palletBreakdown: nextPalletBreakdown,
        palletBreakdownExplicit: false,
        palletBreakdownTouched: false,
        palletsDetailCtns: formatInboundPalletBreakdownDetail(nextPalletBreakdown)
      };
    }));
  }

  function validateInboundHeader() {
    const batchLocationId = Number(batchForm.locationId);
    const batchCustomerId = Number(batchForm.customerId);
    if (!batchCustomerId) {
      return t("chooseCustomerBeforeSave");
    }
    if (!batchLocationId) {
      return t("chooseStorageBeforeSave");
    }

    return "";
  }

  function validateInboundDraft(requirePalletReady: boolean) {
    const headerValidationError = validateInboundHeader();
    if (headerValidationError) {
      return headerValidationError;
    }

    if (validBatchInboundLines.length === 0) {
      return t("batchInboundRequireLine");
    }

    for (const line of validBatchInboundLines) {
      const normalizedSku = normalizeSkuLookupValue(line.sku);
      const matchingTemplate = items.find((item) => item.sku.trim().toUpperCase() === normalizedSku);
      const matchingSkuMaster = skuMastersBySku.get(normalizedSku);
      const lineDescription = line.description.trim()
        || displayDescription(matchingTemplate ?? { description: "", name: "" })
        || (matchingSkuMaster ? getSKUMasterDescription(matchingSkuMaster) : "");

      if (!matchingTemplate && !lineDescription) {
        return t("batchInboundMissingNewSkuDetails", { sku: normalizedSku || "-" });
      }
    }

    if (requirePalletReady && batchForm.handlingMode !== "SEALED_TRANSIT") {
      const invalidBreakdownLine = validBatchInboundLines.find((line) =>
        line.pallets > 0
        && line.receivedQty > 0
        && getInboundPalletBreakdownTotal(line.palletBreakdown) !== line.receivedQty
      );
      if (invalidBreakdownLine) {
        return t("palletBreakdownTotalMismatch", {
          assigned: getInboundPalletBreakdownTotal(invalidBreakdownLine.palletBreakdown),
          received: invalidBreakdownLine.receivedQty
        });
      }
    }

    return "";
  }

  function moveInboundWizardStep(nextStep: InboundWizardStep) {
    if (nextStep === inboundWizardStep || isReadOnly) {
      return;
    }

    if (nextStep === 2) {
      const validationError = validateInboundHeader();
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }
    }
    if (nextStep === 3) {
      const validationError = validateInboundDraft(batchForm.handlingMode !== "SEALED_TRANSIT");
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }
    }

    setErrorMessage("");
    setInboundWizardStep(nextStep);
  }

  async function submitInboundDocument(status: "DRAFT" | "CONFIRMED") {
    if (isReadOnly) {
      return;
    }

    setBatchSubmitting(true);
    setErrorMessage("");

    const validationError = validateInboundDraft(batchForm.handlingMode !== "SEALED_TRANSIT");
    if (validationError) {
      setErrorMessage(validationError);
      setBatchSubmitting(false);
      return;
    }

    const batchLocationId = Number(batchForm.locationId);
    const batchCustomerId = Number(batchForm.customerId);

    try {
      const isSealedTransitMode = batchForm.handlingMode === "SEALED_TRANSIT" && !isEditingConfirmedInbound;
      const effectiveStatus = isSealedTransitMode ? "DRAFT" : status;
      const payload: InboundDocumentPayload = {
        customerId: batchCustomerId,
        locationId: batchLocationId,
        deliveryDate: batchForm.deliveryDate || undefined,
        containerNo: batchForm.containerNo || undefined,
        handlingMode: batchForm.handlingMode,
        storageSection: normalizeStorageSection(validBatchInboundLines[0]?.storageSection || batchForm.storageSection || batchSectionOptions[0]),
        unitLabel: batchForm.unitLabel || "CTN",
        status: effectiveStatus,
        trackingStatus: effectiveStatus === "DRAFT"
          ? normalizeInboundTrackingStatusValue(document?.trackingStatus, document?.status)
          : "RECEIVED",
        documentNote: batchForm.documentNote || undefined,
        lines: validBatchInboundLines.map((line) => {
          const normalizedSku = line.sku.trim().toUpperCase();
          const matchingTemplate = items.find((item) => item.sku.trim().toUpperCase() === normalizedSku);
          const matchingSkuMaster = skuMastersBySku.get(normalizedSku);
          const lineDescription = line.description.trim()
            || displayDescription(matchingTemplate ?? { description: "", name: "" })
            || (matchingSkuMaster ? getSKUMasterDescription(matchingSkuMaster) : "");
          const normalizedReceivedQty = line.receivedQty > 0 ? line.receivedQty : line.expectedQty;
          const effectiveUnitsPerPallet = getEffectiveInboundUnitsPerPallet(line, matchingSkuMaster);
          const palletBreakdownPayload = isSealedTransitMode
            ? undefined
            : line.palletBreakdown
                .filter((entry) => entry.quantity > 0)
                .map((entry) => ({ quantity: entry.quantity }));

          return {
            sku: normalizedSku,
            description: lineDescription,
            reorderLevel: line.reorderLevel || matchingTemplate?.reorderLevel || matchingSkuMaster?.reorderLevel || 0,
            expectedQty: line.expectedQty,
            receivedQty: normalizedReceivedQty,
            pallets: isSealedTransitMode ? 0 : line.pallets,
            ...(effectiveUnitsPerPallet > 0 ? { unitsPerPallet: effectiveUnitsPerPallet } : {}),
            palletsDetailCtns: isSealedTransitMode ? undefined : line.palletsDetailCtns || undefined,
            storageSection: normalizeStorageSection(line.storageSection || batchForm.storageSection || batchSectionOptions[0]),
            lineNote: line.lineNote || undefined,
            ...(palletBreakdownPayload && palletBreakdownPayload.length > 0 ? { palletBreakdown: palletBreakdownPayload } : {})
          };
        })
      };

      const savedDocument = document?.id
        ? await api.updateInboundDocument(document.id, payload)
        : await api.createInboundDocument(payload);

      clearInboundReceiptEditorDraft(draftStorageKey);
      setHasRestoredLocalDraft(false);
      await onRefresh();

      if (effectiveStatus === "DRAFT") {
        showActionSuccess(t("receiptSavedSuccess"));
        if (!document?.id) {
          onOpenReceiptEditor(savedDocument.id);
        }
        return;
      }

      showActionSuccess(document?.id ? t("receiptSavedSuccess") : t("receiptConfirmedSuccess"));
      onOpenInboundDetail(savedDocument.id);
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    } finally {
      setBatchSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inboundWizardStep < 3) {
      moveInboundWizardStep((inboundWizardStep + 1) as InboundWizardStep);
      return;
    }

    void submitInboundDocument(batchForm.handlingMode === "SEALED_TRANSIT" && !isEditingConfirmedInbound ? "DRAFT" : "CONFIRMED");
  }

  if (isEditorMissing) {
    return (
      <main className="workspace-main">
        <div className="space-y-6 pb-6">
          <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
            <WorkspacePanelHeader title={t("receiptEditorMissingTitle")} description={t("receiptEditorMissingDesc")} />
            <div className="sheet-form__actions" style={{ marginTop: "1rem" }}>
              <button className="button button--primary" type="button" onClick={onBackToList}>{t("navReceiving")}</button>
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
            <WorkspacePanelHeader title={t("loadingRecords")} description={t("receiptEditorPageDesc")} />
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
                <span>{t("receiptEditorPage")}</span>
              </div>
              <div>
                <h1 className="font-headline text-3xl font-extrabold tracking-tight text-[#0d2d63]">
                  {document
                    ? (isEditingConfirmedInbound ? t("receiptEditorConfirmedTitle") : t("receiptEditorDraftTitle"))
                    : t("receiptEditorNewTitle")}
                </h1>
                <p className="mt-1.5 max-w-3xl text-sm text-slate-600">
                  {t("receiptEditorPageDesc")}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {document?.id ? (
                <button
                  type="button"
                  onClick={() => onOpenInboundDetail(document.id)}
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
          <WorkspacePanelHeader title={t("receiptEditorPage")} description={t("receiptEditorStepHint")} />

          {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
          {hasRestoredLocalDraft ? (
            <InlineAlert severity="info">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{t("receiptLocalDraftRestored")}</span>
                <button className="button button--ghost" type="button" onClick={resetToSourceState}>{t("discardLocalDraft")}</button>
              </div>
            </InlineAlert>
          ) : null}
          {isReadOnly ? (
            <InlineAlert severity="warning">{t("readOnlyModeNotice")}</InlineAlert>
          ) : null}
          {isEditingConfirmedInbound ? (
            <InlineAlert severity="info">{t("confirmedReceiptEditNotice")}</InlineAlert>
          ) : null}
          {inboundEditorIntent === "convert-sealed-transit" ? (
            <InlineAlert severity="info">{t("convertToPalletizedNotice")}</InlineAlert>
          ) : null}
          {batchForm.handlingMode === "SEALED_TRANSIT" ? (
            <InlineAlert severity="info">{t("sealedTransitDraftNotice")}</InlineAlert>
          ) : null}

          <form onSubmit={handleSubmit}>
            <div className="shipment-wizard__steps">
              {([
                [1, t("receiptStepInfo")],
                [2, t("receiptStepLines")],
                [3, t("receiptStepReview")]
              ] as const).map(([step, label]) => (
                <button
                  key={step}
                  type="button"
                  className={`shipment-wizard__step ${inboundWizardStep === step ? "shipment-wizard__step--active" : ""}`}
                  onClick={() => moveInboundWizardStep(step)}
                  disabled={isReadOnly}
                >
                  <span className="shipment-wizard__step-index">{step}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {inboundWizardStep === 1 ? (
              <>
                <div className="sheet-form sheet-form--compact">
                  <label>{t("deliveryDate")}<input type="date" value={batchForm.deliveryDate} disabled={isReadOnly} onChange={(event) => setBatchForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
                  <label>{t("containerNo")}<input value={batchForm.containerNo} disabled={isReadOnly} onChange={(event) => setBatchForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="MRSU8580370" /></label>
                  <label>{t("handlingMode")}<select value={batchForm.handlingMode} onChange={(event) => setBatchForm((current) => ({ ...current, handlingMode: event.target.value as InboundHandlingMode }))} disabled={isReadOnly || isEditingConfirmedInbound}><option value="PALLETIZED">{t("handlingModePalletized")}</option><option value="SEALED_TRANSIT">{t("handlingModeSealedTransit")}</option></select></label>
                  <label>{t("customer")}<select value={batchForm.customerId} onChange={(event) => setBatchForm((current) => ({ ...current, customerId: event.target.value }))} disabled={isReadOnly}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
                  <label>{t("currentStorage")}<select value={batchForm.locationId} onChange={(event) => setBatchForm((current) => ({ ...current, locationId: event.target.value }))} disabled={isReadOnly}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                  <label>{t("inboundUnit")}<select value={batchForm.unitLabel} onChange={(event) => setBatchForm((current) => ({ ...current, unitLabel: event.target.value }))} disabled={isReadOnly}><option value="CTN">CTN</option><option value="PCS">PCS</option><option value="PALLET">PALLET</option></select></label>
                  <label className="sheet-form__wide">{t("documentNotes")}<input value={batchForm.documentNote} disabled={isReadOnly} onChange={(event) => setBatchForm((current) => ({ ...current, documentNote: event.target.value }))} placeholder={t("inboundNotePlaceholder")} /></label>
                </div>

                {inboundContainerWarnings.exact.length > 0 ? (
                  <InlineAlert severity="warning">
                    <strong>{t("duplicateInboundContainerWarning", { containerNo: batchForm.containerNo.trim().toUpperCase() })}</strong>
                    <div className="sheet-warning-list">
                      {inboundContainerWarnings.exact.map((match) => (
                        <div key={`exact-${match.documentId}`} className="sheet-warning-list__item">
                          <span className="cell--mono">{match.containerNo}</span>
                          <span className="sheet-warning-list__meta">{[match.customerName || "-", match.dateLabel || "-"].join(" · ")}</span>
                        </div>
                      ))}
                    </div>
                  </InlineAlert>
                ) : null}

                {inboundContainerWarnings.exact.length === 0 && inboundContainerWarnings.similar.length > 0 ? (
                  <InlineAlert severity="info">
                    <strong>{t("similarInboundContainerWarning", { containerNo: batchForm.containerNo.trim().toUpperCase() })}</strong>
                    <div className="sheet-warning-list">
                      {inboundContainerWarnings.similar.map((match) => (
                        <div key={`similar-${match.documentId}`} className="sheet-warning-list__item">
                          <span className="cell--mono">{match.containerNo}</span>
                          <span className="sheet-warning-list__meta">
                            {[`${Math.round(match.similarity * 100)}%`, match.customerName || "-", match.dateLabel || "-"].join(" · ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </InlineAlert>
                ) : null}
              </>
            ) : null}

            {inboundWizardStep === 2 ? (
              <>
                <div className="batch-allocation-preview">
                  <div className="batch-allocation-preview__header">
                    <div>
                      <strong>{t("skuLines")}</strong>
                      <span>{t("receiptLinesStepHint")}</span>
                    </div>
                    <div className="batch-allocation-preview__stats">
                      <div className="batch-allocation-preview__stat">
                        <strong>{inboundWizardSummary.lineCount}</strong>
                        <span>{t("totalLines")}</span>
                      </div>
                      <div className="batch-allocation-preview__stat">
                        <strong>{inboundWizardSummary.totalReceivedQty}</strong>
                        <span>{t("received")}</span>
                      </div>
                      <div className="batch-allocation-preview__stat">
                        <strong>{inboundWizardSummary.totalPallets}</strong>
                        <span>{t("pallets")}</span>
                      </div>
                      <div className="batch-allocation-preview__stat">
                        <strong>{inboundWizardSummary.varianceLines}</strong>
                        <span>{t("receiptVariance")}</span>
                      </div>
                    </div>
                  </div>

                  {inboundWizardSummary.varianceLines > 0 ? (
                    <InlineAlert severity="warning">
                      {`${t("receiptVariance")}: ${t("shortReceived")} ${inboundWizardSummary.shortLines} · ${t("overReceived")} ${inboundWizardSummary.overLines}`}
                    </InlineAlert>
                  ) : null}
                </div>

                <div className="batch-lines">
                  <div className="batch-lines__toolbar batch-lines__toolbar--sticky">
                    <strong>{t("skuLines")}</strong>
                    <div className="batch-lines__adder">
                      <label className="batch-lines__adder-label">
                        {t("rowsToAdd")}
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={batchInboundLineAddCount}
                          onChange={(event) => setBatchInboundLineAddCount(getSafeLineAddCount(Number(event.target.value || 1)))}
                          disabled={isReadOnly}
                        />
                      </label>
                      <button
                        className="button button--ghost"
                        type="button"
                        onClick={() => addBatchLine()}
                        disabled={isReadOnly}
                      >
                        <AddCircleOutlineOutlinedIcon fontSize="small" />
                        {t("addSkuLine")}
                      </button>
                    </div>
                  </div>

                  {batchLines.map((line, index) => {
                    const normalizedBatchLineSku = normalizeSkuLookupValue(line.sku);
                    const selectedBatchItem = items.find((item) =>
                      item.sku.trim().toUpperCase() === normalizedBatchLineSku
                      && item.locationId === Number(batchForm.locationId)
                      && item.customerId === Number(batchForm.customerId)
                    );
                    const batchSkuTemplate = items.find((item) => item.sku.trim().toUpperCase() === normalizedBatchLineSku);
                    const batchSkuMaster = skuMastersBySku.get(normalizedBatchLineSku);
                    const suggestedReorderLevel = calculateSuggestedReorderLevel(line.expectedQty, line.receivedQty);
                    const displayedReorderLevel = selectedBatchItem?.reorderLevel ?? batchSkuMaster?.reorderLevel ?? batchSkuTemplate?.reorderLevel ?? line.reorderLevel;
                    const effectiveUnitsPerPallet = getEffectiveInboundUnitsPerPallet(line, batchSkuMaster);
                    const palletUnitLabel = (batchSkuMaster?.unit || batchForm.unitLabel || "CTN").toUpperCase();
                    const lineSkuDisplay = line.sku.trim().toUpperCase() || "-";
                    const lineStorageSectionDisplay = normalizeStorageSection(line.storageSection || batchSectionOptions[0]);
                    const palletBreakdownTotal = getInboundPalletBreakdownTotal(line.palletBreakdown);
                    const canExpandPalletBreakdown = batchForm.handlingMode !== "SEALED_TRANSIT" && line.pallets > 0;
                    const isPalletBreakdownExpanded = Boolean(expandedPalletBreakdowns[line.id]);
                    const hasPalletBreakdownMismatch = batchForm.handlingMode !== "SEALED_TRANSIT" && line.receivedQty > 0 && palletBreakdownTotal !== line.receivedQty;

                    return (
                      <div className="batch-line-card" key={line.id} id={`receipt-editor-line-${line.id}`}>
                        <div className="batch-line-card__header">
                          <div className="batch-line-card__title">
                            <strong>{t("sku")} #{index + 1}</strong>
                            <span className={`status-pill ${selectedBatchItem ? "status-pill--ok" : "status-pill--alert"}`}>
                              {selectedBatchItem ? t("useExistingSku") : t("createNewSku")}
                            </span>
                          </div>
                          <button className="button button--danger button--small" type="button" onClick={() => removeBatchLine(line.id)} disabled={isReadOnly || batchLines.length === 1}>{t("removeLine")}</button>
                        </div>
                        <div className="batch-line-grid batch-line-grid--inbound">
                          <label>{t("sku")}<input value={line.sku} onChange={(event) => updateBatchLineSku(line.id, event.target.value)} placeholder="023042" disabled={isReadOnly} /></label>
                          <label className="batch-line-grid__description">{t("description")}<input value={selectedBatchItem ? displayDescription(selectedBatchItem) : (line.description || (batchSkuMaster ? getSKUMasterDescription(batchSkuMaster) : "") || displayDescription(batchSkuTemplate ?? { description: "", name: "" }))} onChange={(event) => updateBatchLine(line.id, { description: event.target.value })} placeholder={t("descriptionPlaceholder")} disabled={isReadOnly || Boolean(selectedBatchItem)} /></label>
                          <label>{t("expectedQty")}<input type="number" min="0" value={numberInputValue(line.expectedQty)} onChange={(event) => updateBatchLineExpectedQty(line.id, Math.max(0, Number(event.target.value || 0)))} disabled={isReadOnly} /></label>
                          <label>{t("received")}<input type="number" min="0" value={numberInputValue(line.receivedQty)} onChange={(event) => updateBatchLineReceivedQty(line.id, Math.max(0, Number(event.target.value || 0)))} onBlur={() => autofillBatchLineReceivedQty(line.id)} placeholder={line.expectedQty > 0 ? String(line.expectedQty) : ""} disabled={isReadOnly} /></label>
                          <label>{t("pallets")}<input type="number" min="0" value={numberInputValue(line.pallets)} onChange={(event) => updateBatchLinePallets(line.id, Math.max(0, Number(event.target.value || 0)))} disabled={isReadOnly || batchForm.handlingMode === "SEALED_TRANSIT"} /></label>
                          <label>{t("unitsPerPallet")}<input type="number" min="0" value={numberInputValue(line.unitsPerPallet > 0 ? line.unitsPerPallet : effectiveUnitsPerPallet)} onChange={(event) => updateBatchLineUnitsPerPallet(line.id, Math.max(0, Number(event.target.value || 0)))} disabled={isReadOnly || batchForm.handlingMode === "SEALED_TRANSIT"} placeholder={batchSkuMaster?.defaultUnitsPerPallet ? String(batchSkuMaster.defaultUnitsPerPallet) : ""} /></label>
                          <label>{t("storageSection")}<select value={normalizeStorageSection(line.storageSection || batchSectionOptions[0])} onChange={(event) => updateBatchLine(line.id, { storageSection: event.target.value })} disabled={isReadOnly}>{batchSectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
                          <InboundPalletBreakdownPanel
                            title={t("palletBreakdown")}
                            helperText={batchSkuMaster?.defaultUnitsPerPallet ? t("palletUnitsHint", { units: batchSkuMaster.defaultUnitsPerPallet, unit: palletUnitLabel }) : undefined}
                            skuLabel={t("sku")}
                            skuValue={lineSkuDisplay}
                            storageSectionLabel={t("storageSection")}
                            storageSectionValue={lineStorageSectionDisplay}
                            palletsLabel={t("pallets")}
                            palletCount={line.pallets}
                            palletsDetailLabel={t("palletsDetail")}
                            palletsDetailValue={line.palletsDetailCtns || "-"}
                            unitLabel={palletUnitLabel}
                            detailTone={hasPalletBreakdownMismatch ? "danger" : "default"}
                            resetLabel={t("resetPalletBreakdown")}
                            detailsLabel={t("details")}
                            emptyHint={t("palletBreakdownEmptyHint")}
                            sealedHint={t("sealedTransitDraftNotice")}
                            resetDisabled={isReadOnly || batchForm.handlingMode === "SEALED_TRANSIT" || line.pallets <= 0 || line.receivedQty <= 0}
                            canExpand={canExpandPalletBreakdown}
                            expanded={isPalletBreakdownExpanded}
                            onToggle={() => togglePalletBreakdown(line.id)}
                            onReset={() => resetBatchLinePalletBreakdown(line.id)}
                            state={batchForm.handlingMode === "SEALED_TRANSIT" ? "sealed" : line.pallets <= 0 ? "empty" : "ready"}
                            rows={line.palletBreakdown.map((entry, palletIndex) => ({
                              id: entry.id,
                              label: `${t("pallet")} #${palletIndex + 1}`,
                              quantity: entry.quantity
                            }))}
                            onQuantityChange={(entryId, quantity) => updateBatchLinePalletBreakdownQuantity(line.id, entryId, quantity)}
                            inputDisabled={isReadOnly}
                            mismatchMessage={hasPalletBreakdownMismatch ? t("palletBreakdownTotalMismatch", {
                              assigned: palletBreakdownTotal,
                              received: line.receivedQty
                            }) : null}
                          />
                          <label>{t("reorderLevel")}<input type="number" min="0" value={numberInputValue(displayedReorderLevel)} onChange={(event) => updateBatchLine(line.id, { reorderLevel: Math.max(0, Number(event.target.value || 0)) })} placeholder={suggestedReorderLevel > 0 ? String(suggestedReorderLevel) : ""} disabled={isReadOnly || Boolean(selectedBatchItem)} /></label>
                        </div>
                        <div className="batch-line-card__meta">
                          <span className="batch-line-card__hint">
                            {selectedBatchItem
                              ? `${selectedBatchItem.customerName} | ${selectedBatchItem.sku} | ${selectedBatchItem.locationName}`
                              : (line.sku.trim() ? line.sku.trim().toUpperCase() : t("noSkuSelected"))}
                          </span>
                        </div>
                        <div style={{ marginTop: "0.75rem" }}>
                          <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.82rem" }}>
                            {t("internalNotes")}
                            <input
                              value={line.lineNote}
                              onChange={(event) => updateBatchLine(line.id, { lineNote: event.target.value })}
                              placeholder={t("inboundLineNotePlaceholder")}
                              disabled={isReadOnly}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {inboundWizardStep === 3 ? (
              <div className="batch-allocation-preview">
                <div className="batch-allocation-preview__header">
                  <div>
                    <strong>{t("receiptReviewTitle")}</strong>
                    <span>{t("receiptReviewHint")}</span>
                  </div>
                  <div className="batch-allocation-preview__stats">
                    <div className="batch-allocation-preview__stat">
                      <strong>{inboundWizardSummary.lineCount}</strong>
                      <span>{t("totalLines")}</span>
                    </div>
                    <div className="batch-allocation-preview__stat">
                      <strong>{inboundWizardSummary.totalExpectedQty}</strong>
                      <span>{t("expectedQty")}</span>
                    </div>
                    <div className="batch-allocation-preview__stat">
                      <strong>{inboundWizardSummary.totalReceivedQty}</strong>
                      <span>{t("received")}</span>
                    </div>
                    <div className="batch-allocation-preview__stat">
                      <strong>{inboundWizardSummary.totalPallets}</strong>
                      <span>{t("pallets")}</span>
                    </div>
                  </div>
                </div>

                {inboundWizardSummary.varianceLines > 0 ? (
                  <InlineAlert severity="warning">
                    {`${t("receiptVariance")}: ${t("shortReceived")} ${inboundWizardSummary.shortLines} · ${t("overReceived")} ${inboundWizardSummary.overLines}`}
                  </InlineAlert>
                ) : null}

                <div className="batch-lines">
                  <div className="batch-line-card inbound-compact-card">
                    <div className="batch-line-card__header">
                      <div className="batch-line-card__title">
                        <strong>{batchCustomer?.name || t("customer")}</strong>
                        <span className="status-pill status-pill--ok">
                          {batchForm.handlingMode === "SEALED_TRANSIT" ? t("handlingModeSealedTransit") : t("handlingModePalletized")}
                        </span>
                      </div>
                    </div>
                    <div className="batch-line-card__meta">
                      <span className="batch-line-card__hint">
                        {[
                          batchLocation?.name || "-",
                          batchForm.containerNo.trim() ? batchForm.containerNo.trim().toUpperCase() : "-",
                          batchForm.deliveryDate || "-"
                        ].join(" · ")}
                      </span>
                      <span className="batch-line-card__hint">
                        {batchForm.documentNote.trim() || t("inboundDetailNoLineNote")}
                      </span>
                    </div>
                  </div>

                  {validBatchInboundLines.map((line, index) => {
                    const normalizedBatchLineSku = normalizeSkuLookupValue(line.sku);
                    const batchSkuMaster = skuMastersBySku.get(normalizedBatchLineSku);
                    const variance = getInboundReceiptVariance(line.expectedQty, line.receivedQty);
                    const effectiveReceivedQty = line.receivedQty > 0 ? line.receivedQty : line.expectedQty;

                    return (
                      <div className="batch-line-card" key={`review-${line.id}`}>
                        <div className="batch-line-card__header">
                          <div className="batch-line-card__title">
                            <strong>{t("sku")} #{index + 1}</strong>
                            <span className={`status-pill ${getInboundReceiptVarianceClassName(variance)}`}>
                              {t(getInboundReceiptVarianceLabelKey(variance))}
                            </span>
                          </div>
                          <span className="cell--mono">{line.sku.trim().toUpperCase() || "-"}</span>
                        </div>
                        <div className="batch-line-card__meta">
                          <span className="batch-line-card__hint">{line.description.trim() || (batchSkuMaster ? getSKUMasterDescription(batchSkuMaster) : "-")}</span>
                          <span className="batch-line-card__hint">
                            {[
                              `${t("expectedQty")}: ${line.expectedQty}`,
                              `${t("received")}: ${effectiveReceivedQty}`,
                              `${t("pallets")}: ${line.pallets}`,
                              `${t("storageSection")}: ${normalizeStorageSection(line.storageSection || batchForm.storageSection || DEFAULT_STORAGE_SECTION)}`
                            ].join(" · ")}
                          </span>
                          <span className="batch-line-card__hint">
                            {line.lineNote.trim() || t("inboundDetailNoLineNote")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="sheet-form__actions" style={{ marginTop: "1rem" }}>
              {inboundWizardStep === 3 && !isEditingConfirmedInbound ? (
                <button className="button button--ghost" type="button" disabled={batchSubmitting || isReadOnly} onClick={() => void submitInboundDocument("DRAFT")}>{batchSubmitting ? t("saving") : isEditingInboundDraft ? t("saveChanges") : t("saveDraft")}</button>
              ) : null}
              <div className="shipment-wizard__actions">
                {inboundWizardStep > 1 ? (
                  <button className="button button--ghost" type="button" onClick={() => moveInboundWizardStep((inboundWizardStep - 1) as InboundWizardStep)} disabled={isReadOnly}>{t("back")}</button>
                ) : null}
                {inboundWizardStep < 3 ? (
                  <button className="button button--primary" type="button" onClick={() => moveInboundWizardStep((inboundWizardStep + 1) as InboundWizardStep)} disabled={isReadOnly}>{t("next")}</button>
                ) : (
                  <button className="button button--primary" type="submit" disabled={batchSubmitting || isReadOnly}>{batchSubmitting ? t("saving") : isEditingConfirmedInbound ? t("saveChanges") : batchForm.handlingMode === "SEALED_TRANSIT" ? t("saveSealedTransit") : inboundEditorIntent === "convert-sealed-transit" ? t("convertToPalletized") : t("confirmReceipt")}</button>
                )}
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

function buildInboundEditorSourceState({
  document,
  customers,
  locations,
  launchContext,
  skuMastersBySku
}: {
  document: InboundDocument | null;
  customers: Customer[];
  locations: Location[];
  launchContext: InboundReceiptEditorLaunchContext | null;
  skuMastersBySku: Map<string, SKUMaster>;
}) {
  if (!document) {
    return {
      form: {
        ...createEmptyBatchInboundForm(launchContext?.scheduledDate || ""),
        handlingMode: launchContext?.forceHandlingMode ?? "PALLETIZED",
        customerId: customers[0] ? String(customers[0].id) : "",
        locationId: locations[0] ? String(locations[0].id) : ""
      },
      lines: [createEmptyBatchInboundLine()],
      inboundEditorIntent: launchContext?.inboundIntent ?? null
    };
  }

  const normalizedStatus = normalizeDocumentStatus(document.status);
  return {
    form: {
      deliveryDate: document.deliveryDate ? document.deliveryDate.slice(0, 10) : "",
      containerNo: document.containerNo || "",
      handlingMode: launchContext?.forceHandlingMode ?? document.handlingMode ?? "PALLETIZED",
      customerId: String(document.customerId),
      locationId: String(document.locationId),
      storageSection: normalizeStorageSection(document.storageSection),
      unitLabel: document.unitLabel || "CTN",
      documentNote: document.documentNote || ""
    },
    lines: document.lines.length > 0
      ? document.lines.map((line) => ({
          id: String(line.id),
          sku: line.sku || "",
          description: line.description || "",
          storageSection: normalizeStorageSection(line.storageSection || document.storageSection),
          reorderLevel: line.reorderLevel || 0,
          expectedQty: line.expectedQty,
          receivedQty: line.receivedQty,
          pallets: line.pallets,
          unitsPerPallet: line.unitsPerPallet || 0,
          palletsDetailCtns: line.palletsDetailCtns || "",
          ...hydrateInboundPalletBreakdown(
            line.receivedQty,
            line.pallets,
            line.palletsDetailCtns || "",
            line.palletBreakdown,
            skuMastersBySku.get(normalizeSkuLookupValue(line.sku))?.defaultUnitsPerPallet ?? 0
          ),
          lineNote: line.lineNote || ""
        }))
      : [createEmptyBatchInboundLine(normalizeStorageSection(document.storageSection))],
    inboundEditorIntent: launchContext?.inboundIntent ?? (normalizedStatus === "CONFIRMED" ? null : null)
  };
}

function createEmptyBatchInboundForm(deliveryDate = ""): BatchInboundFormState {
  return {
    deliveryDate,
    containerNo: "",
    handlingMode: "PALLETIZED",
    customerId: "",
    locationId: "",
    storageSection: DEFAULT_STORAGE_SECTION,
    unitLabel: "CTN",
    documentNote: ""
  };
}

function createEmptyBatchInboundLine(defaultStorageSection = DEFAULT_STORAGE_SECTION): BatchInboundLineState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku: "",
    description: "",
    storageSection: defaultStorageSection,
    reorderLevel: 0,
    expectedQty: 0,
    receivedQty: 0,
    pallets: 0,
    unitsPerPallet: 0,
    palletsDetailCtns: "",
    palletBreakdown: [],
    palletBreakdownExplicit: false,
    palletBreakdownTouched: false,
    lineNote: ""
  };
}

function createBatchInboundPalletBreakdownState(quantity = 0): BatchInboundPalletBreakdownState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    quantity
  };
}

function getEffectiveInboundUnitsPerPallet(
  line: Pick<BatchInboundLineState, "unitsPerPallet">,
  skuMaster?: Pick<SKUMaster, "defaultUnitsPerPallet">
) {
  return line.unitsPerPallet > 0 ? line.unitsPerPallet : (skuMaster?.defaultUnitsPerPallet ?? 0);
}

function normalizeSkuLookupValue(value: string) {
  return value.trim().toUpperCase();
}

function getSKUMasterDescription(skuMaster: Pick<SKUMaster, "description" | "name">) {
  return skuMaster.description || skuMaster.name;
}

function getSuggestedPalletsDetail(totalQty: number, pallets: number) {
  if (totalQty <= 0 || pallets <= 0) return "";
  if (pallets === 1) return String(totalQty);

  const cartonsPerFullPallet = Math.ceil(totalQty / pallets);
  const remainingCartons = totalQty - (pallets - 1) * cartonsPerFullPallet;
  if (remainingCartons <= 0) return `${pallets}*${Math.floor(totalQty / pallets)}`;

  return `${pallets - 1}*${cartonsPerFullPallet}+${remainingCartons}`;
}

function buildInboundPalletBreakdown(totalQty: number, pallets: number, unitsPerPallet = 0) {
  if (totalQty <= 0 || pallets <= 0) {
    return [] as BatchInboundPalletBreakdownState[];
  }

  if (unitsPerPallet > 0) {
    const quantities: number[] = [];
    let remaining = totalQty;

    while (remaining > 0 && quantities.length < pallets) {
      if (remaining > unitsPerPallet && quantities.length < pallets - 1) {
        quantities.push(unitsPerPallet);
        remaining -= unitsPerPallet;
        continue;
      }

      quantities.push(remaining);
      remaining = 0;
    }

    if (remaining === 0 && quantities.length === pallets) {
      return quantities.map((quantity) => createBatchInboundPalletBreakdownState(quantity));
    }
  }

  const quantities = Array.from({ length: pallets }, (_, index) => {
    const base = Math.floor(totalQty / pallets);
    const remainder = totalQty % pallets;
    return base + (index < remainder ? 1 : 0);
  });

  return quantities.map((quantity) => createBatchInboundPalletBreakdownState(quantity));
}

function formatInboundPalletBreakdownDetail(breakdown: Array<Pick<BatchInboundPalletBreakdownState, "quantity">>) {
  if (breakdown.length === 0) {
    return "";
  }

  const parts: string[] = [];
  let runQuantity = breakdown[0].quantity;
  let runCount = 0;

  const flush = () => {
    if (runCount <= 0) {
      return;
    }
    if (runCount === 1) {
      parts.push(String(runQuantity));
      return;
    }
    parts.push(`${runCount}*${runQuantity}`);
  };

  for (const entry of breakdown) {
    if (entry.quantity === runQuantity) {
      runCount += 1;
      continue;
    }
    flush();
    runQuantity = entry.quantity;
    runCount = 1;
  }
  flush();

  return parts.join("+");
}

function getInboundPalletBreakdownTotal(breakdown: Array<Pick<BatchInboundPalletBreakdownState, "quantity">>) {
  return breakdown.reduce((sum, entry) => sum + Math.max(0, entry.quantity), 0);
}

function parseInboundPalletBreakdown(detail: string, palletCount: number, totalQty: number) {
  const trimmed = detail.trim();
  if (!trimmed || palletCount <= 0 || totalQty <= 0) {
    return null;
  }

  const tokens = trimmed.split("+").map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const quantities: number[] = [];
  for (const token of tokens) {
    const match = token.match(/^(\d+)\*(\d+)$/);
    if (match) {
      const repeatCount = Number(match[1]);
      const quantity = Number(match[2]);
      if (!Number.isFinite(repeatCount) || !Number.isFinite(quantity) || repeatCount <= 0 || quantity <= 0) {
        return null;
      }
      for (let index = 0; index < repeatCount; index += 1) {
        quantities.push(quantity);
      }
      continue;
    }

    const quantity = Number(token);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return null;
    }
    quantities.push(quantity);
  }

  if (quantities.length !== palletCount) {
    return null;
  }
  if (quantities.reduce((sum, quantity) => sum + quantity, 0) !== totalQty) {
    return null;
  }

  return quantities.map((quantity) => createBatchInboundPalletBreakdownState(quantity));
}

function hydrateInboundPalletBreakdown(
  receivedQty: number,
  pallets: number,
  detail: string,
  explicitBreakdown?: InboundPalletBreakdown[],
  unitsPerPallet = 0
) {
  if (explicitBreakdown && explicitBreakdown.length > 0) {
    return {
      palletBreakdown: explicitBreakdown.map((entry) => createBatchInboundPalletBreakdownState(entry.quantity)),
      palletBreakdownExplicit: true,
      palletBreakdownTouched: true
    };
  }

  const parsed = parseInboundPalletBreakdown(detail, pallets, receivedQty);
  if (parsed) {
    return {
      palletBreakdown: parsed,
      palletBreakdownExplicit: false,
      palletBreakdownTouched: false
    };
  }

  return {
    palletBreakdown: buildInboundPalletBreakdown(receivedQty, pallets, unitsPerPallet),
    palletBreakdownExplicit: false,
    palletBreakdownTouched: false
  };
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
    return {
      pallets,
      detail: `${pallets}*${unitsPerPallet}`
    };
  }

  return {
    pallets,
    detail: `${fullPallets}*${unitsPerPallet}+1*${remainder}`
  };
}

function displayDescription(item: Pick<Item, "description" | "name">) {
  return item.description || item.name;
}

function numberInputValue(value: number) {
  return value === 0 ? "" : String(value);
}

function normalizeContainerNo(value: string) {
  return value.trim().toUpperCase();
}

type InboundContainerWarningMatch = {
  documentId: number;
  containerNo: string;
  customerName: string;
  dateLabel: string;
  similarity: number;
};

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length];
}

function getContainerSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeContainerNo(left);
  const normalizedRight = normalizeContainerNo(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  if (maxLength === 0) {
    return 1;
  }

  return 1 - (levenshteinDistance(normalizedLeft, normalizedRight) / maxLength);
}

function buildInboundContainerWarnings(
  containerNo: string,
  inboundDocuments: InboundDocument[],
  editingInboundDocumentId: number | null
) {
  const normalizedValue = normalizeContainerNo(containerNo);
  if (!normalizedValue) {
    return { exact: [] as InboundContainerWarningMatch[], similar: [] as InboundContainerWarningMatch[] };
  }

  const candidateDocuments = inboundDocuments.filter((document) =>
    document.id !== editingInboundDocumentId
    && normalizeDocumentStatus(document.status) !== "CANCELLED"
    && normalizeContainerNo(document.containerNo)
  );

  const exact = candidateDocuments
    .filter((nextDocument) => normalizeContainerNo(nextDocument.containerNo) === normalizedValue)
    .map((nextDocument) => ({
      documentId: nextDocument.id,
      containerNo: normalizeContainerNo(nextDocument.containerNo),
      customerName: nextDocument.customerName || "-",
      dateLabel: nextDocument.deliveryDate || nextDocument.createdAt || "-",
      similarity: 1
    }));

  if (exact.length > 0) {
    return { exact, similar: [] as InboundContainerWarningMatch[] };
  }

  if (normalizedValue.length < 6) {
    return { exact, similar: [] as InboundContainerWarningMatch[] };
  }

  const uniqueSimilarMatches = new Map<string, InboundContainerWarningMatch>();
  for (const nextDocument of candidateDocuments) {
    const normalizedCandidate = normalizeContainerNo(nextDocument.containerNo);
    const similarity = getContainerSimilarity(normalizedValue, normalizedCandidate);
    if (similarity <= 0.9 || normalizedCandidate === normalizedValue) {
      continue;
    }

    const existingMatch = uniqueSimilarMatches.get(normalizedCandidate);
    const nextMatch = {
      documentId: nextDocument.id,
      containerNo: normalizedCandidate,
      customerName: nextDocument.customerName || "-",
      dateLabel: nextDocument.deliveryDate || nextDocument.createdAt || "-",
      similarity
    };
    if (!existingMatch || nextMatch.similarity > existingMatch.similarity) {
      uniqueSimilarMatches.set(normalizedCandidate, nextMatch);
    }
  }

  const similar = Array.from(uniqueSimilarMatches.values())
    .sort((left, right) => right.similarity - left.similarity || left.containerNo.localeCompare(right.containerNo))
    .slice(0, 3);

  return { exact, similar };
}

function calculateSuggestedReorderLevel(expectedQty: number, receivedQty: number) {
  const baseQty = receivedQty > 0 ? receivedQty : expectedQty;
  if (baseQty <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(baseQty * 0.2));
}

function getInboundReceiptVariance(expectedQty: number, receivedQty: number): InboundReceiptVariance {
  if (expectedQty <= 0 || receivedQty === expectedQty) {
    return "MATCHED";
  }
  if (receivedQty > expectedQty) {
    return "OVER";
  }
  return "SHORT";
}

function getInboundReceiptVarianceLabelKey(variance: InboundReceiptVariance) {
  switch (variance) {
    case "OVER":
      return "overReceived";
    case "SHORT":
      return "shortReceived";
    default:
      return "matched";
  }
}

function getInboundReceiptVarianceClassName(variance: InboundReceiptVariance) {
  switch (variance) {
    case "OVER":
      return "status-pill--danger";
    case "SHORT":
      return "status-pill--alert";
    default:
      return "status-pill--ok";
  }
}

function normalizeDocumentStatus(status: string) {
  return status.trim().toUpperCase();
}

function normalizeInboundTrackingStatusValue(trackingStatus?: string | null, documentStatus?: string | null) {
  const normalizedStatus = normalizeDocumentStatus(documentStatus || "");
  if (normalizedStatus === "CONFIRMED") {
    return "RECEIVED";
  }
  const normalizedTrackingStatus = (trackingStatus || "").trim().toUpperCase();
  if (normalizedTrackingStatus === "ARRIVED" || normalizedTrackingStatus === "RECEIVING" || normalizedTrackingStatus === "RECEIVED") {
    return normalizedTrackingStatus;
  }
  return "SCHEDULED";
}

function getInboundReceiptEditorDraftStorageKey(documentId: number | null) {
  return `sim-inbound-receipt-editor-draft:${documentId && documentId > 0 ? documentId : "new"}`;
}

function loadInboundReceiptEditorDraft(storageKey: string) {
  const raw = window.sessionStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as InboundReceiptEditorLocalDraft;
    if (parsed.version !== 1) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveInboundReceiptEditorDraft(storageKey: string, draft: InboundReceiptEditorLocalDraft) {
  window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
}

function clearInboundReceiptEditorDraft(storageKey: string) {
  window.sessionStorage.removeItem(storageKey);
}