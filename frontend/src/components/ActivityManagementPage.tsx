import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Checkbox, Chip, Dialog, DialogContent, DialogTitle, Drawer, IconButton } from "@mui/material";
import {
  DataGrid,
  GRID_CHECKBOX_SELECTION_COL_DEF,
  gridPaginatedVisibleSortedGridRowIdsSelector,
  type GridColDef,
  type GridRowId,
  type GridRowSelectionModel,
  useGridApiContext,
  useGridSelector
} from "@mui/x-data-grid";

import { api } from "../lib/api";
import { waitForNextPaint } from "../lib/asyncUi";
import { consumePendingActivityManagementLaunchContext, type ActivityManagementLaunchContext, type InboundLaunchIntent } from "../lib/activityManagementLaunchContext";
import { RowActionsMenu } from "./RowActionsMenu";
import { formatContainerDistributionSummary as formatContainerDistributionSummaryValue } from "../lib/containerBalances";
import { formatDateTimeValue, formatDateValue } from "../lib/dates";
import {
  formatInboundTrackingStatusLabel,
  formatOutboundTrackingStatusLabel,
  getInboundTrackingAction,
  getOutboundTrackingAction,
  isOperationalInboundDocument,
  normalizeDocumentStatus,
  normalizeInboundTrackingStatus as normalizeInboundTrackingStatusValue,
  normalizeOutboundTrackingStatus as normalizeOutboundTrackingStatusValue
} from "../lib/documentTracking";
import { downloadExcelWorkbook, type ExcelExportColumn } from "../lib/excelExport";
import type { InboundReceiptEditorLaunchContext } from "../lib/inboundReceiptEditorLaunchContext";
import type { OutboundShipmentEditorLaunchContext } from "../lib/outboundShipmentEditorLaunchContext";
import { useI18n } from "../lib/i18n";
import { getOutboundDisplayShipDate, getOutboundExpectedShipDate } from "../lib/outboundDates";
import { buildOutboundPickAllocationPayloads } from "../lib/outboundAllocationPayload";
import { useSettings } from "../lib/settings";
import {
  DEFAULT_STORAGE_SECTION,
  getLocationSectionOptions,
  normalizeStorageSection,
  type ContainerType,
  type Customer,
  type InboundDocument,
  type InboundDocumentPayload,
  type Item,
  type Location,
  type Movement,
  type OutboundDocument,
  type OutboundSourceReference,
  type OutboundPickAllocation,
  type OutboundDocumentPayload,
  type SKUMaster,
  type UserRole
} from "../lib/types";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { ExportLoadingScreen } from "./ExportLoadingScreen";
import { InlineAlert, useConfirmDialog, useFeedbackToast } from "./Feedback";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";
import { InboundBulkImportDialog } from "./InboundBulkImportDialog";
import { OutboundBulkImportDialog } from "./OutboundBulkImportDialog";
import { OutboundPickPlanPanel } from "./OutboundPickPlanPanel";
import { SearchSubmitField } from "./SearchSubmitField";
import { buildWorkspaceGridSlots, WorkspaceDrawerLoadingState, WorkspacePanelHeader } from "./WorkspacePanelChrome";

type ActivityMode = "IN" | "OUT";
type MutableDocumentStatus = "DRAFT" | "CONFIRMED";
type InboundHandlingMode = "PALLETIZED" | "SEALED_TRANSIT";
type InboundWizardStep = 1 | 2 | 3;
type OutboundWizardStep = 1 | 2 | 3;
type InboundReceiptVariance = "MATCHED" | "SHORT" | "OVER";

const MAX_BULK_INBOUND_STATUS_DOCUMENTS = 100;
const MAX_BULK_OUTBOUND_ACTION_DOCUMENTS = 100;

export function toggleCurrentPageRowSelection(
  currentSelection: GridRowSelectionModel,
  currentPageIDs: GridRowId[],
  maximum: number
) {
  const nextIDs = new Set(currentSelection.type === "include" ? currentSelection.ids : []);
  const allCurrentPageSelected = currentPageIDs.length > 0 && currentPageIDs.every((id) => nextIDs.has(id));
  if (allCurrentPageSelected) {
    currentPageIDs.forEach((id) => nextIDs.delete(id));
    return { selection: { type: "include", ids: nextIDs } as GridRowSelectionModel, exceeded: false };
  }
  currentPageIDs.forEach((id) => nextIDs.add(id));
  if (nextIDs.size > maximum) {
    return { selection: currentSelection, exceeded: true };
  }
  return { selection: { type: "include", ids: nextIDs } as GridRowSelectionModel, exceeded: false };
}

function CurrentPageSelectionHeader({
  selection,
  maximum,
  ariaLabel,
  onChange,
  onLimitExceeded
}: {
  selection: GridRowSelectionModel;
  maximum: number;
  ariaLabel: string;
  onChange: (selection: GridRowSelectionModel) => void;
  onLimitExceeded: () => void;
}) {
  const apiRef = useGridApiContext();
  const paginatedIDs = useGridSelector(apiRef, gridPaginatedVisibleSortedGridRowIdsSelector);
  const currentPageIDs = paginatedIDs.filter((id) => apiRef.current.isRowSelectable(id));
  const selectedCount = currentPageIDs.filter((id) => selection.ids.has(id)).length;

  return (
    <Checkbox
      size="small"
      checked={currentPageIDs.length > 0 && selectedCount === currentPageIDs.length}
      indeterminate={selectedCount > 0 && selectedCount < currentPageIDs.length}
      inputProps={{ "aria-label": ariaLabel }}
      onChange={() => {
        const result = toggleCurrentPageRowSelection(selection, currentPageIDs, maximum);
        if (result.exceeded) {
          onLimitExceeded();
          return;
        }
        onChange(result.selection);
      }}
    />
  );
}

type ActivityManagementPageProps = {
  mode: ActivityMode;
  items: Item[];
  skuMasters: SKUMaster[];
  outboundSourceReferences?: OutboundSourceReference[];
  locations: Location[];
  customers: Customer[];
  movements: Movement[];
  inboundDocuments: InboundDocument[];
  outboundDocuments: OutboundDocument[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onOpenInboundDetail?: (documentId: number) => void;
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
  status: MutableDocumentStatus;
  documentNote: string;
};

type BatchInboundLineState = {
  id: string;
  itemNumber: string;
  sku: string;
  description: string;
  storageSection: string;
  reorderLevel: number;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  unitsPerPallet: number;
  lineNote: string;
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
  sourceSearch: string;
  plannedQuantity: number;
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
  inventoryPalletsUsed: number;
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
  positionLabel: string;
  allocatedQty: number;
  pallets: number;
  startingQty: number;
  startingPallets: number;
  remainingPallets: number;
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
  candidates: OutboundInventoryCandidate[];
};

type OutboundInventoryCandidate = {
  id: string;
  inventoryItemId: number;
  positionLabel: string;
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
  availablePallets: number;
  onHandQty: number;
  onHandPallets: number;
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
const ACTIVITY_DOCUMENT_FILTER_LIMIT = 50000;
const RECEIPTS_EXPORT_TITLE = "Receipts";
const SHIPMENTS_EXPORT_TITLE = "Shipments";
const RECEIPTS_EXPORT_COLUMNS = [
  { key: "actualArrivalDate", label: "Actual Arrival Date" },
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
  { key: "packingListNo", label: "Picking Order No." },
  { key: "orderRef", label: "Order Ref." },
  { key: "customerName", label: "Customer" },
  { key: "storages", label: "Warehouse" },
  { key: "expectedShipDate", label: "Expected Ship Date" },
  { key: "actualShipDate", label: "Actual Ship Date" },
  { key: "shipToName", label: "Ship-to Name" },
  { key: "carrierName", label: "Carrier" },
  { key: "totalLines", label: "Total Lines" },
  { key: "totalPlannedQty", label: "Planned Ship Qty" },
  { key: "totalActualQty", label: "Actual Ship Qty" },
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
    status: "CONFIRMED",
    documentNote: ""
  };
}

function createEmptyBatchInboundLine(defaultStorageSection = DEFAULT_STORAGE_SECTION): BatchInboundLineState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemNumber: "",
    sku: "",
    description: "",
    storageSection: defaultStorageSection,
    reorderLevel: 0,
    expectedQty: 0,
    receivedQty: 0,
    pallets: 0,
    unitsPerPallet: 0,
    lineNote: ""
  };
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
    sourceSearch: "",
    plannedQuantity: 0,
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

function getActivityOutboundFulfillmentQuantity(line: Pick<BatchOutboundLineState, "plannedQuantity" | "quantity">) {
  return Math.max(0, line.quantity);
}

function hasActivityOutboundRecordedQuantity(line: Pick<BatchOutboundLineState, "plannedQuantity" | "quantity">) {
  return line.plannedQuantity > 0 || line.quantity > 0;
}

function isActivityOutboundLineEmpty(line: BatchOutboundLineState) {
  return (
    line.sourceKey.trim() === ""
    && line.sourceSearch.trim() === ""
    && line.plannedQuantity <= 0
    && line.quantity <= 0
    && line.pallets <= 0
    && line.reason.trim() === ""
    && line.cartonSizeMm.trim() === ""
    && line.netWeightKgs <= 0
    && line.grossWeightKgs <= 0
  );
}

function normalizeSkuLookupValue(value: string) {
  return value.trim().toUpperCase();
}

function normalizeItemCodeLookupValue(value: string) {
  return value.trim().toUpperCase();
}

