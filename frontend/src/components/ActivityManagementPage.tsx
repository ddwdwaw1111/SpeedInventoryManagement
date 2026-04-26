import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { consumePendingActivityManagementLaunchContext, type ActivityManagementLaunchContext, type InboundLaunchIntent } from "../lib/activityManagementLaunchContext";
import { RowActionsMenu } from "./RowActionsMenu";
import { formatContainerDistributionSummary as formatContainerDistributionSummaryValue } from "../lib/containerBalances";
import { formatDateTimeValue, formatDateValue } from "../lib/dates";
import { downloadExcelWorkbook, type ExcelExportColumn } from "../lib/excelExport";
import type { InboundReceiptEditorLaunchContext } from "../lib/inboundReceiptEditorLaunchContext";
import type { OutboundShipmentEditorLaunchContext } from "../lib/outboundShipmentEditorLaunchContext";
import { useI18n } from "../lib/i18n";
import { getOutboundDisplayShipDate, getOutboundExpectedShipDate } from "../lib/outboundDates";
import { setPendingPalletTraceLaunchContext } from "../lib/palletTraceLaunchContext";
import { useSettings } from "../lib/settings";
import {
  DEFAULT_STORAGE_SECTION,
  getLocationSectionOptions,
  normalizeStorageSection,
  type ContainerType,
  type Customer,
  type InboundDocument,
  type InboundDocumentPayload,
  type InboundPalletBreakdown,
  type Item,
  type Location,
  type Movement,
  type OutboundDocument,
  type OutboundPickAllocation,
  type OutboundDocumentPayload,
  type PalletTrace,
  type SKUMaster,
  type UserRole
} from "../lib/types";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { InlineAlert, useConfirmDialog, useFeedbackToast } from "./Feedback";
import { InboundPalletBreakdownPanel } from "./InboundPalletBreakdownPanel";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";
import { OutboundPickPlanPanel } from "./OutboundPickPlanPanel";
import { buildWorkspaceGridSlots, WorkspaceDrawerLoadingState, WorkspacePanelHeader } from "./WorkspacePanelChrome";

type ActivityMode = "IN" | "OUT";
type MutableDocumentStatus = "DRAFT" | "CONFIRMED";
type InboundHandlingMode = "PALLETIZED" | "SEALED_TRANSIT";
type InboundWizardStep = 1 | 2 | 3;
type OutboundWizardStep = 1 | 2 | 3;
type InboundReceiptVariance = "MATCHED" | "SHORT" | "OVER";

type ActivityManagementPageProps = {
  mode: ActivityMode;
  items: Item[];
  skuMasters: SKUMaster[];
  locations: Location[];
  customers: Customer[];
  movements: Movement[];
  inboundDocuments: InboundDocument[];
  outboundDocuments: OutboundDocument[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onOpenInboundDetail?: (documentId: number) => void;
  onOpenPalletTrace?: (sourceInboundDocumentId?: number) => void;
  onOpenInboundReceiptEditor?: (documentId?: number | null, context?: InboundReceiptEditorLaunchContext) => void;
  onOpenOutboundShipmentEditor?: (documentId?: number | null, context?: OutboundShipmentEditorLaunchContext) => void;
  embeddedComposer?: {
    initialDate?: string;
    onClose: () => void;
  };
};

type BatchInboundFormState = {
  expectedArrivalDate: string;
  actualArrivalDate: string;
  containerNo: string;
  containerType: ContainerType;
  handlingMode: InboundHandlingMode;
  customerId: string;
  locationId: string;
  storageSection: string;
  unitLabel: string;
  status: MutableDocumentStatus;
  documentNote: string;
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

type BatchInboundPalletBreakdownState = {
  id: string;
  quantity: number;
};

type BatchOutboundFormState = {
  packingListNo: string;
  orderRef: string;
  expectedShipDate: string;
  actualShipDate: string;
  shipToName: string;
  shipToAddress: string;
  shipToContact: string;
  carrierName: string;
  status: MutableDocumentStatus;
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
};

type OutboundPickAllocationRow = {
  id: string;
  itemNumber: string;
  sku: string;
  description: string;
  locationName: string;
  storageSection: string;
  containerNo: string;
  allocatedQty: number;
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

type InboundContainerWarningMatch = {
  documentId: number;
  containerNo: string;
  customerName: string;
  dateLabel: string;
  similarity: number;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const summaryNumberFormatter = new Intl.NumberFormat("en-US");
const RECEIPTS_EXPORT_TITLE = "Receipts";
const SHIPMENTS_EXPORT_TITLE = "Shipments";
const RECEIPTS_EXPORT_COLUMNS = [
  { key: "expectedArrivalDate", label: "Expected Arrival Date" },
  { key: "containerNo", label: "Container No." },
  { key: "customerName", label: "Customer" },
  { key: "locationName", label: "Warehouse" },
  { key: "totalLines", label: "Total Lines" },
  { key: "totalExpectedQty", label: "Expected Qty" },
  { key: "totalReceivedQty", label: "Received Qty" },
  { key: "trackingStatus", label: "Tracking" },
  { key: "status", label: "Status" }
] as const;
const SHIPMENTS_EXPORT_COLUMNS = [
  { key: "packingListNo", label: "Packing List No." },
  { key: "orderRef", label: "Order Ref." },
  { key: "customerName", label: "Customer" },
  { key: "storages", label: "Warehouse" },
  { key: "expectedShipDate", label: "Expected Ship Date" },
  { key: "actualShipDate", label: "Actual Ship Date" },
  { key: "shipToName", label: "Ship-to Name" },
  { key: "carrierName", label: "Carrier" },
  { key: "totalLines", label: "Total Lines" },
  { key: "totalQty", label: "Total Qty" },
  { key: "totalGrossWeightKgs", label: "Gross Weight (kg)" },
  { key: "trackingStatus", label: "Tracking" },
  { key: "status", label: "Status" }
] as const;

function createEmptyBatchInboundForm(expectedArrivalDate = ""): BatchInboundFormState {
  return {
    expectedArrivalDate,
    actualArrivalDate: "",
    containerNo: "",
    containerType: "NORMAL",
    handlingMode: "PALLETIZED",
    customerId: "",
    locationId: "",
    storageSection: DEFAULT_STORAGE_SECTION,
    unitLabel: "CTN",
    status: "CONFIRMED",
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
    status: "CONFIRMED",
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
    reason: ""
  };
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

export function ActivityManagementPage({
  mode,
  items,
  skuMasters,
  locations,
  customers,
  movements,
  inboundDocuments,
  outboundDocuments,
  currentUserRole,
  isLoading,
  onRefresh,
  onOpenInboundDetail,
  onOpenPalletTrace,
  onOpenInboundReceiptEditor,
  onOpenOutboundShipmentEditor,
  embeddedComposer
}: ActivityManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const [outboundPallets, setOutboundPallets] = useState<PalletTrace[]>([]);
  const [outboundPalletsLoading, setOutboundPalletsLoading] = useState(mode === "OUT");
  const [outboundPalletsLoadError, setOutboundPalletsLoadError] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [errorMessage, setErrorMessage] = useState("");
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchForm, setBatchForm] = useState<BatchInboundFormState>(() => createEmptyBatchInboundForm());
  const [batchLines, setBatchLines] = useState<BatchInboundLineState[]>(() => [createEmptyBatchInboundLine()]);
  const [batchOutboundForm, setBatchOutboundForm] = useState<BatchOutboundFormState>(() => createEmptyBatchOutboundForm());
  const [batchOutboundLines, setBatchOutboundLines] = useState<BatchOutboundLineState[]>(() => [createEmptyBatchOutboundLine()]);
  const [editingInboundDocumentId, setEditingInboundDocumentId] = useState<number | null>(null);
  const [editingOutboundDocumentId, setEditingOutboundDocumentId] = useState<number | null>(null);
  const [selectedInboundDocumentId, setSelectedInboundDocumentId] = useState<number | null>(null);
  const [selectedOutboundDocumentId, setSelectedOutboundDocumentId] = useState<number | null>(null);
  const [selectedInboundDocumentNoteDraft, setSelectedInboundDocumentNoteDraft] = useState("");
  const [selectedInboundDocumentNoteSaving, setSelectedInboundDocumentNoteSaving] = useState(false);
  const [selectedOutboundDocumentNoteDraft, setSelectedOutboundDocumentNoteDraft] = useState("");
  const [selectedOutboundDocumentNoteSaving, setSelectedOutboundDocumentNoteSaving] = useState(false);
  const [documentActionKey, setDocumentActionKey] = useState<string | null>(null);
  const [inboundDrawerReady, setInboundDrawerReady] = useState(false);
  const [outboundDrawerReady, setOutboundDrawerReady] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [inboundWizardStep, setInboundWizardStep] = useState<InboundWizardStep>(1);
  const [outboundWizardStep, setOutboundWizardStep] = useState<OutboundWizardStep>(1);
  const [batchInboundLineAddCount, setBatchInboundLineAddCount] = useState(1);
  const [batchOutboundLineAddCount, setBatchOutboundLineAddCount] = useState(1);
  const [inboundEditorIntent, setInboundEditorIntent] = useState<InboundLaunchIntent | null>(null);
  const [expandedPalletBreakdowns, setExpandedPalletBreakdowns] = useState<Record<string, boolean>>({});
  const [expandedOutboundPickPlans, setExpandedOutboundPickPlans] = useState<Record<string, boolean>>({});
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [optimisticInboundDocuments, setOptimisticInboundDocuments] = useState<InboundDocument[]>([]);
  const [optimisticOutboundDocuments, setOptimisticOutboundDocuments] = useState<OutboundDocument[]>([]);
  const pendingBatchLineIDRef = useRef<string | null>(null);
  const pendingLaunchContextRef = useRef<ActivityManagementLaunchContext | null | undefined>(undefined);
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const isEmbeddedComposer = Boolean(embeddedComposer);
  const pageDescription = mode === "IN" ? t("inboundDesc") : t("outboundDesc");
  const permissionNotice = canManage ? "" : t("readOnlyModeNotice");
  const liveInboundDocuments = useMemo(
    () => mergeDocumentsById(inboundDocuments, optimisticInboundDocuments),
    [inboundDocuments, optimisticInboundDocuments]
  );
  const liveOutboundDocuments = useMemo(
    () => mergeDocumentsById(outboundDocuments, optimisticOutboundDocuments),
    [optimisticOutboundDocuments, outboundDocuments]
  );
  const skuMastersBySku = useMemo(() => new Map(
    skuMasters.map((skuMaster) => [normalizeSkuLookupValue(skuMaster.sku), skuMaster] as const)
  ), [skuMasters]);
  const editingInboundDocument = useMemo(
    () => (editingInboundDocumentId ? liveInboundDocuments.find((document) => document.id === editingInboundDocumentId) ?? null : null),
    [editingInboundDocumentId, liveInboundDocuments]
  );
  const editingOutboundDocument = useMemo(
    () => (editingOutboundDocumentId ? liveOutboundDocuments.find((document) => document.id === editingOutboundDocumentId) ?? null : null),
    [editingOutboundDocumentId, liveOutboundDocuments]
  );
  const selectedInboundDocument = useMemo(
    () => (selectedInboundDocumentId ? liveInboundDocuments.find((document) => document.id === selectedInboundDocumentId) ?? null : null),
    [liveInboundDocuments, selectedInboundDocumentId]
  );
  const isSelectedInboundNoteDirty = Boolean(selectedInboundDocument)
    && selectedInboundDocumentNoteDraft.trim() !== (selectedInboundDocument?.documentNote ?? "").trim();
  const selectedOutboundDocument = useMemo(
    () => (selectedOutboundDocumentId ? liveOutboundDocuments.find((document) => document.id === selectedOutboundDocumentId) ?? null : null),
    [liveOutboundDocuments, selectedOutboundDocumentId]
  );
  const isSelectedOutboundNoteDirty = Boolean(selectedOutboundDocument)
    && selectedOutboundDocumentNoteDraft.trim() !== (selectedOutboundDocument?.documentNote ?? "").trim();
  const selectedInboundTrackingAction = selectedInboundDocument ? getInboundTrackingAction(selectedInboundDocument, t) : null;
  const selectedOutboundTrackingAction = selectedOutboundDocument ? getOutboundTrackingAction(selectedOutboundDocument, t) : null;
  const selectedInboundDrawerBusy = Boolean(
    selectedInboundDocument && documentActionKey?.startsWith(`inbound-${selectedInboundDocument.id}-`)
  );
  const selectedOutboundDrawerBusy = Boolean(
    selectedOutboundDocument && documentActionKey?.startsWith(`outbound-${selectedOutboundDocument.id}-`)
  );
  const isSelectedInboundCopyBusy = Boolean(
    selectedInboundDocument && documentActionKey === getInboundDocumentActionKey(selectedInboundDocument.id, "copy")
  );
  const isSelectedInboundTrackingBusy = Boolean(
    selectedInboundDocument && documentActionKey === getInboundDocumentActionKey(selectedInboundDocument.id, "tracking")
  );
  const isSelectedInboundCancelBusy = Boolean(
    selectedInboundDocument && documentActionKey === getInboundDocumentActionKey(selectedInboundDocument.id, "cancel")
  );
  const isSelectedInboundArchiveBusy = Boolean(
    selectedInboundDocument && documentActionKey === getInboundDocumentActionKey(selectedInboundDocument.id, "archive")
  );
  const isSelectedOutboundCopyBusy = Boolean(
    selectedOutboundDocument && documentActionKey === getOutboundDocumentActionKey(selectedOutboundDocument.id, "copy")
  );
  const isSelectedOutboundTrackingBusy = Boolean(
    selectedOutboundDocument && documentActionKey === getOutboundDocumentActionKey(selectedOutboundDocument.id, "tracking")
  );
  const isSelectedOutboundPickSheetBusy = Boolean(
    selectedOutboundDocument && documentActionKey === getOutboundDocumentActionKey(selectedOutboundDocument.id, "download-pick-sheet")
  );
  const isSelectedOutboundDeliveryNoteBusy = Boolean(
    selectedOutboundDocument && documentActionKey === getOutboundDocumentActionKey(selectedOutboundDocument.id, "download-delivery-note")
  );
  const isSelectedOutboundCancelBusy = Boolean(
    selectedOutboundDocument && documentActionKey === getOutboundDocumentActionKey(selectedOutboundDocument.id, "cancel")
  );
  const isSelectedOutboundArchiveBusy = Boolean(
    selectedOutboundDocument && documentActionKey === getOutboundDocumentActionKey(selectedOutboundDocument.id, "archive")
  );
  const disableSelectedInboundActions = selectedInboundDrawerBusy || selectedInboundDocumentNoteSaving;
  const disableSelectedOutboundActions = selectedOutboundDrawerBusy || selectedOutboundDocumentNoteSaving;
  const isEditingInboundDraft = normalizeDocumentStatus(editingInboundDocument?.status ?? "") === "DRAFT";
  const isEditingConfirmedInbound = normalizeDocumentStatus(editingInboundDocument?.status ?? "") === "CONFIRMED";
  const isEditingOutboundDraft = editingOutboundDocumentId !== null;
  const skuMastersByID = useMemo(() => new Map(
    skuMasters.map((skuMaster) => [skuMaster.id, skuMaster] as const)
  ), [skuMasters]);
  const outboundPalletSourceMessage = mode === "OUT"
    ? (outboundPalletsLoading ? t("shipmentPalletsLoading") : outboundPalletsLoadError)
    : "";
  const showInboundDrawerLoading = selectedInboundDocumentId !== null && (!inboundDrawerReady || isLoading || !selectedInboundDocument);
  const showOutboundDrawerLoading = selectedOutboundDocumentId !== null && (!outboundDrawerReady || isLoading || !selectedOutboundDocument);

  function showActionError(error: unknown, fallbackMessage: string) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    setErrorMessage(message);
    showError(message);
  }

  function showActionSuccess(message: string) {
    setErrorMessage("");
    showSuccess(message);
  }

  async function runDocumentAction<T>(actionKey: string, action: () => Promise<T>) {
    if (documentActionKey) {
      return null;
    }

    setDocumentActionKey(actionKey);
    try {
      return await action();
    } finally {
      setDocumentActionKey((current) => current === actionKey ? null : current);
    }
  }

  async function handleDownloadPickSheet(document: OutboundDocument) {
    await runDocumentAction(getOutboundDocumentActionKey(document.id, "download-pick-sheet"), async () => {
      try {
        const draftNeedsHydration = normalizeDocumentStatus(document.status) === "DRAFT"
          && document.lines.some((line) => line.pickAllocations.length === 0);
        if (draftNeedsHydration && outboundPalletSourceMessage) {
          throw new Error(outboundPalletSourceMessage);
        }
        const { downloadOutboundPickSheetPdfFromDocument } = await import("../lib/outboundPickSheetPdf");
        const exportDocument = buildPickSheetExportDocument(document, selectableOutboundSources);
        if (
          draftNeedsHydration
          && exportDocument.lines.some((line, index) => (
            document.lines[index]?.pickAllocations.length === 0 && line.pickAllocations.length === 0
          ))
        ) {
          throw new Error(t("shipmentPickSheetRequiresLivePallets"));
        }
        await downloadOutboundPickSheetPdfFromDocument(exportDocument);
      } catch (error) {
        showActionError(error, t("couldNotGeneratePickSheet"));
      }
    });
  }

  async function handleDownloadDeliveryNote(document: OutboundDocument) {
    await runDocumentAction(getOutboundDocumentActionKey(document.id, "download-delivery-note"), async () => {
      try {
        const { downloadOutboundDeliveryNotePdfFromDocument } = await import("../lib/outboundPackingListPdf");
        await downloadOutboundDeliveryNotePdfFromDocument(document);
      } catch (error) {
        showActionError(error, t("couldNotGenerateDeliveryNote"));
      }
    });
  }

  useEffect(() => {
    setIsBatchModalOpen(false);
    setEditingInboundDocumentId(null);
    setEditingOutboundDocumentId(null);
    setBatchOutboundForm(createEmptyBatchOutboundForm());
    setBatchOutboundLines([createEmptyBatchOutboundLine()]);
    setInboundWizardStep(1);
    setOutboundWizardStep(1);
    setBatchInboundLineAddCount(1);
    setBatchOutboundLineAddCount(1);
    setExpandedPalletBreakdowns({});
    setExpandedOutboundPickPlans({});
    setSelectedStatus("all");
    setSelectedInboundDocumentId(null);
    setSelectedOutboundDocumentId(null);
    pendingLaunchContextRef.current = undefined;
  }, [mode]);

  useEffect(() => {
    if (mode !== "OUT") {
      setOutboundPallets([]);
      setOutboundPalletsLoading(false);
      setOutboundPalletsLoadError("");
      return;
    }

    let active = true;
    async function loadOutboundPallets() {
      setOutboundPalletsLoading(true);
      setOutboundPalletsLoadError("");
      try {
        const nextPallets = await api.getPallets(50000);
        if (!active) {
          return;
        }
        setOutboundPallets(nextPallets);
        setOutboundPalletsLoadError("");
      } catch {
        if (!active) {
          return;
        }
        setOutboundPallets([]);
        setOutboundPalletsLoadError(t("shipmentPalletsUnavailable"));
      } finally {
        if (active) {
          setOutboundPalletsLoading(false);
        }
      }
    }

    void loadOutboundPallets();
    return () => {
      active = false;
    };
  }, [mode, t]);

  useEffect(() => {
    if (mode === "OUT" && selectedOutboundDocumentId && !selectedOutboundDocument) {
      setSelectedOutboundDocumentId(null);
    }
  }, [mode, selectedOutboundDocument, selectedOutboundDocumentId]);

  useEffect(() => {
    if (mode === "IN" && selectedInboundDocumentId && !selectedInboundDocument) {
      setSelectedInboundDocumentId(null);
    }
  }, [mode, selectedInboundDocument, selectedInboundDocumentId]);

  useEffect(() => {
    if (selectedInboundDocumentId === null) {
      setInboundDrawerReady(false);
      return;
    }

    setInboundDrawerReady(false);
    const timeoutId = window.setTimeout(() => setInboundDrawerReady(true), 140);
    return () => window.clearTimeout(timeoutId);
  }, [selectedInboundDocumentId]);

  useEffect(() => {
    if (selectedOutboundDocumentId === null) {
      setOutboundDrawerReady(false);
      return;
    }

    setOutboundDrawerReady(false);
    const timeoutId = window.setTimeout(() => setOutboundDrawerReady(true), 140);
    return () => window.clearTimeout(timeoutId);
  }, [selectedOutboundDocumentId]);

  useEffect(() => {
    setSelectedInboundDocumentNoteDraft(selectedInboundDocument?.documentNote ?? "");
  }, [selectedInboundDocument]);

  useEffect(() => {
    setSelectedOutboundDocumentNoteDraft(selectedOutboundDocument?.documentNote ?? "");
  }, [selectedOutboundDocument]);

  useEffect(() => {
    setOptimisticInboundDocuments((current) => current.filter((document) => !inboundDocuments.some((next) => next.id === document.id)));
  }, [inboundDocuments]);

  useEffect(() => {
    setOptimisticOutboundDocuments((current) => current.filter((document) => !outboundDocuments.some((next) => next.id === document.id)));
  }, [outboundDocuments]);

  useEffect(() => {
    if (!batchForm.locationId && locations[0]) {
      setBatchForm((current) => ({ ...current, locationId: String(locations[0].id) }));
    }
  }, [batchForm.locationId, locations]);

  useEffect(() => {
    if (!batchForm.customerId && customers[0]) {
      setBatchForm((current) => ({ ...current, customerId: String(customers[0].id) }));
    }
  }, [batchForm.customerId, customers]);

  useEffect(() => {
    if (isEmbeddedComposer) {
      return;
    }

    if (pendingLaunchContextRef.current === undefined) {
      pendingLaunchContextRef.current = consumePendingActivityManagementLaunchContext(mode) ?? consumeHistoryLaunchContext(mode);
    }

    const pendingLaunchContext = pendingLaunchContextRef.current;
    if (!pendingLaunchContext) {
      return;
    }

    if (pendingLaunchContext.selectedStatus) {
      setSelectedStatus(pendingLaunchContext.selectedStatus);
    }

    if (pendingLaunchContext.documentId && pendingLaunchContext.openEditor && mode === "IN") {
      const targetDocument = liveInboundDocuments.find((document) => document.id === pendingLaunchContext.documentId);
      if (!targetDocument) {
        return;
      }
      openEditInboundDocument(targetDocument, {
        forceHandlingMode: pendingLaunchContext.forceInboundHandlingMode,
        intent: pendingLaunchContext.inboundIntent ?? null
      });
      pendingLaunchContextRef.current = null;
      return;
    }

    if (pendingLaunchContext.documentId) {
      if (mode === "IN") {
        setSelectedInboundDocumentId(pendingLaunchContext.documentId);
      } else {
        setSelectedOutboundDocumentId(pendingLaunchContext.documentId);
      }
      pendingLaunchContextRef.current = null;
      return;
    }

    if (!pendingLaunchContext.openCreate) {
      pendingLaunchContextRef.current = null;
      return;
    }

    if (!canManage) {
      pendingLaunchContextRef.current = null;
      return;
    }

    if (mode === "IN") {
      if (!locations.length || !customers.length) {
        return;
      }
      if (!openCreateModal(pendingLaunchContext.scheduledDate || "")) {
        return;
      }
      pendingLaunchContextRef.current = null;
      return;
    }

    if (outboundPalletsLoading) {
      return;
    }

    openOutboundBatchModal(pendingLaunchContext.scheduledDate || "");
    pendingLaunchContextRef.current = null;
  }, [canManage, customers, isEmbeddedComposer, liveInboundDocuments, locations, mode, outboundPalletsLoading]);

  useEffect(() => {
    if (!pendingBatchLineIDRef.current) {
      return;
    }

    const nextLine = document.getElementById(`batch-line-${pendingBatchLineIDRef.current}`);
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

  const batchLocation = locations.find((location) => location.id === Number(batchForm.locationId));
  const batchCustomer = customers.find((customer) => customer.id === Number(batchForm.customerId));
  const batchSectionOptions = useMemo(() => getLocationSectionOptions(batchLocation), [batchLocation]);
  const inboundContainerWarnings = useMemo(
    () => buildInboundContainerWarnings(batchForm.containerNo, liveInboundDocuments, editingInboundDocumentId),
    [batchForm.containerNo, editingInboundDocumentId, liveInboundDocuments]
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
  const persistedOutboundSourcesByKey = useMemo(
    () => buildPersistedOutboundSourceOptionsFromDocument(editingOutboundDocument, skuMastersByID),
    [editingOutboundDocument, skuMastersByID]
  );
  const availableOutboundSources = useMemo(
    () => buildOutboundSourceOptionsFromPallets(outboundPallets, skuMastersByID),
    [outboundPallets, skuMastersByID]
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
      if (persistedSource && !mergedBySourceKey.has(selectedKey)) {
        mergedBySourceKey.set(selectedKey, persistedSource);
      }
    }

    return [...mergedBySourceKey.values()].sort((left, right) => {
      const customerCompare = left.customerName.localeCompare(right.customerName);
      if (customerCompare !== 0) return customerCompare;
      const locationCompare = left.locationName.localeCompare(right.locationName);
      if (locationCompare !== 0) return locationCompare;
      return left.sku.localeCompare(right.sku);
    });
  }, [availableOutboundSources, batchOutboundLines, persistedOutboundSourcesByKey]);
  useEffect(() => {
    if (!embeddedComposer || !canManage || isBatchModalOpen) {
      return;
    }

    if (mode === "IN") {
      if (!locations.length || !customers.length) {
        return;
      }

      openBatchModal(embeddedComposer.initialDate || "");
      return;
    }

    if (outboundPalletsLoading) {
      return;
    }

    if (outboundPalletSourceMessage) {
      showError(outboundPalletSourceMessage);
      embeddedComposer.onClose();
      return;
    }

    if (!availableOutboundSources.length) {
      showError(t("noAvailableStockRows"));
      embeddedComposer.onClose();
      return;
    }

    openOutboundBatchModal(embeddedComposer.initialDate || "");
  }, [
    availableOutboundSources.length,
    canManage,
    customers.length,
    embeddedComposer,
    isBatchModalOpen,
    locations.length,
    mode,
    outboundPalletSourceMessage,
    outboundPalletsLoading,
    showError,
    t
  ]);
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

  const inboundDocumentRows = useMemo(() => {
    if (mode !== "IN") return [];

    return liveInboundDocuments.filter((document) => {
      const matchesCustomer = selectedCustomerId === "all" || document.customerId === Number(selectedCustomerId);
      const matchesLocation = selectedLocationId === "all" || document.locationId === Number(selectedLocationId);
      const isArchived = Boolean(document.archivedAt);
      const matchesStatus = selectedStatus === "ARCHIVED"
        ? isArchived
        : selectedStatus === "all"
          ? !isArchived
          : !isArchived && normalizeDocumentStatus(document.status) === selectedStatus;
      return matchesCustomer && matchesLocation && matchesStatus;
    }).sort((left, right) => {
      const leftDate = left.expectedArrivalDate ?? left.createdAt ?? "";
      const rightDate = right.expectedArrivalDate ?? right.createdAt ?? "";
      return rightDate.localeCompare(leftDate);
    });
  }, [liveInboundDocuments, mode, selectedCustomerId, selectedLocationId, selectedStatus]);
  const outboundDocumentRows = useMemo(() => {
    if (mode !== "OUT") return [];

    return liveOutboundDocuments.filter((document) => {
      const matchesCustomer = selectedCustomerId === "all" || document.customerId === Number(selectedCustomerId);
      const matchesLocation = selectedLocationId === "all"
        || document.lines.some((line) =>
          line.locationId === Number(selectedLocationId)
          || locations.find((location) => location.id === Number(selectedLocationId))?.name === line.locationName
        );
      const isArchived = Boolean(document.archivedAt);
      const matchesStatus = selectedStatus === "ARCHIVED"
        ? isArchived
        : selectedStatus === "all"
          ? !isArchived
          : !isArchived && normalizeDocumentStatus(document.status) === selectedStatus;
      return matchesCustomer && matchesLocation && matchesStatus;
    }).sort((left, right) => {
      const leftDate = getOutboundDisplayShipDate(left) ?? "";
      const rightDate = getOutboundDisplayShipDate(right) ?? "";
      return rightDate.localeCompare(leftDate);
    });
  }, [liveOutboundDocuments, locations, mode, selectedCustomerId, selectedLocationId, selectedStatus]);
  const hasActiveFilters = selectedCustomerId !== "all" || selectedLocationId !== "all" || selectedStatus !== "all";
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });
  const detailGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: t("emptyStateHint"),
    loadingTitle: t("loadingRecords")
  });
  const overviewStats = useMemo(() => {
    if (mode === "IN") {
      const scheduled = inboundDocumentRows.filter((document) => normalizeDocumentStatus(document.status) === "DRAFT").length;
      const receiving = inboundDocumentRows.filter((document) => normalizeInboundTrackingStatusValue(document.trackingStatus, document.status) === "RECEIVING").length;
      const totalQty = inboundDocumentRows.reduce((sum, document) => sum + document.totalReceivedQty, 0);
      return [
        { label: t("allRows"), value: summaryNumberFormatter.format(inboundDocumentRows.length), meta: t("inbound") },
        { label: t("received"), value: summaryNumberFormatter.format(totalQty), meta: t("units") },
        { label: t("draft"), value: summaryNumberFormatter.format(scheduled), meta: t("trackingStatus") },
        { label: t("receiving"), value: summaryNumberFormatter.format(receiving), meta: t("trackingStatus") }
      ];
    }

    const scheduled = outboundDocumentRows.filter((document) => normalizeDocumentStatus(document.status) === "DRAFT").length;
    const packed = outboundDocumentRows.filter((document) => normalizeOutboundTrackingStatusValue(document.trackingStatus, document.status) === "PACKED").length;
    const totalQty = outboundDocumentRows.reduce((sum, document) => sum + document.totalQty, 0);
    return [
      { label: t("allRows"), value: summaryNumberFormatter.format(outboundDocumentRows.length), meta: t("outbound") },
      { label: t("totalQty"), value: summaryNumberFormatter.format(totalQty), meta: t("units") },
      { label: t("draft"), value: summaryNumberFormatter.format(scheduled), meta: t("trackingStatus") },
      { label: t("packed"), value: summaryNumberFormatter.format(packed), meta: t("trackingStatus") }
    ];
  }, [inboundDocumentRows, mode, outboundDocumentRows, t]);

  const inboundDocumentColumns = useMemo<GridColDef<InboundDocument>[]>(() => [
    { field: "expectedArrivalDate", headerName: t("expectedArrivalDate"), minWidth: 140, renderCell: (params) => formatDate(params.row.expectedArrivalDate) },
    { field: "containerNo", headerName: t("containerNo"), minWidth: 170, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.containerNo || "-"}</span> },
    { field: "customerName", headerName: t("customer"), minWidth: 180, flex: 1, renderCell: (params) => params.row.customerName || "-" },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 180, flex: 1, renderCell: (params) => `${params.row.locationName} / ${summarizeInboundDocumentSections(params.row)}` },
    { field: "totalLines", headerName: t("totalLines"), minWidth: 100, type: "number" },
    { field: "totalExpectedQty", headerName: t("expectedQty"), minWidth: 120, type: "number" },
    { field: "totalReceivedQty", headerName: t("received"), minWidth: 110, type: "number" },
    { field: "trackingStatus", headerName: t("trackingStatus"), minWidth: 140, renderCell: (params) => renderInboundTrackingStatus(params.row.trackingStatus, params.row.status, t) },
    { field: "status", headerName: t("status"), minWidth: 120, renderCell: (params) => renderDocumentStatus(params.row.status, params.row.archivedAt, t) },
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
              onClick: () => onOpenInboundDetail ? onOpenInboundDetail(params.row.id) : setSelectedInboundDocumentId(params.row.id)
            },
            ...(canManage && !params.row.archivedAt && normalizeDocumentStatus(params.row.status) === "DRAFT"
              ? [{
                key: "edit",
                label: t("editDraft"),
                icon: <EditOutlinedIcon fontSize="small" />,
                onClick: () => openEditInboundDocument(params.row)
              }]
              : []),
            ...(canManage
              ? [{
                key: "copy",
                label: normalizeDocumentStatus(params.row.status) === "CONFIRMED" ? t("reEnterReceipt") : t("copyReceipt"),
                icon: <ContentCopyOutlinedIcon fontSize="small" />,
                onClick: () => void handleCopyInboundDocument(params.row)
              }]
              : []),
            ...(canManage && canArchiveInboundDocument(params.row)
              ? [{ key: "archive", label: t("archiveReceipt"), icon: <ArchiveOutlinedIcon fontSize="small" />, onClick: () => void handleArchiveInboundDocument(params.row) }]
              : [])
          ]}
        />
      )
    }
  ], [canManage, t]);

  const inboundDocumentDetailColumns = useMemo<GridColDef<InboundDocument["lines"][number]>[]>(() => [
    { field: "sku", headerName: t("sku"), minWidth: 110, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 260, flex: 1.4, renderCell: (params) => params.row.description || "-" },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 100, renderCell: (params) => normalizeStorageSection(params.row.storageSection) },
    { field: "expectedQty", headerName: t("expectedQty"), minWidth: 110, type: "number", renderCell: (params) => params.row.expectedQty || "-" },
    { field: "receivedQty", headerName: t("received"), minWidth: 110, type: "number", renderCell: (params) => params.row.receivedQty || "-" },
    { field: "pallets", headerName: t("pallets"), minWidth: 90, type: "number", renderCell: (params) => params.row.pallets || "-" },
    { field: "unitLabel", headerName: t("inboundUnit"), minWidth: 100, renderCell: (params) => params.row.unitLabel || "-" },
    { field: "palletsDetailCtns", headerName: t("palletsDetail"), minWidth: 180, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.palletsDetailCtns || "-"}</span> },
    { field: "lineNote", headerName: t("internalNotes"), minWidth: 220, flex: 1.1, renderCell: (params) => params.row.lineNote || "-" }
  ], [t]);

  const outboundDocumentColumns = useMemo<GridColDef<OutboundDocument>[]>(() => [
    { field: "packingListNo", headerName: t("packingListNo"), minWidth: 170, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.packingListNo || "-"}</span> },
    { field: "orderRef", headerName: t("orderRef"), minWidth: 140, renderCell: (params) => <span className="cell--mono">{params.row.orderRef || "-"}</span> },
    { field: "customerName", headerName: t("customer"), minWidth: 180, flex: 1, renderCell: (params) => params.row.customerName || "-" },
    { field: "storages", headerName: t("currentStorage"), minWidth: 180, flex: 1, renderCell: (params) => params.row.storages || "-" },
    { field: "expectedShipDate", headerName: t("expectedShipDate"), minWidth: 140, renderCell: (params) => formatDate(getOutboundExpectedShipDate(params.row)) },
    { field: "actualShipDate", headerName: t("actualShipDate"), minWidth: 140, renderCell: (params) => formatDate(params.row.actualShipDate) },
    { field: "totalLines", headerName: t("totalLines"), minWidth: 100, type: "number" },
    { field: "totalQty", headerName: t("totalQty"), minWidth: 100, type: "number" },
    { field: "totalGrossWeightKgs", headerName: t("grossWeight"), minWidth: 120, type: "number", renderCell: (params) => params.row.totalGrossWeightKgs ? params.row.totalGrossWeightKgs.toFixed(2) : "-" },
    { field: "trackingStatus", headerName: t("trackingStatus"), minWidth: 140, renderCell: (params) => renderOutboundTrackingStatus(params.row.trackingStatus, params.row.status, t) },
    { field: "status", headerName: t("status"), minWidth: 120, renderCell: (params) => renderDocumentStatus(params.row.status, params.row.archivedAt, t) },
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
            { key: "details", label: t("details"), icon: <VisibilityOutlinedIcon fontSize="small" />, onClick: () => setSelectedOutboundDocumentId(params.row.id) },
            ...(canManage && !params.row.archivedAt && normalizeDocumentStatus(params.row.status) === "DRAFT"
              ? [{ key: "edit", label: t("editDraft"), icon: <EditOutlinedIcon fontSize="small" />, onClick: () => openEditOutboundDraft(params.row) }]
              : []),
            ...(canManage
              ? [{
                  key: "copy",
                  label: normalizeDocumentStatus(params.row.status) === "CONFIRMED" ? t("reEnterShipment") : t("copyShipment"),
                  icon: <ContentCopyOutlinedIcon fontSize="small" />,
                  onClick: () => void handleCopyOutboundDocument(params.row)
                }]
              : []),
            ...(canManage && !params.row.archivedAt
              ? [{ key: "archive", label: t("archiveShipment"), icon: <ArchiveOutlinedIcon fontSize="small" />, onClick: () => void handleArchiveOutboundDocument(params.row) }]
              : []),
            { key: "download-pick-sheet", label: t("downloadPickSheet"), icon: <PictureAsPdfOutlinedIcon fontSize="small" />, onClick: () => void handleDownloadPickSheet(params.row) },
            { key: "download-delivery-note", label: t("downloadDeliveryNote"), icon: <PictureAsPdfOutlinedIcon fontSize="small" />, onClick: () => void handleDownloadDeliveryNote(params.row) },
            ...(canManage && !params.row.archivedAt && params.row.status !== "DELETED"
              ? [{ key: "cancel", label: t("cancelShipment"), icon: <DeleteOutlineOutlinedIcon fontSize="small" />, danger: true, onClick: () => void handleCancelOutboundDocument(params.row) }]
              : [])
          ]}
        />
      )
    }
  ], [canManage, t]);

  const outboundDocumentDetailColumns = useMemo<GridColDef<OutboundDocument["lines"][number]>[]>(() => [
    { field: "itemNumber", headerName: t("itemNumber"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.itemNumber || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 110, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 240, flex: 1.4, renderCell: (params) => params.row.description },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 150, flex: 1, renderCell: (params) => `${params.row.locationName} / ${normalizeStorageSection(params.row.storageSection)}` },
    { field: "quantity", headerName: t("outQty"), minWidth: 90, type: "number", renderCell: (params) => params.row.quantity || "-" },
    { field: "pallets", headerName: t("pallets"), minWidth: 90, type: "number", renderCell: (params) => params.row.pallets || "-" },
    { field: "unitLabel", headerName: t("unit"), minWidth: 80, renderCell: (params) => params.row.unitLabel || "-" },
    { field: "cartonSizeMm", headerName: t("cartonSize"), minWidth: 140, renderCell: (params) => <span className="cell--mono">{params.row.cartonSizeMm || "-"}</span> },
    { field: "netWeightKgs", headerName: t("netWeight"), minWidth: 100, type: "number", renderCell: (params) => params.row.netWeightKgs ? params.row.netWeightKgs.toFixed(2) : "-" },
    { field: "grossWeightKgs", headerName: t("grossWeight"), minWidth: 100, type: "number", renderCell: (params) => params.row.grossWeightKgs ? params.row.grossWeightKgs.toFixed(2) : "-" },
    { field: "lineNote", headerName: t("internalNotes"), minWidth: 220, flex: 1.1, renderCell: (params) => params.row.lineNote || "-" }
  ], [t]);
  const outboundPickAllocationColumns = useMemo<GridColDef<OutboundPickAllocationRow>[]>(() => [
    { field: "locationName", headerName: t("currentStorage"), minWidth: 150, flex: 1, renderCell: (params) => `${params.row.locationName} / ${normalizeStorageSection(params.row.storageSection)}` },
    { field: "containerNo", headerName: t("sourceContainer"), minWidth: 170, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.containerNo || "-"}</span> },
    { field: "allocatedQty", headerName: t("pickQty"), minWidth: 100, type: "number" },
    { field: "itemNumber", headerName: t("itemNumber"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.itemNumber || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 110, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 220, flex: 1.2, renderCell: (params) => params.row.description || "-" }
  ], [t]);
  const outboundAllocationPreviewColumns = useMemo<GridColDef<OutboundAllocationPreviewRow>[]>(() => [
    { field: "lineLabel", headerName: t("shipmentLine"), minWidth: 120, renderCell: (params) => params.row.lineLabel },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 150, flex: 1, renderCell: (params) => `${params.row.locationName} / ${normalizeStorageSection(params.row.storageSection)}` },
    { field: "containerNo", headerName: t("sourceContainer"), minWidth: 170, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.containerNo || "-"}</span> },
    { field: "allocatedQty", headerName: t("pickQty"), minWidth: 100, type: "number" },
    { field: "itemNumber", headerName: t("itemNumber"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.itemNumber || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 110, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 220, flex: 1.2, renderCell: (params) => params.row.description || "-" }
  ], [t]);
  const selectedOutboundPickAllocationRows = useMemo<OutboundPickAllocationRow[]>(() => {
    if (!selectedOutboundDocument) {
      return [];
    }

    return selectedOutboundDocument.lines.flatMap((line) =>
      line.pickAllocations.map((allocation) => ({
        id: `${line.id}-${allocation.id}`,
        itemNumber: allocation.itemNumber || line.itemNumber || "",
        sku: line.sku,
        description: line.description,
        locationName: allocation.locationName,
        storageSection: allocation.storageSection,
        containerNo: allocation.containerNo,
        allocatedQty: allocation.allocatedQty
      }))
    );
  }, [selectedOutboundDocument]);
  const selectedOutboundAllocationSummary = useMemo(
    () => summarizeOutboundPickAllocations(selectedOutboundDocument),
    [selectedOutboundDocument]
  );
  const batchOutboundAllocationPreview = useMemo(
    () => buildOutboundAllocationPreview(batchOutboundLines, selectableOutboundSources),
    [batchOutboundLines, selectableOutboundSources]
  );
  const validBatchOutboundLines = useMemo(
    () => batchOutboundLines.filter((line) => line.sourceKey.trim() !== "" && line.quantity > 0),
    [batchOutboundLines]
  );

  function validateOutboundDraft(requireAllocationReady: boolean) {
    if (outboundPalletSourceMessage) {
      return outboundPalletSourceMessage;
    }
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
      if (!allocationSummary || allocationSummary.shortageQty > 0) {
        return t("outboundQtyExceedsStock", {
          sku: selectedOutboundSource.sku,
          available: allocationSummary?.allocatedQty ?? 0
        });
      }
    }

    return "";
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
    if (nextStep === inboundWizardStep) {
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

  function togglePalletBreakdown(lineId: string) {
    setExpandedPalletBreakdowns((current) => ({
      ...current,
      [lineId]: !current[lineId]
    }));
  }

  function toggleOutboundPickPlan(lineId: string) {
    setExpandedOutboundPickPlans((current) => ({
      ...current,
      [lineId]: !current[lineId]
    }));
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
    setOutboundWizardStep(nextStep);
  }

  function openCreateModal(prefilledDate = "") {
    const normalizedPrefilledDate = typeof prefilledDate === "string" ? prefilledDate : "";
    if (!canManage) {
      return false;
    }

    if (mode === "IN") {
      if (!isEmbeddedComposer && onOpenInboundReceiptEditor) {
        onOpenInboundReceiptEditor(null, normalizedPrefilledDate ? { scheduledDate: normalizedPrefilledDate } : undefined);
        return true;
      }
      return openBatchModal(normalizedPrefilledDate);
    }

    if (mode === "OUT") {
      if (!isEmbeddedComposer && onOpenOutboundShipmentEditor) {
        onOpenOutboundShipmentEditor(null, normalizedPrefilledDate ? { scheduledDate: normalizedPrefilledDate } : undefined);
        return true;
      }
      return openOutboundBatchModal(normalizedPrefilledDate);
    }

    return false;
  }

  function openBatchModal(prefilledDate = "") {
    if (!canManage) {
      return false;
    }
    setInboundEditorIntent(null);
    setEditingInboundDocumentId(null);
    setEditingOutboundDocumentId(null);
    setBatchForm({
      ...createEmptyBatchInboundForm(prefilledDate),
      customerId: customers[0] ? String(customers[0].id) : "",
      locationId: locations[0] ? String(locations[0].id) : ""
    });
    setInboundWizardStep(1);
    pendingBatchLineIDRef.current = null;
    setBatchLines([createEmptyBatchInboundLine()]);
    setBatchInboundLineAddCount(1);
    setExpandedPalletBreakdowns({});
    setErrorMessage("");
    setIsBatchModalOpen(true);
    return true;
  }

  function openOutboundBatchModal(prefilledDate = "") {
    if (!canManage) {
      return false;
    }
    setInboundEditorIntent(null);
    if (outboundPalletSourceMessage) {
      setErrorMessage(outboundPalletSourceMessage);
      return false;
    }
    if (availableOutboundSources.length === 0) {
      setErrorMessage(t("noAvailableStockRows"));
      return false;
    }
    setEditingInboundDocumentId(null);
    setEditingOutboundDocumentId(null);
    setBatchOutboundForm(createEmptyBatchOutboundForm(prefilledDate));
    setBatchOutboundLines([createEmptyBatchOutboundLine()]);
    setOutboundWizardStep(1);
    setBatchOutboundLineAddCount(1);
    setExpandedOutboundPickPlans({});
    setErrorMessage("");
    setIsBatchModalOpen(true);
    return true;
  }

  function openEditInboundDocument(
    document: InboundDocument,
    options?: { forceHandlingMode?: InboundHandlingMode; intent?: InboundLaunchIntent | null }
  ) {
    const normalizedStatus = normalizeDocumentStatus(document.status);
    if (!canManage || document.archivedAt || (normalizedStatus !== "DRAFT" && normalizedStatus !== "CONFIRMED")) {
      return;
    }

    if (!isEmbeddedComposer && onOpenInboundReceiptEditor) {
      onOpenInboundReceiptEditor(document.id, {
        ...(options?.forceHandlingMode ? { forceHandlingMode: options.forceHandlingMode } : {}),
        ...(options?.intent ? { inboundIntent: options.intent } : {})
      });
      return;
    }

    setInboundEditorIntent(options?.intent ?? null);
    setEditingInboundDocumentId(document.id);
    setEditingOutboundDocumentId(null);
    setInboundWizardStep(1);
    setBatchForm({
      expectedArrivalDate: document.expectedArrivalDate ? document.expectedArrivalDate.slice(0, 10) : "",
      actualArrivalDate: document.actualArrivalDate ? document.actualArrivalDate.slice(0, 10) : "",
      containerNo: document.containerNo || "",
      containerType: document.containerType || "NORMAL",
      handlingMode: options?.forceHandlingMode ?? document.handlingMode ?? "PALLETIZED",
      customerId: String(document.customerId),
      locationId: String(document.locationId),
      storageSection: normalizeStorageSection(document.storageSection),
      unitLabel: document.unitLabel || "CTN",
      status: normalizedStatus === "CONFIRMED" ? "CONFIRMED" : "DRAFT",
      documentNote: document.documentNote || ""
    });
    pendingBatchLineIDRef.current = null;
    setBatchLines(
      document.lines.length > 0
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
        : [createEmptyBatchInboundLine(normalizeStorageSection(document.storageSection))]
    );
      setExpandedPalletBreakdowns({});
    setErrorMessage("");
    setIsBatchModalOpen(true);
  }

  function openEditOutboundDraft(document: OutboundDocument) {
    if (!canManage || normalizeDocumentStatus(document.status) !== "DRAFT") {
      return;
    }

    if (!isEmbeddedComposer && onOpenOutboundShipmentEditor) {
      onOpenOutboundShipmentEditor(document.id);
      return;
    }

    const draftLines = document.lines.length > 0
      ? document.lines.map((line) => ({
          id: String(line.id),
          sourceKey: buildOutboundSourceKey(document.customerId, line.locationId, line.skuMasterId),
          quantity: line.quantity,
          pallets: line.pallets || 0,
          palletsDetailCtns: "",
          unitLabel: line.unitLabel || "PCS",
          cartonSizeMm: line.cartonSizeMm || "",
          netWeightKgs: line.netWeightKgs || 0,
          grossWeightKgs: line.grossWeightKgs || 0,
          reason: line.lineNote || ""
        }))
      : [createEmptyBatchOutboundLine()];

    setEditingOutboundDocumentId(document.id);
    setEditingInboundDocumentId(null);
    setBatchOutboundForm({
      packingListNo: document.packingListNo || "",
      orderRef: document.orderRef || "",
      expectedShipDate: getOutboundExpectedShipDate(document)?.slice(0, 10) ?? "",
      actualShipDate: document.actualShipDate ? document.actualShipDate.slice(0, 10) : "",
      shipToName: document.shipToName || "",
      shipToAddress: document.shipToAddress || "",
      shipToContact: document.shipToContact || "",
      carrierName: document.carrierName || "",
      status: "DRAFT",
      documentNote: document.documentNote || ""
    });
    setOutboundWizardStep(1);
    setBatchOutboundLines(draftLines);
    setExpandedOutboundPickPlans({});
    setErrorMessage("");
    setIsBatchModalOpen(true);
  }

  function closeBatchModal() {
    setInboundEditorIntent(null);
    setEditingInboundDocumentId(null);
    setEditingOutboundDocumentId(null);
    setBatchForm({
      ...createEmptyBatchInboundForm(),
      customerId: customers[0] ? String(customers[0].id) : "",
      locationId: locations[0] ? String(locations[0].id) : ""
    });
    setInboundWizardStep(1);
    pendingBatchLineIDRef.current = null;
    setBatchLines([createEmptyBatchInboundLine()]);
    setBatchSubmitting(false);
    setExpandedPalletBreakdowns({});
    setExpandedOutboundPickPlans({});
    setOutboundWizardStep(1);
    setBatchInboundLineAddCount(1);
    setBatchOutboundLineAddCount(1);
    setBatchOutboundForm(createEmptyBatchOutboundForm());
    setBatchOutboundLines([createEmptyBatchOutboundLine()]);
    setErrorMessage("");
    setIsBatchModalOpen(false);
    if (embeddedComposer) {
      embeddedComposer.onClose();
    }
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

  function handleOpenInboundPalletTrace(document: InboundDocument) {
    setPendingPalletTraceLaunchContext({ sourceInboundDocumentId: document.id });
    if (onOpenPalletTrace) {
      onOpenPalletTrace(document.id);
    }
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

  function addBatchOutboundLine(count = batchOutboundLineAddCount) {
    const safeCount = getSafeLineAddCount(count);
    setBatchOutboundLines((current) => [
      ...current,
      ...Array.from({ length: safeCount }, () => createEmptyBatchOutboundLine())
    ]);
  }

  function removeBatchOutboundLine(lineID: string) {
    setBatchOutboundLines((current) => current.length === 1 ? current : current.filter((line) => line.id !== lineID));
  }

  function buildOutboundLineDefaults(currentLine: BatchOutboundLineState, nextSource: OutboundSourceOption | undefined) {
    if (!nextSource) {
      return {
        ...currentLine,
        sourceKey: ""
      };
    }

    const previousSource = findOutboundSourceOption(selectableOutboundSources, currentLine.sourceKey);
    const previousSkuMaster = previousSource ? skuMastersBySku.get(normalizeSkuLookupValue(previousSource.sku)) : undefined;
    const nextSkuMaster = skuMastersBySku.get(normalizeSkuLookupValue(nextSource.sku));
    const previousAutoPalletPlan = buildAutoPalletPlan(currentLine.quantity, previousSkuMaster?.defaultUnitsPerPallet ?? 0);
    const nextAutoPalletPlan = buildAutoPalletPlan(currentLine.quantity, nextSkuMaster?.defaultUnitsPerPallet ?? 0);
    const shouldRefreshPallets = currentLine.pallets <= 0 || (previousSkuMaster !== undefined && currentLine.pallets === previousAutoPalletPlan.pallets);
    return {
      ...currentLine,
      sourceKey: nextSource.sourceKey,
      unitLabel: nextSource.unit?.toUpperCase() || currentLine.unitLabel || "PCS",
      pallets: shouldRefreshPallets ? nextAutoPalletPlan.pallets : currentLine.pallets,
      palletsDetailCtns: ""
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
      return {
        ...line,
        quantity: nextQuantity,
        pallets: shouldKeepAutoPallets ? nextAutoPalletPlan.pallets : line.pallets,
        palletsDetailCtns: ""
      };
    }));
  }

  async function submitInboundDocument(status: MutableDocumentStatus) {
    setBatchSubmitting(true);
    setErrorMessage("");

    if (isEditingConfirmedInbound) {
      setErrorMessage(t("confirmedReceiptImmutableNotice"));
      setBatchSubmitting(false);
      return;
    }

    const validationError = validateInboundDraft(batchForm.handlingMode !== "SEALED_TRANSIT");
    if (validationError) {
      setErrorMessage(validationError);
      setBatchSubmitting(false);
      return;
    }

    const validLines = validBatchInboundLines;
    const batchLocationId = Number(batchForm.locationId);
    const batchCustomerId = Number(batchForm.customerId);

    try {
      const editingInboundDocument = editingInboundDocumentId
        ? liveInboundDocuments.find((document) => document.id === editingInboundDocumentId)
        : null;
      const isSealedTransitMode = batchForm.handlingMode === "SEALED_TRANSIT" && !isEditingConfirmedInbound;
      const effectiveStatus: MutableDocumentStatus = isSealedTransitMode ? "DRAFT" : status;
      const payload: InboundDocumentPayload = {
        customerId: batchCustomerId,
        locationId: batchLocationId,
        expectedArrivalDate: batchForm.expectedArrivalDate || undefined,
        actualArrivalDate: batchForm.actualArrivalDate || undefined,
        containerNo: batchForm.containerNo || undefined,
        containerType: batchForm.containerType,
        handlingMode: batchForm.handlingMode,
        storageSection: normalizeStorageSection(validLines[0]?.storageSection || batchForm.storageSection || batchSectionOptions[0]),
        unitLabel: batchForm.unitLabel || "CTN",
        status: effectiveStatus,
        trackingStatus: effectiveStatus === "DRAFT"
          ? normalizeInboundTrackingStatusValue(editingInboundDocument?.trackingStatus, editingInboundDocument?.status)
          : "RECEIVED",
        documentNote: batchForm.documentNote || undefined,
        lines: validLines.map((line) => {
          const normalizedSku = line.sku.trim().toUpperCase();
          const matchingTemplate = items.find((item) => item.sku.trim().toUpperCase() === normalizedSku);
          const matchingSkuMaster = skuMastersBySku.get(normalizedSku);
          const lineDescription = line.description.trim()
            || displayDescription(matchingTemplate ?? { description: "", name: "" })
            || (matchingSkuMaster ? getSKUMasterDescription(matchingSkuMaster) : "");
          const normalizedReceivedQty = line.receivedQty > 0 ? line.receivedQty : line.expectedQty;
          const effectiveUnitsPerPallet = getEffectiveInboundUnitsPerPallet(line, matchingSkuMaster);

          if (!matchingTemplate && !lineDescription) {
            throw new Error(t("batchInboundMissingNewSkuDetails", { sku: normalizedSku || "-" }));
          }

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

      if (editingInboundDocumentId) {
        await api.updateInboundDocument(editingInboundDocumentId, payload);
      } else {
        await api.createInboundDocument(payload);
      }
      closeBatchModal();
      await onRefresh();
      showActionSuccess(t("receiptSavedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    } finally {
      setBatchSubmitting(false);
    }
  }

  function handleBatchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inboundWizardStep < 3) {
      return;
    }
    void submitInboundDocument(batchForm.handlingMode === "SEALED_TRANSIT" && !isEditingConfirmedInbound ? "DRAFT" : "CONFIRMED");
  }

  async function submitOutboundDocument(status: MutableDocumentStatus) {
    setBatchSubmitting(true);
    setErrorMessage("");

    const validationError = validateOutboundDraft(true);
    if (validationError) {
      setErrorMessage(validationError);
      setBatchSubmitting(false);
      return;
    }

    try {
      const editingOutboundDocument = editingOutboundDocumentId
        ? liveOutboundDocuments.find((document) => document.id === editingOutboundDocumentId)
        : null;
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
          ? normalizeOutboundTrackingStatusValue(editingOutboundDocument?.trackingStatus, editingOutboundDocument?.status)
          : "SHIPPED",
        documentNote: batchOutboundForm.documentNote || undefined,
        lines: validBatchOutboundLines.map((line) => {
          const selectedOutboundSource = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
          if (!selectedOutboundSource) {
            throw new Error(t("chooseSkuAndQty"));
          }
          const previewRows = batchOutboundAllocationPreview.rows.filter((row) => row.lineId === line.id);

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
            pickAllocations: buildDraftOutboundLinePickAllocationPayloads(selectedOutboundSource, previewRows)
          };
        })
      };

      if (editingOutboundDocumentId) {
        await api.updateOutboundDocument(editingOutboundDocumentId, payload);
      } else {
        await api.createOutboundDocument(payload);
      }

      closeBatchModal();
      await onRefresh();
      showActionSuccess(t("shipmentSavedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    } finally {
      setBatchSubmitting(false);
    }
  }

  function handleBatchOutboundSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitOutboundDocument("DRAFT");
  }

  async function handleConfirmInboundDocument(document: InboundDocument) {
    if (!canManage) {
      return;
    }

    await runDocumentAction(getInboundDocumentActionKey(document.id, "confirm"), async () => {
      setErrorMessage("");
      try {
        const updatedDocument = await api.confirmInboundDocument(document.id);
        setSelectedInboundDocumentId(updatedDocument.id);
        await onRefresh();
        showActionSuccess(t("receiptConfirmedSuccess"));
      } catch (error) {
        showActionError(error, t("couldNotSaveActivity"));
      }
    });
  }

  async function handleUpdateInboundTrackingStatus(document: InboundDocument, trackingStatus: string) {
    if (!canManage) {
      return;
    }

    await runDocumentAction(getInboundDocumentActionKey(document.id, "tracking"), async () => {
      setErrorMessage("");
      try {
        const updatedDocument = await api.updateInboundDocumentTrackingStatus(document.id, { trackingStatus });
        setSelectedInboundDocumentId(updatedDocument.id);
        await onRefresh();
        showActionSuccess(t("receiptTrackingUpdatedSuccess"));
      } catch (error) {
        showActionError(error, t("couldNotSaveActivity"));
      }
    });
  }

  async function handleCancelInboundDocument(document: InboundDocument) {
    if (!canManage) {
      return;
    }

    const documentLabel = document.containerNo || String(document.id);
    if (!(await confirm({
      title: t("cancelReceipt"),
      message: t("cancelInboundConfirm", { containerNo: documentLabel }),
      confirmLabel: t("cancelReceipt"),
      cancelLabel: t("cancel"),
      confirmColor: "warning",
      severity: "warning"
    }))) {
      return;
    }

    await runDocumentAction(getInboundDocumentActionKey(document.id, "cancel"), async () => {
      setErrorMessage("");
      try {
        await api.cancelInboundDocument(document.id);
        setSelectedInboundDocumentId(null);
        await onRefresh();
        showActionSuccess(t("receiptDeletedSuccess"));
      } catch (error) {
        showActionError(error, t("couldNotSaveActivity"));
      }
    });
  }

  async function handleArchiveInboundDocument(document: InboundDocument) {
    if (!canManage || !canArchiveInboundDocument(document)) {
      return;
    }

    const documentLabel = document.containerNo || String(document.id);
    if (!(await confirm({
      title: t("archiveReceipt"),
      message: t("archiveInboundConfirm", { containerNo: documentLabel }),
      confirmLabel: t("archiveReceipt"),
      cancelLabel: t("cancel"),
      confirmColor: "warning",
      severity: "warning"
    }))) {
      return;
    }

    await runDocumentAction(getInboundDocumentActionKey(document.id, "archive"), async () => {
      setErrorMessage("");
      try {
        await api.archiveInboundDocument(document.id);
        setSelectedInboundDocumentId(null);
        await onRefresh();
        showActionSuccess(t("receiptArchivedSuccess"));
      } catch (error) {
        showActionError(error, t("couldNotArchiveDocument"));
      }
    });
  }

  async function handleCopyInboundDocument(document: InboundDocument) {
    if (!canManage) {
      return;
    }

    await runDocumentAction(getInboundDocumentActionKey(document.id, "copy"), async () => {
      setErrorMessage("");
      try {
        const copiedDocument = await api.copyInboundDocument(document.id);
        setOptimisticInboundDocuments((current) => [copiedDocument, ...current.filter((entry) => entry.id !== copiedDocument.id)]);
        setSelectedStatus("all");
        setSelectedInboundDocumentId(copiedDocument.id);
        if (!isEmbeddedComposer && onOpenInboundReceiptEditor) {
          onOpenInboundReceiptEditor(copiedDocument.id);
        } else {
          openEditInboundDocument(copiedDocument);
        }
        await onRefresh();
        showActionSuccess(t("receiptCopiedSuccess"));
      } catch (error) {
        showActionError(error, t("couldNotCopyDocument"));
      }
    });
  }

  async function handleConfirmOutboundDocument(document: OutboundDocument) {
    if (!canManage) {
      return;
    }

    await runDocumentAction(getOutboundDocumentActionKey(document.id, "confirm"), async () => {
      setErrorMessage("");
      try {
        const updatedDocument = await api.confirmOutboundDocument(document.id);
        setSelectedOutboundDocumentId(updatedDocument.id);
        await onRefresh();
        showActionSuccess(t("shipmentConfirmedSuccess"));
      } catch (error) {
        showActionError(error, t("couldNotSaveActivity"));
      }
    });
  }

  async function handleUpdateOutboundTrackingStatus(document: OutboundDocument, trackingStatus: string) {
    if (!canManage) {
      return;
    }

    await runDocumentAction(getOutboundDocumentActionKey(document.id, "tracking"), async () => {
      setErrorMessage("");
      try {
        const updatedDocument = await api.updateOutboundDocumentTrackingStatus(document.id, { trackingStatus });
        setSelectedOutboundDocumentId(updatedDocument.id);
        await onRefresh();
        showActionSuccess(t("shipmentTrackingUpdatedSuccess"));
      } catch (error) {
        showActionError(error, t("couldNotSaveActivity"));
      }
    });
  }

  async function handleCancelOutboundDocument(document: OutboundDocument) {
    if (!canManage) {
      return;
    }

    if (!(await confirm({
      title: t("cancelShipment"),
      message: t("cancelOutboundConfirm", { packingListNo: document.packingListNo || String(document.id) }),
      confirmLabel: t("cancelShipment"),
      cancelLabel: t("cancel"),
      confirmColor: "warning",
      severity: "warning"
    }))) {
      return;
    }

    await runDocumentAction(getOutboundDocumentActionKey(document.id, "cancel"), async () => {
      setErrorMessage("");
      try {
        await api.cancelOutboundDocument(document.id);
        setSelectedOutboundDocumentId(null);
        await onRefresh();
        showActionSuccess(t("shipmentDeletedSuccess"));
      } catch (error) {
        showActionError(error, t("couldNotSaveActivity"));
      }
    });
  }

  async function handleArchiveOutboundDocument(document: OutboundDocument) {
    if (!canManage) {
      return;
    }

    if (!(await confirm({
      title: t("archiveShipment"),
      message: t("archiveOutboundConfirm", { packingListNo: document.packingListNo || String(document.id) }),
      confirmLabel: t("archiveShipment"),
      cancelLabel: t("cancel"),
      confirmColor: "warning",
      severity: "warning"
    }))) {
      return;
    }

    await runDocumentAction(getOutboundDocumentActionKey(document.id, "archive"), async () => {
      setErrorMessage("");
      try {
        await api.archiveOutboundDocument(document.id);
        setSelectedOutboundDocumentId(null);
        await onRefresh();
        showActionSuccess(t("shipmentArchivedSuccess"));
      } catch (error) {
        showActionError(error, t("couldNotArchiveDocument"));
      }
    });
  }

  async function handleCopyOutboundDocument(document: OutboundDocument) {
    if (!canManage) {
      return;
    }

    await runDocumentAction(getOutboundDocumentActionKey(document.id, "copy"), async () => {
      setErrorMessage("");
      try {
        const copiedDocument = await api.copyOutboundDocument(document.id);
        setOptimisticOutboundDocuments((current) => [copiedDocument, ...current.filter((entry) => entry.id !== copiedDocument.id)]);
        setSelectedStatus("all");
        setSelectedOutboundDocumentId(copiedDocument.id);
        if (!isEmbeddedComposer && onOpenOutboundShipmentEditor) {
          onOpenOutboundShipmentEditor(copiedDocument.id);
        } else {
          openEditOutboundDraft(copiedDocument);
        }
        await onRefresh();
        showActionSuccess(t("shipmentCopiedSuccess"));
      } catch (error) {
        showActionError(error, t("couldNotCopyDocument"));
      }
    });
  }

  async function handleSaveSelectedInboundDocumentNote(document: InboundDocument) {
    if (!canManage) {
      return;
    }

    setErrorMessage("");
    setSelectedInboundDocumentNoteSaving(true);
    try {
      const updatedDocument = await api.updateInboundDocumentNote(document.id, {
        documentNote: selectedInboundDocumentNoteDraft || undefined
      });
      setSelectedInboundDocumentNoteDraft(updatedDocument.documentNote || "");
      await onRefresh();
      showActionSuccess(t("receiptNoteSavedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    } finally {
      setSelectedInboundDocumentNoteSaving(false);
    }
  }

  async function handleSaveSelectedOutboundDocumentNote(document: OutboundDocument) {
    if (!canManage) {
      return;
    }

    setErrorMessage("");
    setSelectedOutboundDocumentNoteSaving(true);
    try {
      const updatedDocument = await api.updateOutboundDocumentNote(document.id, {
        documentNote: selectedOutboundDocumentNoteDraft || undefined
      });
      setSelectedOutboundDocumentNoteDraft(updatedDocument.documentNote || "");
      await onRefresh();
      showActionSuccess(t("shipmentNoteSavedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    } finally {
      setSelectedOutboundDocumentNoteSaving(false);
    }
  }

  function handleExport({
    title,
    columns
  }: {
    title: string;
    columns: ExcelExportColumn[];
  }) {
    if (mode === "IN") {
      downloadExcelWorkbook({
        title,
        sheetName: RECEIPTS_EXPORT_TITLE,
        fileName: title,
        columns,
        rows: inboundDocumentRows.map((document) => ({
          expectedArrivalDate: formatDate(document.expectedArrivalDate),
          containerNo: document.containerNo || "-",
          customerName: document.customerName || "-",
          locationName: `${document.locationName} / ${summarizeInboundDocumentSections(document)}`,
          totalLines: document.totalLines,
          totalExpectedQty: document.totalExpectedQty,
          totalReceivedQty: document.totalReceivedQty,
          trackingStatus: formatInboundTrackingStatusLabel(document.trackingStatus, document.status, t),
          status: document.status
        }))
      });
    } else {
      downloadExcelWorkbook({
        title,
        sheetName: SHIPMENTS_EXPORT_TITLE,
        fileName: title,
        columns,
        rows: outboundDocumentRows.map((document) => ({
          packingListNo: document.packingListNo || "-",
          orderRef: document.orderRef || "-",
          customerName: document.customerName || "-",
          storages: document.storages || "-",
          expectedShipDate: formatDate(getOutboundExpectedShipDate(document)),
          actualShipDate: formatDate(document.actualShipDate),
          shipToName: document.shipToName || "-",
          carrierName: document.carrierName || "-",
          totalLines: document.totalLines,
          totalQty: document.totalQty,
          totalGrossWeightKgs: document.totalGrossWeightKgs ? document.totalGrossWeightKgs.toFixed(2) : "-",
          trackingStatus: formatOutboundTrackingStatusLabel(document.trackingStatus, document.status, t),
          status: document.status
        }))
      });
    }

    setIsExportDialogOpen(false);
  }

  return (
    <>
      {!isEmbeddedComposer ? (
        <main className="workspace-main">
          <section>
            <article className="workbook-panel workbook-panel--full">
          <div className="tab-strip">
            <WorkspacePanelHeader
              title={mode === "IN" ? t("inbound") : t("outbound")}
              actions={(
                <>
                  <Button
                    variant="outlined"
                    startIcon={<FileDownloadOutlinedIcon />}
                    onClick={() => setIsExportDialogOpen(true)}
                    disabled={(mode === "IN" ? inboundDocumentRows.length : outboundDocumentRows.length) === 0}
                  >
                    {t("exportExcel")}
                  </Button>
                  {canManage ? (
                    <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={() => void openCreateModal()}>
                      {mode === "IN" ? t("newInbound") : t("newOutbound")}
                    </Button>
                  ) : null}
                  <Button variant="outlined" disabled>
                    {mode === "IN" ? t("documentsView") : t("packingListsView")}
                  </Button>
                </>
              )}
              notices={[permissionNotice]}
              errorMessage={errorMessage && !isBatchModalOpen ? errorMessage : ""}
            />
            <div className="filter-bar">
              <label>{t("customer")}<select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}><option value="all">{t("allCustomers")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
              <label>{t("currentStorage")}<select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}><option value="all">{t("allStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
              <label>{t("status")}<select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}><option value="all">{t("allStatuses")}</option><option value="DRAFT">{t("draft")}</option><option value="CONFIRMED">{t("confirmed")}</option><option value="DELETED">{t("deleted")}</option><option value="ARCHIVED">{t("archived")}</option></select></label>
            </div>
          </div>
          <div className="workspace-summary-strip">
            {overviewStats.map((stat) => (
              <article className="workspace-summary-card" key={`${stat.label}-${stat.meta}`}>
                <span className="workspace-summary-card__label">{stat.label}</span>
                <strong className="workspace-summary-card__value">{stat.value}</strong>
                <span className="workspace-summary-card__meta">{stat.meta}</span>
              </article>
            ))}
          </div>
          <div className="sheet-table-wrap">
            <Box sx={{ minWidth: 0 }}>
              {mode === "IN" ? (
                <DataGrid
                  rows={inboundDocumentRows}
                  columns={inboundDocumentColumns}
                  loading={isLoading}
                  pagination
                  pageSizeOptions={[10, 20, 50]}
                  disableRowSelectionOnClick
                  initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                  getRowHeight={() => 68}
                  onRowClick={(params) => setSelectedInboundDocumentId(params.row.id)}
                  getRowClassName={(params) => selectedInboundDocumentId === params.row.id ? "document-row--selected" : ""}
                  slots={mainGridSlots}
                  sx={{ border: 0 }}
                />
              ) : (
                <DataGrid
                  rows={outboundDocumentRows}
                  columns={outboundDocumentColumns}
                  loading={isLoading}
                  pagination
                  pageSizeOptions={[10, 20, 50]}
                  disableRowSelectionOnClick
                  initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                  getRowHeight={() => 68}
                  onRowClick={(params) => setSelectedOutboundDocumentId(params.row.id)}
                  getRowClassName={(params) => selectedOutboundDocumentId === params.row.id ? "document-row--selected" : ""}
                  slots={mainGridSlots}
                  sx={{ border: 0 }}
                />
              )}
            </Box>
          </div>
            </article>
          </section>
          <ExportExcelDialog
            open={isExportDialogOpen}
            defaultTitle={mode === "IN" ? RECEIPTS_EXPORT_TITLE : SHIPMENTS_EXPORT_TITLE}
            defaultColumns={mode === "IN" ? [...RECEIPTS_EXPORT_COLUMNS] : [...SHIPMENTS_EXPORT_COLUMNS]}
            onClose={() => setIsExportDialogOpen(false)}
            onExport={handleExport}
          />
        </main>
      ) : null}
      {feedbackToast}

      {mode === "IN" ? (
        <Drawer
          anchor="right"
          open={selectedInboundDocumentId !== null}
          onClose={() => setSelectedInboundDocumentId(null)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{ className: "document-drawer" }}
        >
          {showInboundDrawerLoading ? (
            <WorkspaceDrawerLoadingState />
          ) : selectedInboundDocument ? (
            <div className="document-drawer__content">
              <div className="document-drawer__header">
                <div>
                  <div className="document-drawer__eyebrow">{t("documentsView")}</div>
                  <h3>{selectedInboundDocument.containerNo || t("containerNo")}</h3>
                  <p>
                    {[selectedInboundDocument.customerName || "-", formatDate(selectedInboundDocument.expectedArrivalDate)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <IconButton aria-label={t("close")} onClick={() => setSelectedInboundDocumentId(null)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </div>

              <div className="document-drawer__actions">
                {onOpenInboundDetail ? (
                  <Button variant="outlined" onClick={() => onOpenInboundDetail(selectedInboundDocument.id)} disabled={disableSelectedInboundActions}>
                    {t("inboundDetailOpenPage")}
                  </Button>
                ) : null}
                {onOpenPalletTrace ? (
                  <Button variant="outlined" onClick={() => handleOpenInboundPalletTrace(selectedInboundDocument)} disabled={disableSelectedInboundActions}>
                    {t("openPalletWorkspace")}
                  </Button>
                ) : null}
                {canManage && !selectedInboundDocument.archivedAt && normalizeDocumentStatus(selectedInboundDocument.status) === "DRAFT" ? (
                  <Button variant="outlined" onClick={() => openEditInboundDocument(selectedInboundDocument)} disabled={disableSelectedInboundActions}>
                    {t("editDraft")}
                  </Button>
                ) : null}
                {canManage
                && !selectedInboundDocument.archivedAt
                && normalizeDocumentStatus(selectedInboundDocument.status) === "DRAFT"
                && selectedInboundDocument.handlingMode === "SEALED_TRANSIT" ? (
                  <Button
                    variant="contained"
                    onClick={() => openEditInboundDocument(selectedInboundDocument, {
                      forceHandlingMode: "PALLETIZED",
                      intent: "convert-sealed-transit"
                    })}
                    disabled={disableSelectedInboundActions}
                  >
                    {t("convertToPalletized")}
                  </Button>
                  ) : null}
                {canManage ? (
                  <Button
                    variant="outlined"
                    startIcon={isSelectedInboundCopyBusy ? <InlineLoadingIndicator /> : <ContentCopyOutlinedIcon />}
                    onClick={() => void handleCopyInboundDocument(selectedInboundDocument)}
                    disabled={disableSelectedInboundActions}
                    aria-busy={isSelectedInboundCopyBusy}
                  >
                    {normalizeDocumentStatus(selectedInboundDocument.status) === "CONFIRMED" ? t("reEnterReceipt") : t("copyReceipt")}
                  </Button>
                ) : null}
                {canManage && !selectedInboundDocument.archivedAt && selectedInboundTrackingAction ? (
                  <Button
                    variant={selectedInboundTrackingAction.trackingStatus === "RECEIVED" ? "contained" : "outlined"}
                    startIcon={isSelectedInboundTrackingBusy ? <InlineLoadingIndicator /> : undefined}
                    disabled={disableSelectedInboundActions}
                    aria-busy={isSelectedInboundTrackingBusy}
                    onClick={() => {
                      void handleUpdateInboundTrackingStatus(selectedInboundDocument, selectedInboundTrackingAction.trackingStatus);
                    }}
                  >
                    {selectedInboundTrackingAction.label}
                  </Button>
                ) : null}
                {canManage && !selectedInboundDocument.archivedAt && normalizeDocumentStatus(selectedInboundDocument.status) !== "DELETED" ? (
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={isSelectedInboundCancelBusy ? <InlineLoadingIndicator /> : <DeleteOutlineOutlinedIcon />}
                    onClick={() => void handleCancelInboundDocument(selectedInboundDocument)}
                    disabled={disableSelectedInboundActions}
                    aria-busy={isSelectedInboundCancelBusy}
                  >
                    {t("cancelReceipt")}
                  </Button>
                ) : null}
                {canManage && canArchiveInboundDocument(selectedInboundDocument) ? (
                  <Button
                    variant="outlined"
                    startIcon={isSelectedInboundArchiveBusy ? <InlineLoadingIndicator /> : <ArchiveOutlinedIcon />}
                    onClick={() => void handleArchiveInboundDocument(selectedInboundDocument)}
                    disabled={disableSelectedInboundActions}
                    aria-busy={isSelectedInboundArchiveBusy}
                  >
                    {t("archiveReceipt")}
                  </Button>
                ) : null}
              </div>

              <div className="document-drawer__status-bar">
                <div className="document-drawer__status-main">
                  {renderDocumentStatus(selectedInboundDocument.status, selectedInboundDocument.archivedAt, t)}
                  {renderInboundTrackingStatus(selectedInboundDocument.trackingStatus, selectedInboundDocument.status, t)}
                </div>
                <div className="document-drawer__status-stat">
                  <strong>{selectedInboundDocument.totalLines}</strong>
                  <span>{t("totalLines")}</span>
                </div>
                <div className="document-drawer__status-stat">
                  <strong>{selectedInboundDocument.totalExpectedQty}</strong>
                  <span>{t("expectedQty")}</span>
                </div>
                <div className="document-drawer__status-stat">
                  <strong>{selectedInboundDocument.totalReceivedQty}</strong>
                  <span>{t("received")}</span>
                </div>
              </div>

              <div className="document-drawer__audit-strip">
                <div className="document-drawer__audit-item">
                  <strong>{t("created")}</strong>
                  <span>{formatDateTimeValue(selectedInboundDocument.createdAt, resolvedTimeZone)}</span>
                </div>
                <div className="document-drawer__audit-item">
                  <strong>{t("updated")}</strong>
                  <span>{formatDateTimeValue(selectedInboundDocument.updatedAt, resolvedTimeZone)}</span>
                </div>
                <div className="document-drawer__audit-item">
                  <strong>{t("status")}</strong>
                  <span>{formatDocumentStatusAuditValue(selectedInboundDocument.status, selectedInboundDocument.archivedAt, selectedInboundDocument.deletedAt, resolvedTimeZone, t)}</span>
                </div>
                <div className="document-drawer__audit-item">
                  <strong>{t("trackingStatus")}</strong>
                  <span>{formatInboundTrackingStatusLabel(selectedInboundDocument.trackingStatus, selectedInboundDocument.status, t)}</span>
                </div>
                <div className="document-drawer__audit-item">
                  <strong>{t("confirmedAt")}</strong>
                  <span>{selectedInboundDocument.confirmedAt ? formatDateTimeValue(selectedInboundDocument.confirmedAt, resolvedTimeZone) : "-"}</span>
                </div>
              </div>

              <div className="document-drawer__meta">
                <div className="sheet-note"><strong>{t("expectedArrivalDate")}</strong> {formatDate(selectedInboundDocument.expectedArrivalDate)}</div>
                <div className="sheet-note"><strong>{t("actualArrivalDate")}</strong> {formatDate(selectedInboundDocument.actualArrivalDate)}</div>
                <div className="sheet-note"><strong>{t("customer")}</strong> {selectedInboundDocument.customerName || "-"}</div>
                <div className="sheet-note"><strong>{t("currentStorage")}</strong> {`${selectedInboundDocument.locationName} / ${summarizeInboundDocumentSections(selectedInboundDocument)}`}</div>
                <div className="sheet-note"><strong>{t("inboundUnit")}</strong> {selectedInboundDocument.unitLabel || "-"}</div>
                <div className="sheet-note document-drawer__meta-note">
                  <strong>{t("documentNotes")}</strong>
                  {canManage ? (
                    <>
                      <textarea
                        rows={3}
                        value={selectedInboundDocumentNoteDraft}
                        onChange={(event) => setSelectedInboundDocumentNoteDraft(event.target.value)}
                        placeholder={t("inboundNotePlaceholder")}
                        disabled={selectedInboundDocumentNoteSaving}
                      />
                      <div className="sheet-form__actions" style={{ marginTop: "0.5rem" }}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => void handleSaveSelectedInboundDocumentNote(selectedInboundDocument)}
                          disabled={selectedInboundDocumentNoteSaving || !isSelectedInboundNoteDirty}
                          aria-busy={selectedInboundDocumentNoteSaving}
                        >
                          {selectedInboundDocumentNoteSaving ? <InlineLoadingIndicator className="mr-1" /> : null}
                          {selectedInboundDocumentNoteSaving ? t("saving") : t("saveNote")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    selectedInboundDocument.documentNote || "-"
                  )}
                </div>
              </div>

              <div className="document-drawer__section-title">{t("skuLines")}</div>
              <Box sx={{ minWidth: 0, height: 440 }}>
                <DataGrid
                  rows={selectedInboundDocument.lines}
                  columns={inboundDocumentDetailColumns}
                  pagination
                  pageSizeOptions={[5, 10, 20]}
                  disableRowSelectionOnClick
                  initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
                  getRowHeight={() => 68}
                  slots={detailGridSlots}
                  sx={{ border: 0 }}
                />
              </Box>
            </div>
          ) : null}
        </Drawer>
      ) : null}

      {mode === "OUT" ? (
        <Drawer
          anchor="right"
          open={selectedOutboundDocumentId !== null}
          onClose={() => setSelectedOutboundDocumentId(null)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{ className: "document-drawer" }}
        >
          {showOutboundDrawerLoading ? (
            <WorkspaceDrawerLoadingState />
          ) : selectedOutboundDocument ? (
            <div className="document-drawer__content">
              <div className="document-drawer__header">
                <div>
                  <div className="document-drawer__eyebrow">{t("packingListsView")}</div>
                  <h3>{selectedOutboundDocument.packingListNo || t("packingListNo")}</h3>
                  <p>
                    {[selectedOutboundDocument.customerName || "-", formatDate(getOutboundDisplayShipDate(selectedOutboundDocument))].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <IconButton aria-label={t("close")} onClick={() => setSelectedOutboundDocumentId(null)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </div>

              <div className="document-drawer__actions">
                {canManage && !selectedOutboundDocument.archivedAt && normalizeDocumentStatus(selectedOutboundDocument.status) === "DRAFT" ? (
                  <Button variant="outlined" onClick={() => openEditOutboundDraft(selectedOutboundDocument)} disabled={disableSelectedOutboundActions}>
                    {t("editDraft")}
                  </Button>
                ) : null}
                {canManage ? (
                  <Button
                    variant="outlined"
                    startIcon={isSelectedOutboundCopyBusy ? <InlineLoadingIndicator /> : <ContentCopyOutlinedIcon />}
                    onClick={() => void handleCopyOutboundDocument(selectedOutboundDocument)}
                    disabled={disableSelectedOutboundActions}
                    aria-busy={isSelectedOutboundCopyBusy}
                  >
                    {normalizeDocumentStatus(selectedOutboundDocument.status) === "CONFIRMED" ? t("reEnterShipment") : t("copyShipment")}
                  </Button>
                ) : null}
                {canManage && !selectedOutboundDocument.archivedAt && selectedOutboundTrackingAction ? (
                  <Button
                    variant={selectedOutboundTrackingAction.trackingStatus === "SHIPPED" ? "contained" : "outlined"}
                    startIcon={isSelectedOutboundTrackingBusy ? <InlineLoadingIndicator /> : undefined}
                    disabled={disableSelectedOutboundActions}
                    aria-busy={isSelectedOutboundTrackingBusy}
                    onClick={() => {
                      void handleUpdateOutboundTrackingStatus(selectedOutboundDocument, selectedOutboundTrackingAction.trackingStatus);
                    }}
                  >
                    {selectedOutboundTrackingAction.label}
                  </Button>
                ) : null}
                <Button
                  variant="contained"
                  startIcon={isSelectedOutboundPickSheetBusy ? <InlineLoadingIndicator /> : <PictureAsPdfOutlinedIcon />}
                  onClick={() => void handleDownloadPickSheet(selectedOutboundDocument)}
                  disabled={disableSelectedOutboundActions}
                  aria-busy={isSelectedOutboundPickSheetBusy}
                >
                  {t("downloadPickSheet")}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={isSelectedOutboundDeliveryNoteBusy ? <InlineLoadingIndicator /> : <PictureAsPdfOutlinedIcon />}
                  onClick={() => void handleDownloadDeliveryNote(selectedOutboundDocument)}
                  disabled={disableSelectedOutboundActions}
                  aria-busy={isSelectedOutboundDeliveryNoteBusy}
                >
                  {t("downloadDeliveryNote")}
                </Button>
                {canManage && !selectedOutboundDocument.archivedAt && normalizeDocumentStatus(selectedOutboundDocument.status) !== "DELETED" ? (
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={isSelectedOutboundCancelBusy ? <InlineLoadingIndicator /> : <DeleteOutlineOutlinedIcon />}
                    onClick={() => void handleCancelOutboundDocument(selectedOutboundDocument)}
                    disabled={disableSelectedOutboundActions}
                    aria-busy={isSelectedOutboundCancelBusy}
                  >
                    {t("cancelShipment")}
                  </Button>
                ) : null}
                {canManage && !selectedOutboundDocument.archivedAt ? (
                  <Button
                    variant="outlined"
                    startIcon={isSelectedOutboundArchiveBusy ? <InlineLoadingIndicator /> : <ArchiveOutlinedIcon />}
                    onClick={() => void handleArchiveOutboundDocument(selectedOutboundDocument)}
                    disabled={disableSelectedOutboundActions}
                    aria-busy={isSelectedOutboundArchiveBusy}
                  >
                    {t("archiveShipment")}
                  </Button>
                ) : null}
              </div>

              <div className="document-drawer__status-bar">
                <div className="document-drawer__status-main">
                  {renderDocumentStatus(selectedOutboundDocument.status, selectedOutboundDocument.archivedAt, t)}
                  {renderOutboundTrackingStatus(selectedOutboundDocument.trackingStatus, selectedOutboundDocument.status, t)}
                </div>
                <div className="document-drawer__status-stat">
                  <strong>{selectedOutboundDocument.totalLines}</strong>
                  <span>{t("totalLines")}</span>
                </div>
                <div className="document-drawer__status-stat">
                  <strong>{selectedOutboundDocument.totalQty}</strong>
                  <span>{t("totalQty")}</span>
                </div>
                <div className="document-drawer__status-stat">
                  <strong>{selectedOutboundDocument.totalGrossWeightKgs ? selectedOutboundDocument.totalGrossWeightKgs.toFixed(2) : "-"}</strong>
                  <span>{t("grossWeight")}</span>
                </div>
              </div>

              <div className="document-drawer__summary-grid">
                <div className="document-drawer__summary-card">
                  <strong>{selectedOutboundAllocationSummary.totalContainerCount}</strong>
                  <span>{t("containers")}</span>
                </div>
                <div className="document-drawer__summary-card">
                  <strong>{selectedOutboundAllocationSummary.totalPickRows}</strong>
                  <span>{t("pickRows")}</span>
                </div>
                <div className="document-drawer__summary-card">
                  <strong>{selectedOutboundAllocationSummary.splitLineCount}</strong>
                  <span>{t("splitLines")}</span>
                </div>
              </div>

              <div className="document-drawer__audit-strip">
                <div className="document-drawer__audit-item">
                  <strong>{t("created")}</strong>
                  <span>{formatDateTimeValue(selectedOutboundDocument.createdAt, resolvedTimeZone)}</span>
                </div>
                <div className="document-drawer__audit-item">
                  <strong>{t("updated")}</strong>
                  <span>{formatDateTimeValue(selectedOutboundDocument.updatedAt, resolvedTimeZone)}</span>
                </div>
                <div className="document-drawer__audit-item">
                  <strong>{t("status")}</strong>
                  <span>{formatDocumentStatusAuditValue(selectedOutboundDocument.status, selectedOutboundDocument.archivedAt, selectedOutboundDocument.deletedAt, resolvedTimeZone, t)}</span>
                </div>
                <div className="document-drawer__audit-item">
                  <strong>{t("trackingStatus")}</strong>
                  <span>{formatOutboundTrackingStatusLabel(selectedOutboundDocument.trackingStatus, selectedOutboundDocument.status, t)}</span>
                </div>
                <div className="document-drawer__audit-item">
                  <strong>{t("confirmedAt")}</strong>
                  <span>{selectedOutboundDocument.confirmedAt ? formatDateTimeValue(selectedOutboundDocument.confirmedAt, resolvedTimeZone) : "-"}</span>
                </div>
              </div>

              <div className="document-drawer__meta">
                <div className="sheet-note"><strong>{t("orderRef")}</strong> {selectedOutboundDocument.orderRef || "-"}</div>
                <div className="sheet-note"><strong>{t("customer")}</strong> {selectedOutboundDocument.customerName || "-"}</div>
                <div className="sheet-note"><strong>{t("shipToName")}</strong> {selectedOutboundDocument.shipToName || "-"}</div>
                <div className="sheet-note"><strong>{t("shipToContact")}</strong> {selectedOutboundDocument.shipToContact || "-"}</div>
                <div className="sheet-note document-drawer__meta-note"><strong>{t("shipToAddress")}</strong> {selectedOutboundDocument.shipToAddress || "-"}</div>
                <div className="sheet-note"><strong>{t("currentStorage")}</strong> {selectedOutboundDocument.storages || "-"}</div>
                <div className="sheet-note"><strong>{t("expectedShipDate")}</strong> {formatDate(getOutboundExpectedShipDate(selectedOutboundDocument))}</div>
                <div className="sheet-note"><strong>{t("actualShipDate")}</strong> {formatDate(selectedOutboundDocument.actualShipDate)}</div>
                <div className="sheet-note"><strong>{t("carrier")}</strong> {selectedOutboundDocument.carrierName || "-"}</div>
                <div className="sheet-note document-drawer__meta-note">
                  <strong>{t("documentNotes")}</strong>
                  {canManage ? (
                    <>
                      <textarea
                        rows={3}
                        value={selectedOutboundDocumentNoteDraft}
                        onChange={(event) => setSelectedOutboundDocumentNoteDraft(event.target.value)}
                        placeholder={t("outboundDocumentNotePlaceholder")}
                        disabled={selectedOutboundDocumentNoteSaving}
                      />
                      <div className="sheet-form__actions" style={{ marginTop: "0.5rem" }}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => void handleSaveSelectedOutboundDocumentNote(selectedOutboundDocument)}
                          disabled={selectedOutboundDocumentNoteSaving || !isSelectedOutboundNoteDirty}
                          aria-busy={selectedOutboundDocumentNoteSaving}
                        >
                          {selectedOutboundDocumentNoteSaving ? <InlineLoadingIndicator className="mr-1" /> : null}
                          {selectedOutboundDocumentNoteSaving ? t("saving") : t("saveNote")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    selectedOutboundDocument.documentNote || "-"
                  )}
                </div>
              </div>

              {selectedOutboundPickAllocationRows.length > 0 ? (
                <>
                  <div className="document-drawer__section-title">{t("pickAllocations")}</div>
                  <div className="sheet-note sheet-note--readonly">{t("pickAllocationsNotice")}</div>
                  <Box sx={{ minWidth: 0, height: 320 }}>
                    <DataGrid
                      rows={selectedOutboundPickAllocationRows}
                      columns={outboundPickAllocationColumns}
                      pagination
                      pageSizeOptions={[5, 10, 20]}
                      disableRowSelectionOnClick
                      initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
                      getRowHeight={() => 64}
                      slots={detailGridSlots}
                      sx={{ border: 0 }}
                    />
                  </Box>
                </>
              ) : null}
              <div className="document-drawer__section-title">{t("outboundLines")}</div>
              <Box sx={{ minWidth: 0, height: 400 }}>
                <DataGrid
                  rows={selectedOutboundDocument.lines}
                  columns={outboundDocumentDetailColumns}
                  pagination
                  pageSizeOptions={[5, 10, 20]}
                  disableRowSelectionOnClick
                  initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
                  getRowHeight={() => 68}
                  slots={detailGridSlots}
                  sx={{ border: 0 }}
                />
              </Box>
            </div>
          ) : null}
        </Drawer>
      ) : null}

      {mode === "IN" || mode === "OUT" ? (
        <Dialog
          open={isBatchModalOpen}
          onClose={(_, reason) => {
            if (reason === "backdropClick") return;
            closeBatchModal();
            }}
            fullWidth
            maxWidth={false}
            PaperProps={{ sx: { width: "min(1940px, 99vw)", maxWidth: "none" } }}
          >
          <DialogTitle sx={{ pb: 1 }}>
            {mode === "IN"
              ? (isEditingConfirmedInbound ? t("editInboundReceiptTitle") : isEditingInboundDraft ? t("editInboundDraftTitle") : t("batchInboundTitle"))
              : (isEditingOutboundDraft ? t("editOutboundDraftTitle") : t("batchOutboundTitle"))}
            <IconButton aria-label={t("close")} onClick={closeBatchModal} sx={{ position: "absolute", right: 16, top: 16 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
            {mode === "IN" ? (
              <form onSubmit={handleBatchSubmit}>
                {isEditingConfirmedInbound ? (
                  <InlineAlert severity="warning">{t("confirmedReceiptImmutableNotice")}</InlineAlert>
                ) : null}
                {inboundEditorIntent === "convert-sealed-transit" ? (
                  <InlineAlert severity="info">{t("convertToPalletizedNotice")}</InlineAlert>
                ) : null}
                {batchForm.handlingMode === "SEALED_TRANSIT" ? (
                  <InlineAlert severity="info">{t("sealedTransitDraftNotice")}</InlineAlert>
                ) : null}
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
                    >
                      <span className="shipment-wizard__step-index">{step}</span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {inboundWizardStep === 1 ? (
                  <>
                    <div className="sheet-form sheet-form--compact">
                      <label>{t("expectedArrivalDate")}<input type="date" value={batchForm.expectedArrivalDate} onChange={(event) => setBatchForm((current) => ({ ...current, expectedArrivalDate: event.target.value }))} /></label>
                      <label>{t("actualArrivalDate")}<input type="date" value={batchForm.actualArrivalDate} onChange={(event) => setBatchForm((current) => ({ ...current, actualArrivalDate: event.target.value }))} /></label>
                      <label>{t("containerNo")}<input value={batchForm.containerNo} onChange={(event) => setBatchForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="MRSU8580370" /></label>
                      <label>{t("billingContainerType")}<select value={batchForm.containerType} onChange={(event) => setBatchForm((current) => ({ ...current, containerType: event.target.value as ContainerType }))} disabled={isEditingConfirmedInbound}><option value="NORMAL">{t("billingContainerTypeNormal")}</option><option value="WEST_COAST_TRANSFER">{t("billingContainerTypeWestCoastTransfer")}</option></select></label>
                      <label>{t("handlingMode")}<select value={batchForm.handlingMode} onChange={(event) => setBatchForm((current) => ({ ...current, handlingMode: event.target.value as InboundHandlingMode }))} disabled={isEditingConfirmedInbound}><option value="PALLETIZED">{t("handlingModePalletized")}</option><option value="SEALED_TRANSIT">{t("handlingModeSealedTransit")}</option></select></label>
                      <label>{t("customer")}<select value={batchForm.customerId} onChange={(event) => setBatchForm((current) => ({ ...current, customerId: event.target.value }))}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
                      <label>{t("currentStorage")}<select value={batchForm.locationId} onChange={(event) => setBatchForm((current) => ({ ...current, locationId: event.target.value }))}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                      <label>{t("inboundUnit")}<select value={batchForm.unitLabel} onChange={(event) => setBatchForm((current) => ({ ...current, unitLabel: event.target.value }))}><option value="CTN">CTN</option><option value="PCS">PCS</option><option value="PALLET">PALLET</option></select></label>
                      <label className="sheet-form__wide">{t("documentNotes")}<input value={batchForm.documentNote} onChange={(event) => setBatchForm((current) => ({ ...current, documentNote: event.target.value }))} placeholder={t("inboundNotePlaceholder")} /></label>
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
                        />
                      </label>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AddCircleOutlineOutlinedIcon />}
                        onClick={() => addBatchLine()}
                      >
                        {t("addSkuLine")}
                      </Button>
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
                      <div className="batch-line-card" key={line.id} id={`batch-line-${line.id}`}>
                        <div className="batch-line-card__header">
                          <div className="batch-line-card__title">
                            <strong>{t("sku")} #{index + 1}</strong>
                            <span className={`status-pill ${selectedBatchItem ? "status-pill--ok" : "status-pill--alert"}`}>
                              {selectedBatchItem ? t("useExistingSku") : t("createNewSku")}
                            </span>
                          </div>
                          <button className="button button--danger button--small" type="button" onClick={() => removeBatchLine(line.id)} disabled={batchLines.length === 1}>{t("removeLine")}</button>
                        </div>
                        <div className="batch-line-grid batch-line-grid--inbound">
                          <label>{t("sku")}<input value={line.sku} onChange={(event) => updateBatchLineSku(line.id, event.target.value)} placeholder="ABC123" /></label>
                          <label className="batch-line-grid__description">{t("description")}<input value={selectedBatchItem ? displayDescription(selectedBatchItem) : (line.description || (batchSkuMaster ? getSKUMasterDescription(batchSkuMaster) : "") || displayDescription(batchSkuTemplate ?? { description: "", name: "" }))} onChange={(event) => updateBatchLine(line.id, { description: event.target.value })} placeholder={t("descriptionPlaceholder")} disabled={Boolean(selectedBatchItem)} /></label>
                          <label>{t("expectedQty")}<input type="number" min="0" value={numberInputValue(line.expectedQty)} onChange={(event) => updateBatchLineExpectedQty(line.id, Math.max(0, Number(event.target.value || 0)))} /></label>
                          <label>{t("received")}<input type="number" min="0" value={numberInputValue(line.receivedQty)} onChange={(event) => updateBatchLineReceivedQty(line.id, Math.max(0, Number(event.target.value || 0)))} onBlur={() => autofillBatchLineReceivedQty(line.id)} placeholder={line.expectedQty > 0 ? String(line.expectedQty) : ""} /></label>
                          <label>{t("pallets")}<input type="number" min="0" value={numberInputValue(line.pallets)} onChange={(event) => updateBatchLinePallets(line.id, Math.max(0, Number(event.target.value || 0)))} disabled={batchForm.handlingMode === "SEALED_TRANSIT"} /></label>
                          <label>{t("unitsPerPallet")}<input type="number" min="0" value={numberInputValue(line.unitsPerPallet > 0 ? line.unitsPerPallet : effectiveUnitsPerPallet)} onChange={(event) => updateBatchLineUnitsPerPallet(line.id, Math.max(0, Number(event.target.value || 0)))} disabled={batchForm.handlingMode === "SEALED_TRANSIT"} placeholder={batchSkuMaster?.defaultUnitsPerPallet ? String(batchSkuMaster.defaultUnitsPerPallet) : ""} /></label>
                          <label>{t("storageSection")}<select value={normalizeStorageSection(line.storageSection || batchSectionOptions[0])} onChange={(event) => updateBatchLine(line.id, { storageSection: event.target.value })}>{batchSectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
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
                            resetDisabled={batchForm.handlingMode === "SEALED_TRANSIT" || line.pallets <= 0 || line.receivedQty <= 0}
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
                            mismatchMessage={hasPalletBreakdownMismatch ? t("palletBreakdownTotalMismatch", {
                              assigned: palletBreakdownTotal,
                              received: line.receivedQty
                            }) : null}
                          />
                          <label>{t("reorderLevel")}<input type="number" min="0" value={numberInputValue(displayedReorderLevel)} onChange={(event) => updateBatchLine(line.id, { reorderLevel: Math.max(0, Number(event.target.value || 0)) })} placeholder={suggestedReorderLevel > 0 ? String(suggestedReorderLevel) : ""} disabled={Boolean(selectedBatchItem)} /></label>
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
                            batchForm.expectedArrivalDate || "-"
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
                  {inboundWizardStep === 3 && !isEditingConfirmedInbound && batchForm.handlingMode !== "SEALED_TRANSIT" ? (
                    <button className="button button--ghost" type="button" disabled={batchSubmitting} onClick={() => void submitInboundDocument("DRAFT")}>{batchSubmitting ? t("saving") : isEditingInboundDraft ? t("saveChanges") : t("scheduleReceipt")}</button>
                  ) : null}
                  {inboundWizardStep === 3 && isEditingConfirmedInbound && editingInboundDocument ? (
                    <button
                      className="button button--ghost"
                      type="button"
                      disabled={batchSubmitting}
                      onClick={() => void handleCopyInboundDocument(editingInboundDocument)}
                    >
                      {t("reEnterReceipt")}
                    </button>
                  ) : null}
                  <div className="shipment-wizard__actions">
                    {inboundWizardStep > 1 ? (
                      <button className="button button--ghost" type="button" onClick={() => moveInboundWizardStep((inboundWizardStep - 1) as InboundWizardStep)}>{t("back")}</button>
                    ) : null}
                    {inboundWizardStep < 3 ? (
                      <button className="button button--primary" type="button" onClick={() => moveInboundWizardStep((inboundWizardStep + 1) as InboundWizardStep)}>{t("next")}</button>
                    ) : !isEditingConfirmedInbound ? (
                      <button className="button button--primary" type="submit" disabled={batchSubmitting}>{batchSubmitting ? t("saving") : isEditingConfirmedInbound ? t("saveChanges") : batchForm.handlingMode === "SEALED_TRANSIT" ? t("saveSealedTransit") : inboundEditorIntent === "convert-sealed-transit" ? t("convertToPalletized") : t("confirmReceipt")}</button>
                    ) : null}
                  </div>
                  <button className="button button--ghost" type="button" onClick={closeBatchModal}>{t("cancel")}</button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleBatchOutboundSubmit}>
                {outboundPalletSourceMessage ? (
                  <InlineAlert severity={outboundPalletsLoadError ? "warning" : "info"}>{outboundPalletSourceMessage}</InlineAlert>
                ) : null}
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
                      disabled={Boolean(outboundPalletSourceMessage)}
                    >
                      <span className="shipment-wizard__step-index">{step}</span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {outboundWizardStep === 1 ? (
                <div className="sheet-form sheet-form--compact">
                  <label>{t("packingListNo")}<input value={batchOutboundForm.packingListNo} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, packingListNo: event.target.value }))} placeholder="TGCUS180265" /></label>
                  <label>{t("orderRef")}<input value={batchOutboundForm.orderRef} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, orderRef: event.target.value }))} placeholder="J73504" /></label>
                  <label>{t("expectedShipDate")}<input type="date" value={batchOutboundForm.expectedShipDate} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, expectedShipDate: event.target.value }))} /></label>
                  <label>{t("actualShipDate")}<input type="date" value={batchOutboundForm.actualShipDate} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, actualShipDate: event.target.value }))} /></label>
                  <label>{t("shipToName")}<input value={batchOutboundForm.shipToName} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, shipToName: event.target.value }))} placeholder="Receiver name" /></label>
                  <label>{t("shipToContact")}<input value={batchOutboundForm.shipToContact} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, shipToContact: event.target.value }))} placeholder="+1 555 010 0200" /></label>
                  <label>{t("carrier")}<input value={batchOutboundForm.carrierName} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, carrierName: event.target.value }))} placeholder="FedEx" /></label>
                  <label className="sheet-form__wide">{t("shipToAddress")}<input value={batchOutboundForm.shipToAddress} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, shipToAddress: event.target.value }))} placeholder="Delivery address" /></label>
                  <label className="sheet-form__wide">{t("documentNotes")}<input value={batchOutboundForm.documentNote} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, documentNote: event.target.value }))} placeholder={t("outboundDocumentNotePlaceholder")} /></label>
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
                            disabled={Boolean(outboundPalletSourceMessage)}
                          />
                        </label>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<AddCircleOutlineOutlinedIcon />}
                          onClick={() => addBatchOutboundLine()}
                          disabled={Boolean(outboundPalletSourceMessage)}
                        >
                          {t("addOutboundLine")}
                        </Button>
                      </div>
                    ) : (
                      <span className="batch-line-card__hint">{t("pickPlanStepHint")}</span>
                    )}
                  </div>

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
                      <div className="batch-line-card" key={line.id}>
                        <div className="batch-line-card__header">
                          <div className="batch-line-card__title">
                            <strong>{t("shipmentSource")} #{index + 1}</strong>
                            <span className={`status-pill ${selectedOutboundSource ? "status-pill--ok" : "status-pill--alert"}`}>
                              {selectedOutboundSource ? t("selected") : t("selectShipmentSource")}
                            </span>
                          </div>
                          <button className="button button--danger button--small" type="button" onClick={() => removeBatchOutboundLine(line.id)} disabled={batchOutboundLines.length === 1}>{t("removeLine")}</button>
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
                              disabled={Boolean(outboundPalletSourceMessage)}
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
                          <label>{t("outQty")}<input type="number" min="0" value={numberInputValue(line.quantity)} onChange={(event) => updateBatchOutboundLineQuantity(line.id, Math.max(0, Number(event.target.value || 0)))} disabled={Boolean(outboundPalletSourceMessage)} /></label>
                          <label>{t("pallets")}<input type="number" min="0" value={numberInputValue(line.pallets)} onChange={(event) => updateBatchOutboundLine(line.id, { pallets: Math.max(0, Number(event.target.value || 0)) })} disabled={Boolean(outboundPalletSourceMessage)} /></label>
                          <label>{t("unit")}<input value={line.unitLabel} onChange={(event) => updateBatchOutboundLine(line.id, { unitLabel: event.target.value })} placeholder="PCS" /></label>
                          <label>{t("cartonSize")}<input value={line.cartonSizeMm} onChange={(event) => updateBatchOutboundLine(line.id, { cartonSizeMm: event.target.value })} placeholder="455*330*325" /></label>
                          <label>{t("netWeight")}<input type="number" min="0" step="0.01" value={numberInputValue(line.netWeightKgs)} onChange={(event) => updateBatchOutboundLine(line.id, { netWeightKgs: Math.max(0, Number(event.target.value || 0)) })} /></label>
                          <label>{t("grossWeight")}<input type="number" min="0" step="0.01" value={numberInputValue(line.grossWeightKgs)} onChange={(event) => updateBatchOutboundLine(line.id, { grossWeightKgs: Math.max(0, Number(event.target.value || 0)) })} /></label>
                          <label className="batch-line-grid__detail">{t("internalNotes")}<input value={line.reason} onChange={(event) => updateBatchOutboundLine(line.id, { reason: event.target.value })} placeholder={t("outboundInternalNotePlaceholder")} /></label>
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
                          <OutboundPickPlanPanel
                          title={t("containerPickPlan")}
                          helperText={t("pickPlanAutoModeHint")}
                          autoPickLabel={t("autoPick")}
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
                            canExpand={outboundAllocationRows.length > 0}
                            expanded={isOutboundPickPlanExpanded}
                            onToggle={() => toggleOutboundPickPlan(line.id)}
                            emptyHint={t("pickAllocationPreviewEmpty")}
                            rows={outboundAllocationRows.map((row) => ({
                              id: row.id,
                              containerNo: row.containerNo,
                              locationLabel: `${row.locationName} / ${normalizeStorageSection(row.storageSection)}`,
                              allocatedQty: row.allocatedQty,
                              itemNumber: row.itemNumber || undefined
                            }))}
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
                    </div>
                  </div>

                  {batchOutboundAllocationPreview.shortageLineCount > 0 ? (
                    <InlineAlert severity="warning">
                      {t("pickAllocationPreviewShortage")}
                    </InlineAlert>
                  ) : null}

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
                        slots={detailGridSlots}
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

                <div className="sheet-form__actions shipment-action-bar" style={{ marginTop: "1rem" }}>
                  <div className="shipment-action-bar__secondary">
                    <button className="button button--ghost" type="button" onClick={closeBatchModal}>{t("cancel")}</button>
                    {outboundWizardStep < 3 ? (
                      <button className="button button--ghost" type="button" disabled={batchSubmitting || Boolean(outboundPalletSourceMessage) || (!isEditingOutboundDraft && availableOutboundSources.length === 0)} onClick={() => void submitOutboundDocument("DRAFT")}>{batchSubmitting ? t("saving") : isEditingOutboundDraft ? t("saveChanges") : t("scheduleShipment")}</button>
                    ) : null}
                  </div>
                  <div className="shipment-action-bar__primary shipment-wizard__actions">
                    {outboundWizardStep > 1 ? (
                      <button className="button button--ghost" type="button" onClick={() => moveOutboundWizardStep((outboundWizardStep - 1) as OutboundWizardStep)} disabled={Boolean(outboundPalletSourceMessage)}>{t("back")}</button>
                    ) : null}
                    {outboundWizardStep < 3 ? (
                      <button className="button button--primary" type="button" onClick={() => moveOutboundWizardStep((outboundWizardStep + 1) as OutboundWizardStep)} disabled={Boolean(outboundPalletSourceMessage)}>{t("next")}</button>
                    ) : (
                      <button className="button button--primary" type="submit" disabled={batchSubmitting || Boolean(outboundPalletSourceMessage) || (!isEditingOutboundDraft && availableOutboundSources.length === 0)}>{batchSubmitting ? t("saving") : t("scheduleShipment")}</button>
                    )}
                  </div>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
      {confirmationDialog}
    </>
  );
}