function getSKUMasterDescription(skuMaster: Pick<SKUMaster, "description" | "name">) {
  return skuMaster.description || skuMaster.name;
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
  outboundSourceReferences = [],
  locations,
  customers,
  movements,
  inboundDocuments,
  outboundDocuments,
  currentUserRole,
  isLoading,
  onRefresh,
  onOpenInboundDetail,
  onOpenInboundReceiptEditor,
  onOpenOutboundShipmentEditor,
  embeddedComposer
}: ActivityManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
	const outboundPalletsLoading = false;
	const outboundPalletsLoadError = "";
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [submittedSearchTerm, setSubmittedSearchTerm] = useState("");
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
  const [expandedOutboundPickPlans, setExpandedOutboundPickPlans] = useState<Record<string, boolean>>({});
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isBulkInboundImportOpen, setIsBulkInboundImportOpen] = useState(false);
  const [isBulkOutboundImportOpen, setIsBulkOutboundImportOpen] = useState(false);
  const [bulkInboundStatus, setBulkInboundStatus] = useState<"" | "CONFIRMED" | "DELETED">("");
  const [inboundRowSelectionModel, setInboundRowSelectionModel] = useState<GridRowSelectionModel>({ type: "include", ids: new Set() });
  const [outboundRowSelectionModel, setOutboundRowSelectionModel] = useState<GridRowSelectionModel>({ type: "include", ids: new Set() });
  const [isBulkUpdatingInboundStatus, setIsBulkUpdatingInboundStatus] = useState(false);
  const [isBulkConfirmingOutbound, setIsBulkConfirmingOutbound] = useState(false);
  const [isBulkDeletingOutbound, setIsBulkDeletingOutbound] = useState(false);
  const [optimisticInboundDocuments, setOptimisticInboundDocuments] = useState<InboundDocument[]>([]);
  const [optimisticOutboundDocuments, setOptimisticOutboundDocuments] = useState<OutboundDocument[]>([]);
  const [filteredInboundDocuments, setFilteredInboundDocuments] = useState<InboundDocument[]>([]);
  const [filteredOutboundDocuments, setFilteredOutboundDocuments] = useState<OutboundDocument[]>([]);
  const [isDocumentFilterLoading, setIsDocumentFilterLoading] = useState(false);
  const [documentFilterErrorMessage, setDocumentFilterErrorMessage] = useState("");
  const pendingBatchLineIDRef = useRef<string | null>(null);
  const pendingLaunchContextRef = useRef<ActivityManagementLaunchContext | null | undefined>(undefined);
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const isEmbeddedComposer = Boolean(embeddedComposer);
  const pageDescription = mode === "IN" ? t("inboundDesc") : t("outboundDesc");
  const permissionNotice = canManage ? "" : t("readOnlyModeNotice");
  const normalizedDocumentSearch = submittedSearchTerm.trim().toLowerCase();
  const hasActiveFilters = normalizedDocumentSearch.length > 0 || selectedCustomerId !== "all" || selectedLocationId !== "all" || selectedStatus !== "all";
  const documentFilterQuery = useMemo(() => {
    const query = {
      archiveScope: selectedStatus === "ARCHIVED" ? "archived" as const : "active" as const,
      customerId: selectedCustomerId === "all" ? undefined : Number(selectedCustomerId),
      locationId: selectedLocationId === "all" ? undefined : Number(selectedLocationId),
      status: selectedStatus === "all" || selectedStatus === "ARCHIVED" ? undefined : selectedStatus
    };

    if (normalizedDocumentSearch.length > 0) {
      return { ...query, search: normalizedDocumentSearch };
    }

    return query;
  }, [normalizedDocumentSearch, selectedCustomerId, selectedLocationId, selectedStatus]);

  useEffect(() => {
    setInboundRowSelectionModel({ type: "include", ids: new Set() });
    setOutboundRowSelectionModel({ type: "include", ids: new Set() });
    setBulkInboundStatus("");
    if (mode === "IN") {
      setSelectedStatus((current) => current === "ARCHIVED" ? "all" : current);
    }
  }, [mode]);
  const inboundDocumentSource = useMemo(
    () => hasActiveFilters
      ? mergeDocumentsById(filteredInboundDocuments, inboundDocuments)
      : mergeDocumentsById(inboundDocuments, filteredInboundDocuments),
    [filteredInboundDocuments, hasActiveFilters, inboundDocuments]
  );
  const outboundDocumentSource = useMemo(
    () => hasActiveFilters
      ? mergeDocumentsById(filteredOutboundDocuments, outboundDocuments)
      : mergeDocumentsById(outboundDocuments, filteredOutboundDocuments),
    [filteredOutboundDocuments, hasActiveFilters, outboundDocuments]
  );
  const liveInboundDocuments = useMemo(
    () => mergeDocumentsById(inboundDocumentSource, optimisticInboundDocuments),
    [inboundDocumentSource, optimisticInboundDocuments]
  );
  const liveOutboundDocuments = useMemo(
    () => mergeDocumentsById(outboundDocumentSource, optimisticOutboundDocuments),
    [optimisticOutboundDocuments, outboundDocumentSource]
  );
  const selectedInboundStatusDocuments = useMemo(() => {
    const selectedIDs = new Set(Array.from(inboundRowSelectionModel.ids, (id) => Number(id)));
    return liveInboundDocuments.filter((document) => selectedIDs.has(document.id));
  }, [inboundRowSelectionModel, liveInboundDocuments]);
  const selectedOutboundDocuments = useMemo(() => {
    const selectedIDs = new Set(Array.from(outboundRowSelectionModel.ids, (id) => Number(id)));
    return liveOutboundDocuments.filter((document) => selectedIDs.has(document.id));
  }, [liveOutboundDocuments, outboundRowSelectionModel]);
  const canBulkConfirmSelectedOutbound = selectedOutboundDocuments.length > 0 && selectedOutboundDocuments.every(
    (document) => !document.archivedAt && normalizeDocumentStatus(document.status) === "DRAFT"
  );
  const skuMastersBySku = useMemo(() => new Map(
    skuMasters.map((skuMaster) => [normalizeSkuLookupValue(skuMaster.sku), skuMaster] as const)
  ), [skuMasters]);
  const skuMastersByItemNumber = useMemo(() => new Map(
    skuMasters
      .filter((skuMaster) => skuMaster.itemNumber.trim())
      .map((skuMaster) => [normalizeItemCodeLookupValue(skuMaster.itemNumber), skuMaster] as const)
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
  const selectedOutboundTrackingAction = selectedOutboundDocument ? getOutboundTrackingAction(selectedOutboundDocument, t, { draftOrShippedOnly: true }) : null;
  const selectedInboundDrawerBusy = Boolean(
    selectedInboundDocument && documentActionKey?.startsWith(`inbound-${selectedInboundDocument.id}-`)
  );
  const selectedOutboundDrawerBusy = Boolean(
    selectedOutboundDocument && documentActionKey?.startsWith(`outbound-${selectedOutboundDocument.id}-`)
  );
  const isSelectedInboundCopyBusy = Boolean(
    selectedInboundDocument && documentActionKey === getInboundDocumentActionKey(selectedInboundDocument.id, "copy")
  );
  const isSelectedInboundReceivingCountSheetBusy = Boolean(
    selectedInboundDocument && documentActionKey === getInboundDocumentActionKey(selectedInboundDocument.id, "download-receiving-count-sheet")
  );
  const isSelectedInboundCancelBusy = Boolean(
    selectedInboundDocument && documentActionKey === getInboundDocumentActionKey(selectedInboundDocument.id, "cancel")
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
  const isDocumentExporting = documentActionKey?.includes("-download-") ?? false;
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

  function handleInboundRowSelectionChange(nextSelection: GridRowSelectionModel) {
    if (nextSelection.type !== "include" || nextSelection.ids.size > MAX_BULK_INBOUND_STATUS_DOCUMENTS) {
      showActionError(new Error(t("bulkInboundSelectionLimit", { count: MAX_BULK_INBOUND_STATUS_DOCUMENTS })), t("bulkInboundStatusFailed"));
      return;
    }
    setInboundRowSelectionModel(nextSelection);
  }

  function handleOutboundRowSelectionChange(nextSelection: GridRowSelectionModel) {
    if (nextSelection.type !== "include" || nextSelection.ids.size > MAX_BULK_OUTBOUND_ACTION_DOCUMENTS) {
      showActionError(new Error(t("bulkOutboundSelectionLimit", { count: MAX_BULK_OUTBOUND_ACTION_DOCUMENTS })), t("bulkOutboundConfirmFailed"));
      return;
    }
    setOutboundRowSelectionModel(nextSelection);
  }

  async function runDocumentAction<T>(actionKey: string, action: () => Promise<T>) {
    if (documentActionKey) {
      return null;
    }

    setDocumentActionKey(actionKey);
    try {
      if (actionKey.includes("-download-")) {
        await waitForNextPaint();
      }
      return await action();
    } finally {
      setDocumentActionKey((current) => current === actionKey ? null : current);
    }
  }

  async function handleDownloadPickSheet(document: OutboundDocument) {
    await runDocumentAction(getOutboundDocumentActionKey(document.id, "download-pick-sheet"), async () => {
      try {
        const draftNeedsHydration = normalizeDocumentStatus(document.status) === "DRAFT"
          && document.lines.some((line) => outboundDocumentLineRequiresPickAllocation(line) && line.pickAllocations.length === 0);
        if (draftNeedsHydration && outboundPalletSourceMessage) {
          throw new Error(outboundPalletSourceMessage);
        }
        const { downloadOutboundPickSheetPdfFromDocument } = await import("../lib/outboundPickSheetPdf");
        const exportDocument = buildPickSheetExportDocument(document, selectableOutboundSources);
        if (
          draftNeedsHydration
            && exportDocument.lines.some((line, index) => (
            outboundDocumentLineRequiresPickAllocation(line)
              && document.lines[index]?.pickAllocations.length === 0
              && line.pickAllocations.length === 0
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

  async function handleDownloadReceivingCountSheet(document: InboundDocument) {
    await runDocumentAction(getInboundDocumentActionKey(document.id, "download-receiving-count-sheet"), async () => {
      try {
        const { downloadInboundReceivingCountSheetPdfFromDocument } = await import("../lib/inboundReceivingCountSheetPdf");
        await downloadInboundReceivingCountSheetPdfFromDocument(document);
      } catch (error) {
        showActionError(error, t("couldNotGenerateReceivingCountSheet"));
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
    setExpandedOutboundPickPlans({});
    setSelectedStatus("all");
    setSearchTerm("");
    setSubmittedSearchTerm("");
    setSelectedInboundDocumentId(null);
    setSelectedOutboundDocumentId(null);
    pendingLaunchContextRef.current = undefined;
  }, [mode]);

  useEffect(() => {
    if (!hasActiveFilters) {
      setFilteredInboundDocuments([]);
      setFilteredOutboundDocuments([]);
      setDocumentFilterErrorMessage("");
      setIsDocumentFilterLoading(false);
      return;
    }

    let active = true;
    setDocumentFilterErrorMessage("");
    setIsDocumentFilterLoading(true);
    setFilteredInboundDocuments([]);
    setFilteredOutboundDocuments([]);

    async function loadFilteredDocuments() {
      try {
        if (mode === "IN") {
          const documents = await api.getInboundDocuments(ACTIVITY_DOCUMENT_FILTER_LIMIT, documentFilterQuery);
          if (!active) return;
          setFilteredInboundDocuments(documents);
        } else {
          const documents = await api.getOutboundDocuments(ACTIVITY_DOCUMENT_FILTER_LIMIT, documentFilterQuery);
          if (!active) return;
          setFilteredOutboundDocuments(documents);
        }
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : t("couldNotLoadReport");
        setDocumentFilterErrorMessage(message);
        showError(message);
      } finally {
        if (active) {
          setIsDocumentFilterLoading(false);
        }
      }
    }

    void loadFilteredDocuments();
    return () => {
      active = false;
    };
  }, [documentFilterQuery, hasActiveFilters, mode, showError, t]);

  function submitDocumentSearch() {
    const nextSearchTerm = searchTerm.trim();
    setSearchTerm(nextSearchTerm);
    setSubmittedSearchTerm(nextSearchTerm);
  }

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
      totalReceivedQty: validBatchInboundLines.reduce((sum, line) => sum + line.receivedQty, 0),
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
	() => buildOutboundSourceOptionsFromItems(items, skuMastersByID),
	[items, skuMastersByID]
  );
  const planOnlyOutboundSources = useMemo(
    () => buildPlanOnlyOutboundSourceOptionsFromReferences(outboundSourceReferences, locations, batchOutboundLines),
    [batchOutboundLines, locations, outboundSourceReferences]
  );
  const selectableOutboundSources = useMemo(() => {
    const selectedKeys = new Set(
      batchOutboundLines
        .map((line) => line.sourceKey.trim())
        .filter(Boolean)
    );

    const mergedBySourceKey = new Map(
      planOnlyOutboundSources.map((source) => [source.sourceKey, source] as const)
    );
    for (const source of availableOutboundSources) {
      mergedBySourceKey.set(source.sourceKey, source);
    }
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
  }, [availableOutboundSources, batchOutboundLines, persistedOutboundSourcesByKey, planOnlyOutboundSources]);
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

    if (onOpenOutboundShipmentEditor) {
      const scheduledDate = embeddedComposer.initialDate || "";
      embeddedComposer.onClose();
      onOpenOutboundShipmentEditor(null, scheduledDate ? { scheduledDate } : undefined);
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

    if (availableOutboundSources.length === 0 && outboundSourceReferences.length === 0) {
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
    onOpenOutboundShipmentEditor,
    outboundPalletSourceMessage,
    outboundPalletsLoading,
    outboundSourceReferences.length,
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
      if (normalizeDocumentStatus(document.status) === "DELETED") return false;
      if (!isOperationalInboundDocument(document)) return false;
      const matchesSearch = inboundDocumentMatchesSearch(document, normalizedDocumentSearch);
      const matchesCustomer = selectedCustomerId === "all" || document.customerId === Number(selectedCustomerId);
      const matchesLocation = selectedLocationId === "all" || document.locationId === Number(selectedLocationId);
      const isArchived = Boolean(document.archivedAt);
      const matchesStatus = selectedStatus === "ARCHIVED"
        ? isArchived
        : selectedStatus === "all"
          ? !isArchived
          : !isArchived && normalizeDocumentStatus(document.status) === selectedStatus;
      return matchesSearch && matchesCustomer && matchesLocation && matchesStatus;
    }).sort((left, right) => {
      const leftDate = left.actualArrivalDate || left.expectedArrivalDate || left.createdAt || "";
      const rightDate = right.actualArrivalDate || right.expectedArrivalDate || right.createdAt || "";
      return rightDate.localeCompare(leftDate);
    });
  }, [liveInboundDocuments, mode, normalizedDocumentSearch, selectedCustomerId, selectedLocationId, selectedStatus]);
  const outboundDocumentRows = useMemo(() => {
    if (mode !== "OUT") return [];

    return liveOutboundDocuments.filter((document) => {
      const matchesSearch = outboundDocumentMatchesSearch(document, normalizedDocumentSearch);
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
      return matchesSearch && matchesCustomer && matchesLocation && matchesStatus;
    }).sort((left, right) => {
      const leftDate = getOutboundDisplayShipDate(left) ?? "";
      const rightDate = getOutboundDisplayShipDate(right) ?? "";
      return rightDate.localeCompare(leftDate);
    });
  }, [liveOutboundDocuments, locations, mode, normalizedDocumentSearch, selectedCustomerId, selectedLocationId, selectedStatus]);
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
      const confirmed = inboundDocumentRows.filter((document) => normalizeDocumentStatus(document.status) === "CONFIRMED").length;
      const totalQty = inboundDocumentRows.reduce((sum, document) => sum + document.totalReceivedQty, 0);
      return [
        { label: t("allRows"), value: summaryNumberFormatter.format(inboundDocumentRows.length), meta: t("inbound") },
        { label: t("received"), value: summaryNumberFormatter.format(totalQty), meta: t("units") },
        { label: t("draft"), value: summaryNumberFormatter.format(scheduled), meta: t("trackingStatus") },
        { label: t("confirmed"), value: summaryNumberFormatter.format(confirmed), meta: t("status") }
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
    { field: "actualArrivalDate", headerName: t("actualArrivalDate"), minWidth: 140, renderCell: (params) => formatDate(params.row.actualArrivalDate) },
    { field: "expectedArrivalDate", headerName: t("expectedArrivalDate"), minWidth: 140, renderCell: (params) => formatDate(params.row.expectedArrivalDate) },
    { field: "containerNo", headerName: t("containerNo"), minWidth: 170, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.containerNo || "-"}</span> },
    { field: "customerName", headerName: t("customer"), minWidth: 180, flex: 1, renderCell: (params) => params.row.customerName || "-" },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 180, flex: 1, renderCell: (params) => `${params.row.locationName} / ${summarizeInboundDocumentSections(params.row)}` },
    { field: "totalLines", headerName: t("totalLines"), minWidth: 100, type: "number" },
    { field: "totalExpectedQty", headerName: t("expectedQty"), minWidth: 120, type: "number" },
    { field: "totalReceivedQty", headerName: t("received"), minWidth: 110, type: "number" },
    { field: "status", headerName: t("status"), minWidth: 150, renderCell: (params) => renderInboundDocumentStatus(params.row, t) },
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
              }, ...(params.row.handlingMode !== "SEALED_TRANSIT"
                ? [{
                  key: "confirm",
                  label: t("confirmReceipt"),
                  icon: <CheckCircleOutlineOutlinedIcon fontSize="small" />,
                  onClick: () => void handleConfirmInboundDocument(params.row)
                }]
                : [])]
              : []),
            ...(canManage
              ? [{
                key: "copy",
                label: normalizeDocumentStatus(params.row.status) === "CONFIRMED" ? t("reEnterReceipt") : t("copyReceipt"),
                icon: <ContentCopyOutlinedIcon fontSize="small" />,
                onClick: () => void handleCopyInboundDocument(params.row)
              }]
              : []),
            { key: "download-receiving-count-sheet", label: t("downloadReceivingCountSheet"), icon: <PictureAsPdfOutlinedIcon fontSize="small" />, onClick: () => void handleDownloadReceivingCountSheet(params.row) }
          ]}
        />
      )
    }
  ], [canManage, t]);
  const inboundSelectionColumn = useMemo<GridColDef<InboundDocument>>(() => ({
    ...GRID_CHECKBOX_SELECTION_COL_DEF,
    renderHeader: () => (
      <CurrentPageSelectionHeader
        selection={inboundRowSelectionModel}
        maximum={MAX_BULK_INBOUND_STATUS_DOCUMENTS}
        ariaLabel={t("selectCurrentPage")}
        onChange={setInboundRowSelectionModel}
        onLimitExceeded={() => showActionError(new Error(t("bulkInboundSelectionLimit", { count: MAX_BULK_INBOUND_STATUS_DOCUMENTS })), t("bulkInboundStatusFailed"))}
      />
    )
  }), [inboundRowSelectionModel, t]);

  const inboundDocumentDetailColumns = useMemo<GridColDef<InboundDocument["lines"][number]>[]>(() => [
    { field: "sku", headerName: t("sku"), minWidth: 110, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 260, flex: 1.4, renderCell: (params) => params.row.description || "-" },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 100, renderCell: (params) => normalizeStorageSection(params.row.storageSection) },
    { field: "expectedQty", headerName: t("expectedQty"), minWidth: 110, type: "number", renderCell: (params) => params.row.expectedQty || "-" },
    { field: "receivedQty", headerName: t("received"), minWidth: 110, type: "number", renderCell: (params) => params.row.receivedQty || "-" },
    { field: "pallets", headerName: t("pallets"), minWidth: 90, type: "number", renderCell: (params) => params.row.pallets || "-" },
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
    { field: "totalPlannedQty", headerName: t("plannedShipQty"), minWidth: 130, type: "number", renderCell: (params) => params.row.totalPlannedQty ?? params.row.totalQty },
    { field: "totalActualQty", headerName: t("actualShipQty"), minWidth: 130, type: "number", renderCell: (params) => params.row.totalActualQty ?? params.row.totalQty },
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
  const outboundSelectionColumn = useMemo<GridColDef<OutboundDocument>>(() => ({
    ...GRID_CHECKBOX_SELECTION_COL_DEF,
    renderHeader: () => (
      <CurrentPageSelectionHeader
        selection={outboundRowSelectionModel}
        maximum={MAX_BULK_OUTBOUND_ACTION_DOCUMENTS}
        ariaLabel={t("selectCurrentPage")}
        onChange={setOutboundRowSelectionModel}
        onLimitExceeded={() => showActionError(new Error(t("bulkOutboundSelectionLimit", { count: MAX_BULK_OUTBOUND_ACTION_DOCUMENTS })), t("bulkOutboundConfirmFailed"))}
      />
    )
  }), [outboundRowSelectionModel, t]);

  const outboundDocumentDetailColumns = useMemo<GridColDef<OutboundDocument["lines"][number]>[]>(() => [
    { field: "itemNumber", headerName: t("itemNumber"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.itemNumber || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 110, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 240, flex: 1.4, renderCell: (params) => params.row.description },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 150, flex: 1, renderCell: (params) => `${params.row.locationName} / ${normalizeStorageSection(params.row.storageSection)}` },
    { field: "plannedQuantity", headerName: t("plannedShipQty"), minWidth: 130, type: "number", renderCell: (params) => params.row.plannedQuantity ?? params.row.quantity },
    { field: "actualQuantity", headerName: t("actualShipQty"), minWidth: 130, type: "number", renderCell: (params) => params.row.actualQuantity ?? params.row.quantity },
    {
      field: "inventoryPalletsUsed",
      headerName: t("inventoryPallets"),
      minWidth: 170,
      type: "number",
      valueGetter: (_, row) => row.pickAllocations.reduce(
        (sum, allocation) => sum + Math.max(0, allocation.inventoryPalletsUsed ?? allocation.pallets ?? 0),
        0
      )
    },
    { field: "pallets", headerName: t("outboundPallets"), minWidth: 140, type: "number", renderCell: (params) => params.row.pallets || 0 },
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
    { field: "inventoryPalletsUsed", headerName: t("inventoryPallets"), minWidth: 170, type: "number" },
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
        allocatedQty: allocation.allocatedQty,
        inventoryPalletsUsed: Math.max(0, allocation.inventoryPalletsUsed ?? allocation.pallets ?? 0)
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
    () => batchOutboundLines.filter((line) => line.sourceKey.trim() !== "" && hasActivityOutboundRecordedQuantity(line)),
    [batchOutboundLines]
  );
  const batchOutboundLineReviewRows = useMemo(() => batchOutboundLines.flatMap((line, index) => {
    if (!line.sourceKey.trim() || !hasActivityOutboundRecordedQuantity(line)) {
      return [];
    }
    const source = findOutboundSourceOption(selectableOutboundSources, line.sourceKey);
    if (!source) {
      return [];
    }
    return [{
      id: line.id,
      lineLabel: `#${index + 1}`,
      sku: source.sku,
      itemNumber: source.itemNumber,
      description: source.description,
      locationName: source.locationName,
      plannedQuantity: Math.max(0, line.plannedQuantity),
      actualQuantity: Math.max(0, line.quantity),
      pallets: Math.max(0, line.pallets)
    }];
  }), [batchOutboundLines, selectableOutboundSources]);

  function validateOutboundDraft(requireAllocationReady: boolean) {
    if (outboundPalletSourceMessage) {
      return outboundPalletSourceMessage;
    }

    for (const line of batchOutboundLines) {
      if (isActivityOutboundLineEmpty(line)) {
        continue;
      }
      if (!line.sourceKey.trim()) {
        return t("chooseSkuAndQty");
      }
      if (!hasActivityOutboundRecordedQuantity(line)) {
        return t("outboundQtyRequired");
      }
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
      if (line.quantity > 0 && (!allocationSummary || allocationSummary.shortageQty > 0)) {
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

  function validateInboundDraft() {
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
      const validationError = validateInboundDraft();
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }
    }

    setErrorMessage("");
    setInboundWizardStep(nextStep);
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
    if (availableOutboundSources.length === 0 && outboundSourceReferences.length === 0) {
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
      status: normalizedStatus === "CONFIRMED" ? "CONFIRMED" : "DRAFT",
      documentNote: document.documentNote || ""
    });
    pendingBatchLineIDRef.current = null;
    setBatchLines(
      document.lines.length > 0
          ? document.lines.map((line) => ({
            id: String(line.id),
            itemNumber: line.itemNumber || skuMastersBySku.get(normalizeSkuLookupValue(line.sku))?.itemNumber || "",
            sku: line.sku || "",
            description: line.description || "",
            storageSection: normalizeStorageSection(line.storageSection || document.storageSection),
            reorderLevel: line.reorderLevel || 0,
            expectedQty: line.expectedQty,
            receivedQty: line.receivedQty,
            pallets: line.pallets,
            unitsPerPallet: line.unitsPerPallet || 0,
            lineNote: line.lineNote || ""
          }))
        : [createEmptyBatchInboundLine(normalizeStorageSection(document.storageSection))]
    );
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
          sourceSearch: `${line.sku} | ${line.itemNumber || "-"} | ${document.customerName} | ${line.description || ""}`,
          plannedQuantity: line.plannedQuantity ?? line.quantity,
          quantity: line.actualQuantity ?? line.quantity,
          pallets: (line.actualQuantity ?? line.quantity) > 0 ? (line.pallets || 0) : 0,
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
      const shouldRefreshDescription = !line.description.trim() || (previousDescription && line.description.trim() === previousDescription);
      const previousItemNumber = previousSkuMaster?.itemNumber.trim() ?? "";
      const shouldRefreshItemNumber = !line.itemNumber.trim()
        || (previousItemNumber && normalizeItemCodeLookupValue(line.itemNumber) === normalizeItemCodeLookupValue(previousItemNumber));

      return {
        ...line,
        sku: nextSkuValue,
        itemNumber: shouldRefreshItemNumber ? nextSkuMaster.itemNumber : line.itemNumber,
        description: shouldRefreshDescription ? nextDescription : line.description,
        storageSection: normalizeStorageSection(line.storageSection || batchForm.storageSection || batchSectionOptions[0]),
        reorderLevel: 0,
        unitsPerPallet: line.unitsPerPallet > 0 ? line.unitsPerPallet : Math.max(0, nextSkuMaster.defaultUnitsPerPallet || 0)
      };
    }));
  }

  function updateBatchLineItemNumber(lineID: string, nextItemNumberValue: string) {
    updateBatchLine(lineID, { itemNumber: nextItemNumberValue });
  }

  function updateBatchLine(lineID: string, updates: Partial<BatchInboundLineState>) {
    setBatchLines((current) => current.map((line) => line.id === lineID ? { ...line, ...updates } : line));
  }

  function updateBatchLineExpectedQty(lineID: string, nextExpectedQty: number) {
    updateBatchLine(lineID, { expectedQty: nextExpectedQty });
  }

  function updateBatchLineReceivedQty(lineID: string, nextReceivedQty: number) {
    updateBatchLine(lineID, { receivedQty: nextReceivedQty });
  }

  function updateBatchLinePallets(lineID: string, nextPallets: number) {
    updateBatchLine(lineID, { pallets: nextPallets });
  }

  function updateBatchLineUnitsPerPallet(lineID: string, nextUnitsPerPallet: number) {
    updateBatchLine(lineID, { unitsPerPallet: Math.max(0, nextUnitsPerPallet) });
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
    const fulfillmentQuantity = getActivityOutboundFulfillmentQuantity(currentLine);
    const previousAutoPalletPlan = buildAutoPalletPlan(fulfillmentQuantity, previousSkuMaster?.defaultUnitsPerPallet ?? 0);
    const nextAutoPalletPlan = buildAutoPalletPlan(fulfillmentQuantity, nextSkuMaster?.defaultUnitsPerPallet ?? 0);
    const shouldRefreshPallets = currentLine.pallets <= 0 || (previousSkuMaster !== undefined && currentLine.pallets === previousAutoPalletPlan.pallets);
    return {
      ...currentLine,
      sourceKey: nextSource.sourceKey,
      sourceSearch: formatActivityOutboundSourceSearchLabel(nextSource),
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
		plannedQuantity: line.plannedQuantity > 0 ? line.plannedQuantity : nextQuantity,
		quantity: nextQuantity,
		pallets: nextQuantity === 0 ? 0 : (shouldKeepAutoPallets ? nextAutoPalletPlan.pallets : line.pallets),
        palletsDetailCtns: ""
      };
    }));
  }

  function updateBatchOutboundLinePlannedQuantity(lineID: string, nextQuantity: number) {
    updateBatchOutboundLine(lineID, { plannedQuantity: nextQuantity });
  }

  async function submitInboundDocument(status: MutableDocumentStatus) {
    setBatchSubmitting(true);
    setErrorMessage("");

    if (isEditingConfirmedInbound) {
      setErrorMessage(t("confirmedReceiptImmutableNotice"));
      setBatchSubmitting(false);
      return;
    }

    const validationError = validateInboundDraft();
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
          if (!matchingTemplate && !lineDescription) {
            throw new Error(t("batchInboundMissingNewSkuDetails", { sku: normalizedSku || "-" }));
          }

          return {
            itemNumber: line.itemNumber.trim().toUpperCase()
              || matchingTemplate?.itemNumber?.trim().toUpperCase()
              || matchingSkuMaster?.itemNumber?.trim().toUpperCase()
              || undefined,
            sku: normalizedSku,
            description: lineDescription,
            reorderLevel: 0,
            expectedQty: line.expectedQty,
            receivedQty: line.receivedQty,
            pallets: isSealedTransitMode ? 0 : line.pallets,
            unitsPerPallet: isSealedTransitMode ? undefined : line.unitsPerPallet,
            palletsDetailCtns: undefined,
            storageSection: normalizeStorageSection(line.storageSection || batchForm.storageSection || batchSectionOptions[0]),
            lineNote: line.lineNote || undefined
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
            plannedQuantity: line.plannedQuantity,
            actualQuantity: line.quantity,
            pallets: line.quantity > 0 ? line.pallets : 0,
            palletsDetailCtns: undefined,
            unitLabel: line.unitLabel || selectedOutboundSource.unit.toUpperCase() || "PCS",
            cartonSizeMm: line.cartonSizeMm || undefined,
            netWeightKgs: line.netWeightKgs,
            grossWeightKgs: line.grossWeightKgs,
            lineNote: line.reason || undefined,
            pickAllocations: buildOutboundPickAllocationPayloads(selectedOutboundSource, previewRows)
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

  async function handleBulkUpdateInboundStatus() {
    if (!canManage || !bulkInboundStatus || selectedInboundStatusDocuments.length === 0) return;
    if (bulkInboundStatus === "CONFIRMED" && selectedInboundStatusDocuments.some((document) => normalizeDocumentStatus(document.status) !== "DRAFT")) {
      showActionError(new Error(t("bulkInboundConfirmDraftsOnly")), t("couldNotSaveActivity"));
      return;
    }
    if (bulkInboundStatus === "CONFIRMED" && selectedInboundStatusDocuments.some((document) => document.handlingMode === "SEALED_TRANSIT")) {
      showActionError(new Error(t("bulkInboundConvertSealedFirst")), t("couldNotSaveActivity"));
      return;
    }

    const count = selectedInboundStatusDocuments.length;
    const approved = await confirm({
      title: t("bulkInboundChangeStatus"),
      message: t(bulkInboundStatus === "CONFIRMED" ? "bulkInboundConfirmPrompt" : "bulkInboundDeletePrompt", { count }),
      confirmLabel: t(bulkInboundStatus === "CONFIRMED" ? "confirmed" : "deleted"),
      cancelLabel: t("cancel"),
      confirmColor: bulkInboundStatus === "DELETED" ? "error" : "primary",
      severity: bulkInboundStatus === "DELETED" ? "warning" : "info"
    });
    if (!approved) return;

    setIsBulkUpdatingInboundStatus(true);
    setErrorMessage("");
    try {
      const response = await api.bulkUpdateInboundDocumentStatus(
        selectedInboundStatusDocuments.map((document) => document.id),
        bulkInboundStatus
      );
      setInboundRowSelectionModel({ type: "include", ids: new Set() });
      setBulkInboundStatus("");
      await onRefresh();
      showActionSuccess(t("bulkInboundStatusUpdated", { count: response.updatedDocuments }));
    } catch (error) {
      showActionError(error, t("bulkInboundStatusFailed"));
    } finally {
      setIsBulkUpdatingInboundStatus(false);
    }
  }

  async function handleBulkConfirmOutboundDocuments() {
    if (!canManage || selectedOutboundDocuments.length === 0) return;
    if (selectedOutboundDocuments.some((document) => document.archivedAt || normalizeDocumentStatus(document.status) !== "DRAFT")) {
      showActionError(new Error(t("bulkOutboundConfirmDraftsOnly")), t("bulkOutboundConfirmFailed"));
      return;
    }

    const count = selectedOutboundDocuments.length;
    const approved = await confirm({
      title: t("bulkOutboundConfirmTitle"),
      message: t("bulkOutboundConfirmPrompt", { count }),
      confirmLabel: t("confirmShipment"),
      cancelLabel: t("cancel"),
      confirmColor: "primary",
      severity: "info"
    });
    if (!approved) return;

    setIsBulkConfirmingOutbound(true);
    setErrorMessage("");
    try {
      const response = await api.bulkConfirmOutboundDocuments(
        selectedOutboundDocuments.map((document) => document.id)
      );
      const failedResults = response.results.filter((result) => !result.success);
      const reloadWarningCount = response.results.filter((result) => result.success && result.warning).length;
      const successfulDocumentIds = new Set(
        response.results.filter((result) => result.success).map((result) => result.documentId)
      );
      setOutboundRowSelectionModel({
        type: "include",
        ids: new Set(
          selectedOutboundDocuments
            .filter((document) => !successfulDocumentIds.has(document.id))
            .map((document) => document.id)
        )
      });
      await onRefresh();
      if (failedResults.length === 0) {
        const messages = [t("bulkOutboundConfirmed", { count: response.updatedDocuments })];
        if (reloadWarningCount > 0) {
          messages.push(t("bulkOutboundConfirmReloadWarnings", { count: reloadWarningCount }));
        }
        showActionSuccess(messages.join(" "));
      } else {
        const visibleFailures = failedResults
          .slice(0, 3)
          .map((result) => result.error || t("bulkOutboundConfirmUnknownFailure", { id: result.documentId }));
        const hiddenFailureCount = Math.max(0, failedResults.length - visibleFailures.length);
        const failureDetails = [
          ...visibleFailures,
          ...(hiddenFailureCount > 0 ? [t("bulkOutboundConfirmMoreFailures", { count: hiddenFailureCount })] : []),
          ...(response.interrupted
            ? [t("bulkOutboundConfirmInterrupted", { count: response.unprocessedDocuments })]
            : []),
          ...(reloadWarningCount > 0 ? [t("bulkOutboundConfirmReloadWarnings", { count: reloadWarningCount })] : [])
        ].join(" ");
        showActionError(
          new Error(`${t("bulkOutboundConfirmPartial", {
            success: response.updatedDocuments,
            failed: response.failedDocuments
          })} ${failureDetails}`),
          t("bulkOutboundConfirmFailed")
        );
      }
    } catch (error) {
      showActionError(error, t("bulkOutboundConfirmFailed"));
    } finally {
      setIsBulkConfirmingOutbound(false);
    }
  }

  async function handleBulkDeleteOutboundDocuments() {
    if (!canManage || selectedOutboundDocuments.length === 0) return;

    const count = selectedOutboundDocuments.length;
    const approved = await confirm({
      title: t("bulkOutboundDeleteTitle"),
      message: t("bulkOutboundDeletePrompt", { count }),
      confirmLabel: t("bulkOutboundDeleteConfirm"),
      cancelLabel: t("cancel"),
      confirmColor: "error",
      severity: "warning"
    });
    if (!approved) return;

    setIsBulkDeletingOutbound(true);
    setErrorMessage("");
    try {
      const response = await api.bulkDeleteOutboundDocuments(
        selectedOutboundDocuments.map((document) => document.id)
      );
      const failedResults = response.results.filter((result) => !result.success);
      const successfulDocumentIds = new Set(
        response.results.filter((result) => result.success).map((result) => result.documentId)
      );
      setOutboundRowSelectionModel({
        type: "include",
        ids: new Set(
          selectedOutboundDocuments
            .filter((document) => !successfulDocumentIds.has(document.id))
            .map((document) => document.id)
        )
      });
      setSelectedOutboundDocumentId(null);
      let refreshFailed = false;
      try {
        await onRefresh();
      } catch {
        refreshFailed = true;
      }
      const refreshWarning = refreshFailed ? t("bulkOutboundDeleteRefreshWarning") : "";
      if (failedResults.length === 0) {
        const deletedMessage = t("bulkOutboundDeleted", { count: response.deletedDocuments });
        if (refreshFailed) {
          showActionError(new Error(`${deletedMessage} ${refreshWarning}`), refreshWarning);
        } else {
          showActionSuccess(deletedMessage);
        }
      } else {
        const visibleFailures = failedResults
          .slice(0, 3)
          .map((result) => result.error || t("bulkOutboundDeleteUnknownFailure", { id: result.documentId }));
        const hiddenFailureCount = Math.max(0, failedResults.length - visibleFailures.length);
        const failureDetails = [
          ...visibleFailures,
          ...(hiddenFailureCount > 0 ? [t("bulkOutboundDeleteMoreFailures", { count: hiddenFailureCount })] : []),
          ...(response.interrupted
            ? [t("bulkOutboundDeleteInterrupted", { count: response.unprocessedDocuments })]
            : []),
          ...(refreshFailed ? [refreshWarning] : [])
        ].join(" ");
        showActionError(
          new Error(`${t("bulkOutboundDeletePartial", {
            success: response.deletedDocuments,
            failed: response.failedDocuments
          })} ${failureDetails}`),
          t("bulkOutboundDeleteFailed")
        );
      }
    } catch (error) {
      showActionError(error, t("bulkOutboundDeleteFailed"));
    } finally {
      setIsBulkDeletingOutbound(false);
    }
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
          actualArrivalDate: formatDate(document.actualArrivalDate),
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
          totalPlannedQty: document.totalPlannedQty ?? document.totalQty,
          totalActualQty: document.totalActualQty ?? document.totalQty,
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
                    <>
                      {mode === "IN" ? (
                        <>
                          <select className="workspace-bulk-status-select" aria-label={t("bulkInboundTargetStatus")} value={bulkInboundStatus} onChange={(event) => setBulkInboundStatus(event.target.value as "" | "CONFIRMED" | "DELETED")} disabled={isBulkUpdatingInboundStatus}>
                            <option value="">{t("bulkInboundTargetStatus")}</option>
                            <option value="CONFIRMED">{t("confirmed")}</option>
                            <option value="DELETED">{t("deleted")}</option>
                          </select>
                          <Button variant="outlined" startIcon={isBulkUpdatingInboundStatus ? <InlineLoadingIndicator /> : <CheckCircleOutlineOutlinedIcon />} onClick={() => void handleBulkUpdateInboundStatus()} disabled={isBulkUpdatingInboundStatus || !bulkInboundStatus || selectedInboundStatusDocuments.length === 0}>
                            {t("bulkInboundApplyStatus", { count: selectedInboundStatusDocuments.length })}
                          </Button>
                          <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => setIsBulkInboundImportOpen(true)}>
                            {t("bulkInboundExcel")}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="outlined"
                            startIcon={isBulkConfirmingOutbound ? <InlineLoadingIndicator /> : <CheckCircleOutlineOutlinedIcon />}
                            onClick={() => void handleBulkConfirmOutboundDocuments()}
                            disabled={isBulkConfirmingOutbound || isBulkDeletingOutbound || !canBulkConfirmSelectedOutbound}
                          >
                            {t("bulkOutboundConfirmSelected", { count: selectedOutboundDocuments.length })}
                          </Button>
                          <Button
                            variant="outlined"
                            color="error"
                            startIcon={isBulkDeletingOutbound ? <InlineLoadingIndicator /> : <DeleteOutlineOutlinedIcon />}
                            onClick={() => void handleBulkDeleteOutboundDocuments()}
                            disabled={isBulkDeletingOutbound || isBulkConfirmingOutbound || selectedOutboundDocuments.length === 0}
                          >
                            {t("bulkOutboundDeleteSelected", { count: selectedOutboundDocuments.length })}
                          </Button>
                          <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => setIsBulkOutboundImportOpen(true)} disabled={isBulkConfirmingOutbound || isBulkDeletingOutbound}>
                            {t("bulkInboundExcel")}
                          </Button>
                        </>
                      )}
                      <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={() => void openCreateModal()}>
                        {mode === "IN" ? t("newInbound") : t("newOutbound")}
                      </Button>
                    </>
                  ) : null}
                  <Button variant="outlined" disabled>
                    {mode === "IN" ? t("documentsView") : t("packingListsView")}
                  </Button>
                </>
              )}
              notices={[permissionNotice]}
              errorMessage={(errorMessage || documentFilterErrorMessage) && !isBatchModalOpen ? errorMessage || documentFilterErrorMessage : ""}
            />
            <div className="filter-bar">
              <SearchSubmitField
                label={t("search")}
                value={searchTerm}
                onChange={setSearchTerm}
                onSubmit={submitDocumentSearch}
                placeholder={mode === "IN" ? t("searchInboundPlaceholder") : t("searchOutboundPlaceholder")}
                submitTitle={`${t("search")} (Enter)`}
              />
              <label>{t("customer")}<select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}><option value="all">{t("allCustomers")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
              <label>{t("currentStorage")}<select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}><option value="all">{t("allStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
              <label>{t("status")}<select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}><option value="all">{t("allStatuses")}</option><option value="DRAFT">{t("draft")}</option><option value="CONFIRMED">{t("confirmed")}</option>{mode === "OUT" ? <option value="ARCHIVED">{t("archived")}</option> : null}</select></label>
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
                  columns={[inboundSelectionColumn, ...inboundDocumentColumns]}
                  loading={isLoading || isDocumentFilterLoading}
                  pagination
                  checkboxSelection={canManage}
                  disableRowSelectionExcludeModel
                  rowSelectionModel={inboundRowSelectionModel}
                  onRowSelectionModelChange={handleInboundRowSelectionChange}
                  isRowSelectable={(params) => !params.row.archivedAt && ["DRAFT", "CONFIRMED"].includes(normalizeDocumentStatus(params.row.status))}
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
                  columns={[outboundSelectionColumn, ...outboundDocumentColumns]}
                  loading={isLoading || isDocumentFilterLoading}
                  pagination
                  checkboxSelection={canManage}
                  disableRowSelectionExcludeModel
                  rowSelectionModel={outboundRowSelectionModel}
                  onRowSelectionModelChange={handleOutboundRowSelectionChange}
                  isRowSelectable={(params) => !params.row.archivedAt && normalizeDocumentStatus(params.row.status) !== "DELETED"}
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
          {mode === "IN" ? (
            <InboundBulkImportDialog
              open={isBulkInboundImportOpen}
              customers={customers}
              locations={locations}
              initialCustomerId={selectedCustomerId === "all" ? undefined : Number(selectedCustomerId)}
              onClose={() => setIsBulkInboundImportOpen(false)}
              onImported={async () => {
                setSelectedStatus("DRAFT");
                await onRefresh();
              }}
            />
          ) : (
            <OutboundBulkImportDialog
              open={isBulkOutboundImportOpen}
              customers={customers}
              locations={locations}
              items={items}
              initialCustomerId={selectedCustomerId === "all" ? undefined : Number(selectedCustomerId)}
              onClose={() => setIsBulkOutboundImportOpen(false)}
              onImported={async () => {
                setSelectedStatus("DRAFT");
                await onRefresh();
              }}
            />
          )}
        </main>
      ) : null}
      {feedbackToast}
      <ExportLoadingScreen open={isDocumentExporting} />

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
                    {[selectedInboundDocument.customerName || "-", formatDate(selectedInboundDocument.actualArrivalDate || selectedInboundDocument.expectedArrivalDate)].filter(Boolean).join(" · ")}
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
                {canManage
                && !selectedInboundDocument.archivedAt
                && normalizeDocumentStatus(selectedInboundDocument.status) === "DRAFT"
                && selectedInboundDocument.handlingMode !== "SEALED_TRANSIT" ? (
                  <Button
                    variant="contained"
                    startIcon={documentActionKey === getInboundDocumentActionKey(selectedInboundDocument.id, "confirm") ? <InlineLoadingIndicator /> : <CheckCircleOutlineOutlinedIcon />}
                    disabled={disableSelectedInboundActions}
                    onClick={() => void handleConfirmInboundDocument(selectedInboundDocument)}
                  >
                    {t("confirmReceipt")}
                  </Button>
                ) : null}
                <Button
                  variant="contained"
                  startIcon={isSelectedInboundReceivingCountSheetBusy ? <InlineLoadingIndicator /> : <PictureAsPdfOutlinedIcon />}
                  onClick={() => void handleDownloadReceivingCountSheet(selectedInboundDocument)}
                  disabled={disableSelectedInboundActions}
                  aria-busy={isSelectedInboundReceivingCountSheetBusy}
                >
                  {t("downloadReceivingCountSheet")}
                </Button>
                {canManage
                && !selectedInboundDocument.archivedAt
                && normalizeDocumentStatus(selectedInboundDocument.status) !== "DELETED" ? (
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
              </div>

              <div className="document-drawer__status-bar">
                <div className="document-drawer__status-main">
                  {renderInboundDocumentStatus(selectedInboundDocument, t)}
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
                  <strong>{t("confirmedAt")}</strong>
                  <span>{selectedInboundDocument.confirmedAt ? formatDateTimeValue(selectedInboundDocument.confirmedAt, resolvedTimeZone) : "-"}</span>
                </div>
              </div>

              <div className="document-drawer__meta">
                <div className="sheet-note"><strong>{t("actualArrivalDate")}</strong> {formatDate(selectedInboundDocument.actualArrivalDate)}</div>
                <div className="sheet-note"><strong>{t("expectedArrivalDate")}</strong> {formatDate(selectedInboundDocument.expectedArrivalDate)}</div>
                <div className="sheet-note"><strong>{t("customer")}</strong> {selectedInboundDocument.customerName || "-"}</div>
                <div className="sheet-note"><strong>{t("currentStorage")}</strong> {`${selectedInboundDocument.locationName} / ${summarizeInboundDocumentSections(selectedInboundDocument)}`}</div>
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
                    variant={selectedOutboundTrackingAction.trackingStatus === "SHIPPED" || selectedOutboundTrackingAction.trackingStatus === "BO_RECEIVED" ? "contained" : "outlined"}
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
                      <label>{t("actualArrivalDate")}<input type="date" value={batchForm.actualArrivalDate} onChange={(event) => setBatchForm((current) => ({ ...current, actualArrivalDate: event.target.value }))} /></label>
                      <label>{t("expectedArrivalDate")}<input type="date" value={batchForm.expectedArrivalDate} onChange={(event) => setBatchForm((current) => ({ ...current, expectedArrivalDate: event.target.value }))} /></label>
                      <label>{t("containerNo")}<input value={batchForm.containerNo} onChange={(event) => setBatchForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="MRSU8580370" /></label>
                      <label>{t("billingContainerType")}<select value={batchForm.containerType} onChange={(event) => setBatchForm((current) => ({ ...current, containerType: event.target.value as ContainerType }))} disabled={isEditingConfirmedInbound}><option value="NORMAL">{t("billingContainerTypeNormal")}</option><option value="WEST_COAST_TRANSFER">{t("billingContainerTypeWestCoastTransfer")}</option></select></label>
                      <label>{t("handlingMode")}<select value={batchForm.handlingMode} onChange={(event) => setBatchForm((current) => ({ ...current, handlingMode: event.target.value as InboundHandlingMode }))} disabled={isEditingConfirmedInbound}><option value="PALLETIZED">{t("handlingModePalletized")}</option><option value="SEALED_TRANSIT">{t("handlingModeSealedTransit")}</option></select></label>
                      <label>{t("customer")}<select value={batchForm.customerId} onChange={(event) => setBatchForm((current) => ({ ...current, customerId: event.target.value }))}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
                      <label>{t("currentStorage")}<select value={batchForm.locationId} onChange={(event) => setBatchForm((current) => ({ ...current, locationId: event.target.value }))}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
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

                <datalist id="embedded-inbound-item-code-list">
                  {Array.from(skuMastersByItemNumber.keys()).map((itemCode) => <option key={itemCode} value={itemCode} />)}
                </datalist>
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
                          <label>{t("itemCode")}<input value={line.itemNumber} onChange={(event) => updateBatchLineItemNumber(line.id, event.target.value)} placeholder="ITEM-001" list="embedded-inbound-item-code-list" /></label>
                          <label className="batch-line-grid__description">{t("description")}<input value={selectedBatchItem ? displayDescription(selectedBatchItem) : (line.description || (batchSkuMaster ? getSKUMasterDescription(batchSkuMaster) : "") || displayDescription(batchSkuTemplate ?? { description: "", name: "" }))} onChange={(event) => updateBatchLine(line.id, { description: event.target.value })} placeholder={t("descriptionPlaceholder")} disabled={Boolean(selectedBatchItem)} /></label>
                          <label>{t("expectedQty")}<input type="number" min="0" value={numberInputValue(line.expectedQty)} onChange={(event) => updateBatchLineExpectedQty(line.id, Math.max(0, Number(event.target.value || 0)))} /></label>
                          <label>{t("received")}<input type="number" min="0" value={numberInputValue(line.receivedQty)} onChange={(event) => updateBatchLineReceivedQty(line.id, Math.max(0, Number(event.target.value || 0)))} /></label>
                          <label>{t("pallets")}<input type="number" min="0" value={numberInputValue(line.pallets)} onChange={(event) => updateBatchLinePallets(line.id, Math.max(0, Number(event.target.value || 0)))} disabled={batchForm.handlingMode === "SEALED_TRANSIT"} /></label>
                          <label>{t("ctnPerPallet")}<input type="number" min="0" value={String(line.unitsPerPallet)} onChange={(event) => updateBatchLineUnitsPerPallet(line.id, Math.max(0, Number(event.target.value || 0)))} disabled={batchForm.handlingMode === "SEALED_TRANSIT"} placeholder={batchSkuMaster?.defaultUnitsPerPallet ? String(batchSkuMaster.defaultUnitsPerPallet) : ""} /></label>
                          <label>{t("storageSection")}<select value={normalizeStorageSection(line.storageSection || batchSectionOptions[0])} onChange={(event) => updateBatchLine(line.id, { storageSection: event.target.value })}>{batchSectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
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
                            batchForm.actualArrivalDate || batchForm.expectedArrivalDate || "-"
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
                            <span className="batch-line-card__hint">
                              {`${t("itemCode")}: ${line.itemNumber.trim().toUpperCase() || batchSkuMaster?.itemNumber || "-"}`}
                            </span>
                            <span className="batch-line-card__hint">{line.description.trim() || (batchSkuMaster ? getSKUMasterDescription(batchSkuMaster) : "-")}</span>
                            <span className="batch-line-card__hint">
                              {[
                                `${t("expectedQty")}: ${line.expectedQty}`,
                                `${t("received")}: ${line.receivedQty}`,
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
                    const lineSelectableOutboundSources = filterActivityOutboundSources(
                      selectableOutboundSources,
                      line.sourceSearch,
                      line.sourceKey
                    );
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
                          <label>
                            {t("search")}
                            <input
                              type="text"
                              aria-label={`${t("search")} ${t("shipmentSource")} #${index + 1}`}
                              value={line.sourceSearch}
                              onChange={(event) => updateBatchOutboundLine(line.id, {
                                sourceKey: "",
                                sourceSearch: event.target.value
                              })}
                              placeholder={t("typeSkuToSearch")}
                              disabled={Boolean(outboundPalletSourceMessage)}
                            />
                          </label>
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
                              {lineSelectableOutboundSources.map((item) => (
                              <option key={item.sourceKey} value={item.sourceKey}>
                                  {`${item.customerName} | ${item.locationName} / ${item.storageSections.join(", ") || DEFAULT_STORAGE_SECTION} | ${t("containers")}: ${item.containerCount} | ${t("itemNumber")}: ${item.itemNumber || "-"} | ${item.sku} - ${item.description} (${t("availableQty")}: ${item.availableQty})`}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>{t("availableQty")}<input value={selectedOutboundSource ? String(selectedOutboundSource.availableQty) : ""} readOnly /></label>
                          <label>{t("plannedShipQty")}<input type="number" min="0" value={numberInputValue(line.plannedQuantity)} onChange={(event) => updateBatchOutboundLinePlannedQuantity(line.id, Math.max(0, Number(event.target.value || 0)))} disabled={Boolean(outboundPalletSourceMessage)} /></label>
                          <label>{t("actualShipQty")}<input type="number" min="0" value={numberInputValue(line.quantity)} onChange={(event) => updateBatchOutboundLineQuantity(line.id, Math.max(0, Number(event.target.value || 0)))} disabled={Boolean(outboundPalletSourceMessage)} /></label>
                          <label>{t("pallets")}<input type="number" min="0" value={numberInputValue(line.pallets)} onChange={(event) => updateBatchOutboundLine(line.id, { pallets: line.quantity > 0 ? Math.max(0, Number(event.target.value || 0)) : 0 })} disabled={Boolean(outboundPalletSourceMessage) || line.quantity <= 0} /></label>
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
                          autoPickLabel={t("autoPick")}
                          selectContainerLabel={t("selectContainer")}
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
                            requiredQtyValue={getActivityOutboundFulfillmentQuantity(line)}
                            selectedQtyLabel={t("selectedQty")}
                            selectedQtyValue={outboundAllocationSummary?.allocatedQty ?? 0}
                            remainingQtyLabel={t("remainingQty")}
                            remainingQtyValue={outboundAllocationSummary?.shortageQty ?? 0}
                            sourceContainerLabel={t("sourceContainer")}
                            pickQtyLabel={t("pickQty")}
                            unitLabel={line.unitLabel || selectedOutboundSource.unit.toUpperCase() || "PCS"}
                            positionLabel={t("pallet")}
                            canExpand={outboundAllocationRows.length > 0}
                            expanded={isOutboundPickPlanExpanded}
                            onToggle={() => toggleOutboundPickPlan(line.id)}
                            emptyHint={t("pickAllocationPreviewEmpty")}
                            rows={outboundAllocationRows.map((row) => ({
                              id: row.id,
                              positionLabel: row.positionLabel,
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
                <div className="batch-allocation-preview batch-allocation-preview--compact">
                  <div className="batch-allocation-preview__header">
                    <div>
                      <strong>{t("pickAllocationPreview")}</strong>
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
                  ) : batchOutboundLineReviewRows.length === 0 ? (
                    <div className="sheet-note sheet-note--readonly">
                      {t("pickAllocationPreviewEmpty")}
                    </div>
                  ) : null}

                  {batchOutboundLineReviewRows.length > 0 ? (
                    <div className="batch-lines" data-testid="batch-outbound-line-review">
                      <div className="batch-line-card">
                        <div className="batch-line-card__header">
                          <div className="batch-line-card__title flex-wrap">
                            <strong>{`${t("plannedShipQty")} / ${t("actualShipQty")}`}</strong>
                          </div>
                        </div>
                        <div className="mt-2 space-y-2">
                          {batchOutboundLineReviewRows.map((line) => (
                            <div
                              key={line.id}
                              data-testid={`batch-outbound-line-review-line-${line.id}`}
                              className="rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2.5"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-700">
                                    <span>{`${t("shipmentLine")} ${line.lineLabel}`}</span>
                                    <span className="ml-2 font-mono">{line.sku}</span>
                                    {line.description ? ` · ${line.description}` : ""}
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                                    <span>{`${t("currentStorage")}: ${line.locationName}`}</span>
                                    {line.itemNumber ? <span className="font-mono">{line.itemNumber}</span> : null}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
                                    {`${t("plannedShipQty")}: ${line.plannedQuantity}`}
                                  </span>
                                  <span className="rounded-md border border-amber-200/80 bg-amber-50 px-2 py-1 text-amber-700">
                                    {`${t("actualShipQty")}: ${line.actualQuantity}`}
                                  </span>
                                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
                                    {`${t("pallets")}: ${line.pallets}`}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
                ) : null}

                <div className="sheet-form__actions shipment-action-bar" style={{ marginTop: "1rem" }}>
                  <div className="shipment-action-bar__secondary">
                    <button className="button button--ghost" type="button" onClick={closeBatchModal}>{t("cancel")}</button>
                    {outboundWizardStep < 3 ? (
                      <button className="button button--ghost" type="button" disabled={batchSubmitting || Boolean(outboundPalletSourceMessage) || (!isEditingOutboundDraft && selectableOutboundSources.length === 0)} onClick={() => void submitOutboundDocument("DRAFT")}>{batchSubmitting ? t("saving") : isEditingOutboundDraft ? t("saveChanges") : t("scheduleShipment")}</button>
                    ) : null}
                  </div>
                  <div className="shipment-action-bar__primary shipment-wizard__actions">
                    {outboundWizardStep > 1 ? (
                      <button className="button button--ghost" type="button" onClick={() => moveOutboundWizardStep((outboundWizardStep - 1) as OutboundWizardStep)} disabled={Boolean(outboundPalletSourceMessage)}>{t("back")}</button>
                    ) : null}
                    {outboundWizardStep < 3 ? (
                      <button className="button button--primary" type="button" onClick={() => moveOutboundWizardStep((outboundWizardStep + 1) as OutboundWizardStep)} disabled={Boolean(outboundPalletSourceMessage)}>{t("next")}</button>
                    ) : (
                      <button className="button button--primary" type="submit" disabled={batchSubmitting || Boolean(outboundPalletSourceMessage) || (!isEditingOutboundDraft && selectableOutboundSources.length === 0)}>{batchSubmitting ? t("saving") : t("scheduleShipment")}</button>
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
      dateLabel: formatDate(document.actualArrivalDate || document.expectedArrivalDate || document.createdAt || ""),
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
      dateLabel: formatDate(document.actualArrivalDate || document.expectedArrivalDate || document.createdAt || ""),
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

function inboundDocumentMatchesSearch(document: InboundDocument, normalizedSearch: string) {
  if (normalizedSearch.length === 0) {
    return true;
  }

  const searchableFields = [
    document.containerNo,
    document.customerName,
    document.locationName,
    document.storageSection,
    document.documentNote,
    document.status,
    document.trackingStatus,
    ...document.lines.flatMap((line) => [
      line.sku,
      line.description,
      line.storageSection,
      line.palletsDetailCtns,
      line.lineNote
    ])
  ];

  return searchableFields.some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch));
}

function outboundDocumentMatchesSearch(document: OutboundDocument, normalizedSearch: string) {
  if (normalizedSearch.length === 0) {
    return true;
  }

  const searchableFields = [
    document.packingListNo,
    document.orderRef,
    document.customerName,
    document.shipToName,
    document.shipToAddress,
    document.shipToContact,
    document.carrierName,
    document.documentNote,
    document.status,
    document.trackingStatus,
    document.storages,
    ...document.lines.flatMap((line) => [
      line.itemNumber,
      line.locationName,
      line.storageSection,
      line.sku,
      line.description,
      line.palletsDetailCtns,
      line.unitLabel,
      line.cartonSizeMm,
      line.lineNote,
      ...line.pickAllocations.flatMap((allocation) => [
        allocation.itemNumber,
        allocation.locationName,
        allocation.storageSection,
        allocation.containerNo
      ])
    ])
  ];

  return searchableFields.some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch));
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
  return !document.archivedAt
    && normalizeDocumentStatus(document.status) !== "CONFIRMED";
}

function renderInboundDocumentStatus(document: InboundDocument, t: (key: string) => string) {
  return renderDocumentStatus(document.status, document.archivedAt, t);
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
  if (normalizedTrackingStatus === "BO_RECEIVED") {
    return <Chip label={t("boReceivedTracking")} color="success" size="small" variant="filled" />;
  }
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
  if (document.lines.every((line) => !outboundDocumentLineRequiresPickAllocation(line) || line.pickAllocations.length > 0)) {
    return document;
  }

  const preview = buildOutboundAllocationPreview(
    document.lines.map((line) => ({
      id: String(line.id),
      sourceKey: buildOutboundSourceKey(document.customerId, line.locationId, line.skuMasterId),
      sourceSearch: "",
      plannedQuantity: line.plannedQuantity ?? line.quantity,
      quantity: line.actualQuantity ?? line.quantity,
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
      if (!outboundDocumentLineRequiresPickAllocation(line) || line.pickAllocations.length > 0) {
        return line;
      }
      return {
        ...line,
        pickAllocations: buildPreviewPickAllocations(line, previewRowsByLineId.get(String(line.id)) ?? [])
      };
    })
  };
}

function outboundDocumentLineRequiresPickAllocation(
  line: Pick<OutboundDocument["lines"][number], "quantity" | "actualQuantity">
) {
  return Math.max(0, line.actualQuantity ?? line.quantity) > 0;
}

function buildPreviewPickAllocations(
  line: OutboundDocument["lines"][number],
  previewRows: OutboundAllocationPreviewRow[]
): OutboundPickAllocation[] {
  if (previewRows.length === 0) {
    return [];
  }

  return previewRows.map((row, index) => {
    const remainingPallets = row.allocatedQty >= row.startingQty ? 0 : row.startingPallets;
    return {
      id: -(index + 1),
      lineId: line.id,
      itemNumber: row.itemNumber || line.itemNumber || "",
      locationId: line.locationId,
      locationName: row.locationName || line.locationName,
      storageSection: row.storageSection || line.storageSection,
      containerNo: row.containerNo || "",
      allocatedQty: row.allocatedQty,
      pallets: Math.max(0, row.startingPallets - remainingPallets),
      inventoryPalletsUsed: Math.max(0, row.pallets),
      startingPallets: Math.max(0, row.startingPallets),
      remainingPallets: Math.max(0, remainingPallets),
      createdAt: line.createdAt
    };
  });
}

function buildOutboundAllocationPreview(lines: BatchOutboundLineState[], sourceOptions: OutboundSourceOption[]): OutboundAllocationPreviewResult {
  const reservedBySourceId = new Map<string, number>();
  const reservedPalletsBySourceId = new Map<string, number>();
  const rows: OutboundAllocationPreviewRow[] = [];
  const summaries = new Map<string, OutboundAllocationLineSummary>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fulfillmentQuantity = getActivityOutboundFulfillmentQuantity(line);
    if (!line.sourceKey.trim() || fulfillmentQuantity <= 0) {
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
      requestedQty: fulfillmentQuantity,
      allocatedQty: 0,
      shortageQty: 0,
      containerCount: 0
    };

    let remainingQty = fulfillmentQuantity;
    for (const candidate of selectedSource.candidates) {
      const sourceId = candidate.id;
      const effectiveAvailable = candidate.availableQty - (reservedBySourceId.get(sourceId) ?? 0);
      const startingPallets = Math.max(0, candidate.onHandPallets - (reservedPalletsBySourceId.get(sourceId) ?? 0));
      const startingQty = Math.max(0, candidate.onHandQty - (reservedBySourceId.get(sourceId) ?? 0));
      if (effectiveAvailable <= 0) {
        continue;
      }

      const allocatedQty = Math.min(effectiveAvailable, remainingQty);
      if (allocatedQty <= 0) {
        continue;
      }

      const allocatedPallets = automaticInventoryPalletsForAllocation(
        effectiveAvailable,
        startingPallets,
        allocatedQty
      );
      const remainingPallets = startingQty - allocatedQty > 0 ? startingPallets : 0;
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
        positionLabel: candidate.positionLabel,
        allocatedQty,
        pallets: allocatedPallets,
        startingQty,
        startingPallets,
        remainingPallets
      });
      reservedBySourceId.set(sourceId, (reservedBySourceId.get(sourceId) ?? 0) + allocatedQty);
      reservedPalletsBySourceId.set(sourceId, (reservedPalletsBySourceId.get(sourceId) ?? 0) + Math.max(0, startingPallets - remainingPallets));
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

function compareOutboundInventoryCandidates(left: OutboundInventoryCandidate, right: OutboundInventoryCandidate) {
  const leftArrival = left.actualArrivalDate || left.createdAt || "";
  const rightArrival = right.actualArrivalDate || right.createdAt || "";
  if (!leftArrival && rightArrival) return 1;
  if (leftArrival && !rightArrival) return -1;
  if (leftArrival !== rightArrival) return leftArrival.localeCompare(rightArrival);
  if (left.locationName !== right.locationName) return left.locationName.localeCompare(right.locationName);
  if (left.storageSection !== right.storageSection) return left.storageSection.localeCompare(right.storageSection);
  if (left.containerNo !== right.containerNo) return left.containerNo.localeCompare(right.containerNo);
  return left.positionLabel.localeCompare(right.positionLabel);
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

function normalizeActivityOutboundSourceSearch(value: string) {
  return value.trim().toUpperCase();
}

function formatActivityOutboundSourceSearchLabel(source: OutboundSourceOption) {
  return `${source.sku} | ${source.itemNumber || "-"} | ${source.customerName} | ${source.description}`;
}

function filterActivityOutboundSources(
  sourceOptions: OutboundSourceOption[],
  searchValue: string,
  selectedSourceKey: string
) {
  const normalizedSearch = normalizeActivityOutboundSourceSearch(searchValue);
  if (!normalizedSearch) {
    return sourceOptions;
  }
  return sourceOptions.filter((source) => {
    if (source.sourceKey === selectedSourceKey) {
      return true;
    }
    const normalizedLabel = normalizeActivityOutboundSourceSearch(formatActivityOutboundSourceSearchLabel(source));
    return normalizedLabel.includes(normalizedSearch)
      || normalizeActivityOutboundSourceSearch(source.sku).includes(normalizedSearch)
      || normalizeActivityOutboundSourceSearch(source.itemNumber).includes(normalizedSearch);
  });
}

function buildPlanOnlyOutboundSourceOptionsFromReferences(
  references: OutboundSourceReference[],
  locations: Location[],
  lines: Pick<BatchOutboundLineState, "sourceKey" | "sourceSearch">[]
) {
  const sources = new Map<string, OutboundSourceOption>();
  const locationsByID = new Map(locations.map((location) => [location.id, location] as const));
  const addSource = (reference: OutboundSourceReference, location: Location) => {
      const sourceKey = buildOutboundSourceKey(reference.customerId, location.id, reference.skuMasterId);
      sources.set(sourceKey, {
        sourceKey,
        customerId: reference.customerId,
        customerName: reference.customerName,
        locationId: location.id,
        locationName: location.name,
        skuMasterId: reference.skuMasterId,
        sku: reference.sku,
        itemNumber: reference.itemNumber,
        description: reference.description,
        unit: (reference.unit || "PCS").toUpperCase(),
        availableQty: 0,
        palletCount: 0,
        storageSections: getLocationSectionOptions(location),
        containerCount: 0,
        containerSummary: "",
        candidates: []
      });
  };

  for (const line of lines) {
    const [selectedCustomerID, selectedLocationID, selectedSKUMasterID] = line.sourceKey
      .split("|")
      .map((value) => Number(value));
    if (selectedCustomerID > 0 && selectedLocationID > 0 && selectedSKUMasterID > 0) {
      const selectedReference = references.find((reference) => (
        reference.customerId === selectedCustomerID && reference.skuMasterId === selectedSKUMasterID
      ));
      const selectedLocation = locationsByID.get(selectedLocationID);
      if (selectedReference && selectedLocation) {
        addSource(selectedReference, selectedLocation);
      }
    }

    const normalizedSearch = normalizeActivityOutboundSourceSearch(line.sourceSearch);
    if (!normalizedSearch) {
      continue;
    }
    const matchingReferences = references.filter((reference) => {
      const normalizedLabel = normalizeActivityOutboundSourceSearch(
        `${reference.sku} | ${reference.itemNumber || "-"} | ${reference.customerName} | ${reference.description}`
      );
      return normalizedLabel.includes(normalizedSearch)
        || normalizeActivityOutboundSourceSearch(reference.sku).includes(normalizedSearch)
        || normalizeActivityOutboundSourceSearch(reference.itemNumber).includes(normalizedSearch);
    });
    for (const reference of matchingReferences) {
      for (const location of locations) {
        addSource(reference, location);
      }
    }
  }

  return [...sources.values()];
}

export function buildOutboundSourceOptionsFromItems(items: Item[], skuMastersByID: Map<number, SKUMaster>): OutboundSourceOption[] {
  const grouped = new Map<string, OutboundSourceOption>();
  for (const item of items) {
    if (item.availableQty <= 0 || !item.containerNo.trim()) {
      continue;
    }
    const storageSection = normalizeStorageSection(item.storageSection);
    const containerNo = item.containerNo.trim().toUpperCase();
    const sourceKey = buildOutboundSourceKey(item.customerId, item.locationId, item.skuMasterId);
    const candidate: OutboundInventoryCandidate = {
      id: `item-${item.id}`,
      inventoryItemId: item.id,
      positionLabel: containerNo,
      customerId: item.customerId,
      customerName: item.customerName,
      locationId: item.locationId,
      locationName: item.locationName,
      storageSection,
      containerNo,
      skuMasterId: item.skuMasterId,
      sku: item.sku,
      itemNumber: item.itemNumber || "",
      description: item.description || item.name || "",
      unit: (item.unit || skuMastersByID.get(item.skuMasterId)?.unit || "PCS").toUpperCase(),
      availableQty: item.availableQty,
      availablePallets: Math.max(0, item.availablePallets),
      onHandQty: Math.max(0, item.quantity ?? 0, item.availableQty + (item.allocatedQty ?? 0)),
      onHandPallets: Math.max(0, item.pallets ?? 0, item.availablePallets + (item.allocatedPallets ?? 0)),
      actualArrivalDate: item.deliveryDate,
      createdAt: item.createdAt
    };
    const existing = grouped.get(sourceKey);
    if (!existing) {
      grouped.set(sourceKey, {
        sourceKey,
        customerId: item.customerId,
        customerName: item.customerName,
        locationId: item.locationId,
        locationName: item.locationName,
        skuMasterId: item.skuMasterId,
        sku: item.sku,
        itemNumber: item.itemNumber || "",
        description: item.description || item.name || "",
        unit: candidate.unit,
        availableQty: item.availableQty,
        palletCount: candidate.availablePallets,
        storageSections: [storageSection],
        containerCount: 1,
        containerSummary: "",
        candidates: [candidate]
      });
      continue;
    }
    existing.availableQty += item.availableQty;
    existing.palletCount += candidate.availablePallets;
    if (!existing.storageSections.includes(storageSection)) {
      existing.storageSections.push(storageSection);
    }
    existing.candidates.push(candidate);
  }

  return [...grouped.values()].map((source) => {
    const sortedCandidates = [...source.candidates].sort(compareOutboundInventoryCandidates);
    return {
      ...source,
      storageSections: [...source.storageSections].sort(),
      containerCount: new Set(sortedCandidates.map((candidate) => candidate.containerNo)).size,
      containerSummary: formatContainerDistributionSummaryValue(sortedCandidates.map((candidate) => ({
        containerNo: candidate.containerNo,
        availableQty: candidate.availableQty,
        locationName: candidate.locationName,
        storageSection: candidate.storageSection
      }))),
      candidates: sortedCandidates
    };
  }).sort((left, right) => left.customerName.localeCompare(right.customerName)
    || left.locationName.localeCompare(right.locationName)
    || left.sku.localeCompare(right.sku));
}

function automaticInventoryPalletsForAllocation(availableQty: number, availablePallets: number, allocatedQty: number) {
  if (availableQty <= 0 || availablePallets <= 0 || allocatedQty <= 0) {
    return 0;
  }
  if (allocatedQty >= availableQty) {
    return availablePallets;
  }
  return Math.min(availablePallets, Math.max(1, Math.ceil(availablePallets * allocatedQty / availableQty)));
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