function displayDescription(item: Pick<Item, "description" | "name">) { return item.description || item.name; }
function formatDate(value: string | null) { return formatDateValue(value, dateFormatter); }
function numberInputValue(value: number) { return value === 0 ? "" : String(value); }
function normalizeContainerNo(value: string) { return value.trim().toUpperCase(); }

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
    && normalizeDocumentStatus(document.status) !== "DELETED"
    && normalizeContainerNo(document.containerNo)
  );

  const exact = candidateDocuments
    .filter((document) => normalizeContainerNo(document.containerNo) === normalizedValue)
    .map((document) => ({
      documentId: document.id,
      containerNo: normalizeContainerNo(document.containerNo),
      customerName: document.customerName || "-",
      dateLabel: formatDate(document.expectedArrivalDate || document.createdAt || ""),
      similarity: 1
    }));

  if (exact.length > 0) {
    return { exact, similar: [] as InboundContainerWarningMatch[] };
  }

  if (normalizedValue.length < 6) {
    return { exact, similar: [] as InboundContainerWarningMatch[] };
  }

  const uniqueSimilarMatches = new Map<string, InboundContainerWarningMatch>();
  for (const document of candidateDocuments) {
    const normalizedCandidate = normalizeContainerNo(document.containerNo);
    const similarity = getContainerSimilarity(normalizedValue, normalizedCandidate);
    if (similarity <= 0.9 || normalizedCandidate === normalizedValue) {
      continue;
    }

    const existingMatch = uniqueSimilarMatches.get(normalizedCandidate);
    const nextMatch = {
      documentId: document.id,
      containerNo: normalizedCandidate,
      customerName: document.customerName || "-",
      dateLabel: formatDate(document.expectedArrivalDate || document.createdAt || ""),
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

function mergeDocumentsById<T extends { id: number }>(primary: T[], extra: T[]) {
  const merged = new Map<number, T>();
  for (const document of primary) {
    merged.set(document.id, document);
  }
  for (const document of extra) {
    if (!document) {
      continue;
    }
    if (!merged.has(document.id)) {
      merged.set(document.id, document);
    }
  }
  return Array.from(merged.values());
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

function summarizeInboundDocumentSections(document: InboundDocument) {
  const sections = Array.from(new Set(
    document.lines
      .map((line) => (line.storageSection || "").trim().toUpperCase())
      .filter(Boolean)
  ));

  if (sections.length === 0) {
    return normalizeStorageSection(document.storageSection);
  }

  return sections.join(", ");
}

function canArchiveInboundDocument(document: Pick<InboundDocument, "status" | "archivedAt">) {
  return !document.archivedAt && normalizeDocumentStatus(document.status) !== "CONFIRMED";
}

function renderDocumentStatus(status: string, archivedAt: string | null | undefined, t: (key: string) => string) {
  if (archivedAt) {
    return <Chip label={t("archived")} color="default" size="small" variant="outlined" />;
  }

  const normalizedStatus = normalizeDocumentStatus(status);

  if (normalizedStatus === "DELETED") {
    return <Chip label={t("deleted")} color="error" size="small" />;
  }

  if (normalizedStatus === "CONFIRMED") {
    return <Chip label={t("confirmed")} color="success" size="small" />;
  }

  return <Chip label={t("draft")} color="default" size="small" />;
}

function formatDocumentStatusAuditValue(
  status: string,
  archivedAt: string | null | undefined,
  deletedAt: string | null | undefined,
  resolvedTimeZone: string,
  t: (key: string) => string
) {
  if (archivedAt) {
    return `${t("archived")} | ${formatDateTimeValue(archivedAt, resolvedTimeZone)}`;
  }
  if (deletedAt) {
    return `${status} | ${formatDateTimeValue(deletedAt, resolvedTimeZone)}`;
  }
  return status;
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

function formatInboundTrackingStatusLabel(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  switch (normalizeInboundTrackingStatusValue(trackingStatus, documentStatus)) {
    case "ARRIVED":
      return t("arrived");
    case "RECEIVING":
      return t("receiving");
    case "RECEIVED":
      return t("receivedTracking");
    default:
      return t("scheduled");
  }
}

function formatOutboundTrackingStatusLabel(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  switch (normalizeOutboundTrackingStatusValue(trackingStatus, documentStatus)) {
    case "PICKING":
      return t("picking");
    case "PACKED":
      return t("packed");
    case "SHIPPED":
      return t("shipped");
    default:
      return t("scheduled");
  }
}

function renderInboundTrackingStatus(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  const normalizedTrackingStatus = normalizeInboundTrackingStatusValue(trackingStatus, documentStatus);
  if (normalizedTrackingStatus === "RECEIVED") {
    return <Chip label={t("receivedTracking")} color="success" size="small" variant="outlined" />;
  }
  if (normalizedTrackingStatus === "RECEIVING") {
    return <Chip label={t("receiving")} color="primary" size="small" variant="outlined" />;
  }
  if (normalizedTrackingStatus === "ARRIVED") {
    return <Chip label={t("arrived")} color="info" size="small" variant="outlined" />;
  }
  return <Chip label={t("scheduled")} color="default" size="small" variant="outlined" />;
}

function renderOutboundTrackingStatus(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  const normalizedTrackingStatus = normalizeOutboundTrackingStatusValue(trackingStatus, documentStatus);
  if (normalizedTrackingStatus === "SHIPPED") {
    return <Chip label={t("shipped")} color="success" size="small" variant="outlined" />;
  }
  if (normalizedTrackingStatus === "PACKED") {
    return <Chip label={t("packed")} color="primary" size="small" variant="outlined" />;
  }
  if (normalizedTrackingStatus === "PICKING") {
    return <Chip label={t("picking")} color="info" size="small" variant="outlined" />;
  }
  return <Chip label={t("scheduled")} color="default" size="small" variant="outlined" />;
}

function getInboundTrackingAction(document: InboundDocument, t: (key: string) => string) {
  if (normalizeDocumentStatus(document.status) !== "DRAFT") {
    return null;
  }

  switch (normalizeInboundTrackingStatusValue(document.trackingStatus, document.status)) {
    case "SCHEDULED":
      return { trackingStatus: "ARRIVED", label: t("markArrived") };
    case "ARRIVED":
      return { trackingStatus: "RECEIVING", label: t("startReceiving") };
    case "RECEIVING":
      return { trackingStatus: "RECEIVED", label: t("completeReceipt") };
    default:
      return null;
  }
}

function getOutboundTrackingAction(document: OutboundDocument, t: (key: string) => string) {
  if (normalizeDocumentStatus(document.status) !== "DRAFT") {
    return null;
  }

  switch (normalizeOutboundTrackingStatusValue(document.trackingStatus, document.status)) {
    case "SCHEDULED":
      return { trackingStatus: "PICKING", label: t("startPicking") };
    case "PICKING":
      return { trackingStatus: "PACKED", label: t("markPacked") };
    case "PACKED":
      return { trackingStatus: "SHIPPED", label: t("shipOut") };
    default:
      return null;
  }
}

function normalizeDocumentStatus(status: string) {
  return status.trim().toUpperCase();
}

function getInboundDocumentActionKey(documentId: number, action: string) {
  return `inbound-${documentId}-${action}`;
}

function getOutboundDocumentActionKey(documentId: number, action: string) {
  return `outbound-${documentId}-${action}`;
}

export function buildPickSheetExportDocument(document: OutboundDocument, sourceOptions: OutboundSourceOption[]): OutboundDocument {
  if (normalizeDocumentStatus(document.status) !== "DRAFT") {
    return document;
  }
  if (document.lines.every((line) => line.pickAllocations.length > 0)) {
    return document;
  }

  const preview = buildOutboundAllocationPreview(
    document.lines.map((line) => ({
      id: String(line.id),
      sourceKey: buildOutboundSourceKey(document.customerId, line.locationId, line.skuMasterId),
      quantity: line.quantity,
      pallets: Math.max(0, line.pallets || 0),
      palletsDetailCtns: line.palletsDetailCtns || "",
      unitLabel: line.unitLabel || "",
      cartonSizeMm: line.cartonSizeMm || "",
      netWeightKgs: line.netWeightKgs || 0,
      grossWeightKgs: line.grossWeightKgs || 0,
      reason: line.lineNote || ""
    })),
    sourceOptions
  );

  const previewRowsByLineId = new Map<string, OutboundAllocationPreviewRow[]>();
  for (const row of preview.rows) {
    const existing = previewRowsByLineId.get(row.lineId);
    if (existing) {
      existing.push(row);
      continue;
    }
    previewRowsByLineId.set(row.lineId, [row]);
  }

  return {
    ...document,
    lines: document.lines.map((line) => {
      if (line.pickAllocations.length > 0) {
        return line;
      }
      return {
        ...line,
        pickAllocations: buildPreviewPickAllocations(line, previewRowsByLineId.get(String(line.id)) ?? [])
      };
    })
  };
}

function buildPreviewPickAllocations(
  line: OutboundDocument["lines"][number],
  previewRows: OutboundAllocationPreviewRow[]
): OutboundPickAllocation[] {
  if (previewRows.length === 0) {
    return [];
  }

  const palletShares = splitPreviewPalletsByQuantities(
    Math.max(0, line.pallets || 0),
    previewRows.map((row) => row.allocatedQty)
  );

  return previewRows.map((row, index) => ({
    id: -(index + 1),
    lineId: line.id,
    itemNumber: row.itemNumber || line.itemNumber || "",
    locationId: line.locationId,
    locationName: row.locationName || line.locationName,
    storageSection: row.storageSection || line.storageSection,
    containerNo: row.containerNo || "",
    allocatedQty: row.allocatedQty,
    pallets: palletShares[index] ?? 0,
    createdAt: line.createdAt
  }));
}

function buildDraftOutboundLinePickAllocationPayloads(
  source: Pick<OutboundSourceOption, "locationId" | "locationName" | "itemNumber">,
  previewRows: OutboundAllocationPreviewRow[]
) {
  if (previewRows.length === 0) {
    return undefined;
  }

  return previewRows.map((row) => ({
    itemNumber: row.itemNumber || source.itemNumber || undefined,
    locationId: source.locationId,
    locationName: row.locationName || source.locationName || undefined,
    storageSection: row.storageSection || undefined,
    containerNo: row.containerNo || undefined,
    allocatedQty: row.allocatedQty
  }));
}

function splitPreviewPalletsByQuantities(total: number, quantities: number[]) {
  const result = new Array<number>(quantities.length).fill(0);
  if (quantities.length === 0 || total <= 0) {
    return result;
  }

  const totalQty = quantities.reduce((sum, quantity) => quantity > 0 ? sum + quantity : sum, 0);
  if (totalQty <= 0) {
    return result;
  }

  let remainingTotal = total;
  let remainingQty = totalQty;
  quantities.forEach((quantity, index) => {
    if (quantity <= 0) {
      return;
    }
    if (index === quantities.length - 1 || remainingQty <= 0) {
      result[index] = remainingTotal;
      return;
    }

    const share = Math.min(Math.round((total * quantity / totalQty) * 10000) / 10000, remainingTotal);
    result[index] = share;
    remainingTotal = Math.round((remainingTotal - share) * 10000) / 10000;
    remainingQty -= quantity;
  });

  return result;
}

function buildOutboundAllocationPreview(lines: BatchOutboundLineState[], sourceOptions: OutboundSourceOption[]): OutboundAllocationPreviewResult {
  const reservedBySourceId = new Map<string, number>();
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

    let remainingQty = line.quantity;
    for (const candidate of selectedSource.candidates) {
      const sourceId = candidate.id;
      const effectiveAvailable = candidate.availableQty - (reservedBySourceId.get(sourceId) ?? 0);
      if (effectiveAvailable <= 0) {
        continue;
      }

      const allocatedQty = Math.min(effectiveAvailable, remainingQty);
      if (allocatedQty <= 0) {
        continue;
      }

      rows.push({
        id: `${line.id}-${candidate.id}`,
        lineId: line.id,
        lineLabel: summary.lineLabel,
        itemNumber: selectedSource.itemNumber || summary.itemNumber,
        sku: selectedSource.sku,
        description: selectedSource.description,
        locationName: candidate.locationName,
        storageSection: normalizeStorageSection(candidate.storageSection),
        containerNo: candidate.containerNo || "",
        allocatedQty
      });
      reservedBySourceId.set(sourceId, (reservedBySourceId.get(sourceId) ?? 0) + allocatedQty);
      summary.allocatedQty += allocatedQty;
      remainingQty -= allocatedQty;

      if (remainingQty === 0) {
        break;
      }
    }

    const containers = new Set(
      rows
        .filter((row) => row.lineLabel === summary.lineLabel)
        .map((row) => row.containerNo || `${row.locationName}/${row.storageSection}`)
    );
    summary.containerCount = containers.size;
    summary.shortageQty = Math.max(0, remainingQty);
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

function summarizeOutboundPickAllocations(document: OutboundDocument | null) {
  if (!document) {
    return {
      totalContainerCount: 0,
      totalPickRows: 0,
      splitLineCount: 0
    };
  }

  const allAllocations = document.lines.flatMap((line) => line.pickAllocations);
  return {
    totalContainerCount: new Set(allAllocations.map((allocation) => allocation.containerNo || `${allocation.locationName}/${normalizeStorageSection(allocation.storageSection)}`)).size,
    totalPickRows: allAllocations.length,
    splitLineCount: document.lines.filter((line) => {
      const containers = new Set(line.pickAllocations.map((allocation) => allocation.containerNo || `${allocation.locationName}/${normalizeStorageSection(allocation.storageSection)}`));
      return containers.size > 1;
    }).length
  };
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
    const sourceKey = buildOutboundSourceKey(document.customerId, line.locationId, line.skuMasterId);
    if (persistedSources.has(sourceKey)) {
      continue;
    }

    const uniqueContainers = new Set(
      line.pickAllocations.map((allocation) => allocation.containerNo || `${allocation.locationName}/${normalizeStorageSection(allocation.storageSection)}`)
    );
    const skuMasterUnit = skuMastersByID.get(line.skuMasterId)?.unit || "PCS";
    persistedSources.set(sourceKey, {
      sourceKey,
      customerId: document.customerId,
      customerName: document.customerName,
      locationId: line.locationId,
      locationName: line.locationName,
      skuMasterId: line.skuMasterId,
      sku: line.sku,
      itemNumber: line.itemNumber || "",
      description: line.description || "",
      unit: (line.unitLabel || skuMasterUnit).toUpperCase(),
      availableQty: 0,
      palletCount: Math.max(0, line.pallets || 0),
      storageSections: [normalizeStorageSection(line.storageSection || DEFAULT_STORAGE_SECTION)],
      containerCount: uniqueContainers.size,
      containerSummary: formatContainerDistributionSummaryValue(line.pickAllocations.map((allocation) => ({
        containerNo: allocation.containerNo,
        availableQty: allocation.allocatedQty,
        locationName: allocation.locationName,
        storageSection: allocation.storageSection
      }))),
      candidates: []
    });
  }

  return persistedSources;
}

export function buildOutboundSourceOptionsFromPallets(pallets: PalletTrace[], skuMastersByID: Map<number, SKUMaster>): OutboundSourceOption[] {
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

function consumeHistoryLaunchContext(mode: ActivityMode): ActivityManagementLaunchContext | null {
  const state = window.history.state;
  if (!state || typeof state !== "object") {
    return null;
  }

  const page = typeof (state as { page?: unknown }).page === "string"
    ? String((state as { page?: unknown }).page)
    : "";
  const documentId = typeof (state as { documentId?: unknown }).documentId === "number"
    ? Number((state as { documentId?: unknown }).documentId)
    : 0;
  const expectedPage = mode === "IN" ? "inbound-management" : "outbound-management";

  if (page !== expectedPage || documentId <= 0) {
    return null;
  }

  const nextState = { ...(state as Record<string, unknown>) };
  delete nextState.documentId;
  window.history.replaceState(nextState, "", window.location.pathname);

  return { documentId };
}

function formatContainerDistributionSummary(containers: Map<string, number>) {
  if (containers.size === 0) {
    return "";
  }

  return [...containers.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([containerNo, quantity]) => `${containerNo}:${quantity}`)
    .join(" · ");
}
