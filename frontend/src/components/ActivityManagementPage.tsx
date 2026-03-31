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
import { RowActionsMenu } from "./RowActionsMenu";
import { buildItemContainerBalances, formatContainerDistributionSummary as formatContainerDistributionSummaryValue, type ItemContainerBalance } from "../lib/containerBalances";
import { formatDateTimeValue, formatDateValue } from "../lib/dates";
import { downloadExcelWorkbook, type ExcelExportColumn } from "../lib/excelExport";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { downloadOutboundDeliveryNotePdfFromDocument } from "../lib/outboundPackingListPdf";
import { downloadOutboundPickSheetPdfFromDocument } from "../lib/outboundPickSheetPdf";
import {
  DEFAULT_STORAGE_SECTION,
  getLocationSectionOptions,
  normalizeStorageSection,
  type Customer,
  type InboundDocument,
  type InboundDocumentPayload,
  type Item,
  type Location,
  type Movement,
  type OutboundDocument,
  type OutboundDocumentPayload,
  type SKUMaster,
  type UserRole
} from "../lib/types";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { InlineAlert, useConfirmDialog, useFeedbackToast } from "./Feedback";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";

type ActivityMode = "IN" | "OUT";
type MutableDocumentStatus = "DRAFT" | "CONFIRMED";
type OutboundWizardStep = 1 | 2 | 3;

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
};

type BatchInboundFormState = {
  deliveryDate: string;
  containerNo: string;
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
  palletsDetailCtns: string;
  lineNote: string;
};

type BatchOutboundFormState = {
  packingListNo: string;
  orderRef: string;
  outDate: string;
  shipToName: string;
  shipToAddress: string;
  shipToContact: string;
  carrierName: string;
  status: MutableDocumentStatus;
  documentNote: string;
};

type BatchOutboundLineAllocationState = {
  storageSection: string;
  containerNo: string;
  allocatedQty: number;
};

type BatchOutboundLineState = {
  id: string;
  itemId: string;
  pickMode: "AUTO" | "MANUAL";
  quantity: number;
  pallets: number;
  palletsDetailCtns: string;
  unitLabel: string;
  cartonSizeMm: string;
  netWeightKgs: number;
  grossWeightKgs: number;
  reason: string;
  pickAllocations: BatchOutboundLineAllocationState[];
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
  itemId: number;
  itemNumber: string;
  sku: string;
  description: string;
  locationName: string;
  storageSection: string;
  requestedQty: number;
  allocatedQty: number;
  shortageQty: number;
  containerCount: number;
  hasManualAllocations: boolean;
  manualAllocatedQty: number;
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
  id: number;
  customerId: number;
  customerName: string;
  locationId: number;
  locationName: string;
  sku: string;
  itemNumber: string;
  description: string;
  unit: string;
  availableQty: number;
  storageSections: string[];
  containerCount: number;
  containerSummary: string;
  candidates: ItemContainerBalance[];
};

type InboundContainerWarningMatch = {
  documentId: number;
  containerNo: string;
  customerName: string;
  dateLabel: string;
  similarity: number;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const RECEIPTS_EXPORT_TITLE = "Receipts";
const SHIPMENTS_EXPORT_TITLE = "Shipments";
const RECEIPTS_EXPORT_COLUMNS = [
  { key: "deliveryDate", label: "Receipt Date" },
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
  { key: "outDate", label: "Ship Date" },
  { key: "shipToName", label: "Ship-to Name" },
  { key: "carrierName", label: "Carrier" },
  { key: "totalLines", label: "Total Lines" },
  { key: "totalQty", label: "Total Qty" },
  { key: "totalGrossWeightKgs", label: "Gross Weight (kg)" },
  { key: "trackingStatus", label: "Tracking" },
  { key: "status", label: "Status" }
] as const;

function createEmptyBatchInboundForm(): BatchInboundFormState {
  return {
    deliveryDate: "",
    containerNo: "",
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
    palletsDetailCtns: "",
    lineNote: ""
  };
}

function createEmptyBatchOutboundForm(): BatchOutboundFormState {
  return {
    packingListNo: "",
    orderRef: "",
    outDate: "",
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
    itemId: "",
    pickMode: "AUTO",
    quantity: 0,
    pallets: 0,
    palletsDetailCtns: "",
    unitLabel: "PCS",
    cartonSizeMm: "",
    netWeightKgs: 0,
    grossWeightKgs: 0,
    reason: "",
    pickAllocations: []
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

export function ActivityManagementPage({ mode, items, skuMasters, locations, customers, movements, inboundDocuments, outboundDocuments, currentUserRole, isLoading, onRefresh }: ActivityManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
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
  const [selectedInboundDocument, setSelectedInboundDocument] = useState<InboundDocument | null>(null);
  const [selectedOutboundDocument, setSelectedOutboundDocument] = useState<OutboundDocument | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [outboundWizardStep, setOutboundWizardStep] = useState<OutboundWizardStep>(1);
  const [batchInboundLineAddCount, setBatchInboundLineAddCount] = useState(1);
  const [batchOutboundLineAddCount, setBatchOutboundLineAddCount] = useState(1);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [optimisticInboundDocuments, setOptimisticInboundDocuments] = useState<InboundDocument[]>([]);
  const [optimisticOutboundDocuments, setOptimisticOutboundDocuments] = useState<OutboundDocument[]>([]);
  const pendingBatchLineIDRef = useRef<string | null>(null);
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
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
  const isEditingInboundDraft = normalizeDocumentStatus(editingInboundDocument?.status ?? "") === "DRAFT";
  const isEditingConfirmedInbound = normalizeDocumentStatus(editingInboundDocument?.status ?? "") === "CONFIRMED";
  const isEditingOutboundDraft = editingOutboundDocumentId !== null;

  function showActionError(error: unknown, fallbackMessage: string) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    setErrorMessage(message);
    showError(message);
  }

  function showActionSuccess(message: string) {
    setErrorMessage("");
    showSuccess(message);
  }

  useEffect(() => {
    setIsBatchModalOpen(false);
    setEditingInboundDocumentId(null);
    setEditingOutboundDocumentId(null);
    setBatchOutboundForm(createEmptyBatchOutboundForm());
    setBatchOutboundLines([createEmptyBatchOutboundLine()]);
    setOutboundWizardStep(1);
    setBatchInboundLineAddCount(1);
    setBatchOutboundLineAddCount(1);
    setSelectedStatus("all");
    setSelectedInboundDocument(null);
    setSelectedOutboundDocument(null);
  }, [mode]);

  useEffect(() => {
    if (mode !== "OUT" || !selectedOutboundDocument) {
      return;
    }

    const nextSelectedDocument = liveOutboundDocuments.find((document) => document.id === selectedOutboundDocument.id) ?? null;
    if (!nextSelectedDocument) {
      setSelectedOutboundDocument(null);
      return;
    }

    if (nextSelectedDocument !== selectedOutboundDocument) {
      setSelectedOutboundDocument(nextSelectedDocument);
    }
  }, [liveOutboundDocuments, mode, selectedOutboundDocument]);

  useEffect(() => {
    if (mode !== "IN" || !selectedInboundDocument) {
      return;
    }

    const nextSelectedDocument = liveInboundDocuments.find((document) => document.id === selectedInboundDocument.id) ?? null;
    if (!nextSelectedDocument) {
      setSelectedInboundDocument(null);
      return;
    }

    if (nextSelectedDocument !== selectedInboundDocument) {
      setSelectedInboundDocument(nextSelectedDocument);
    }
  }, [liveInboundDocuments, mode, selectedInboundDocument]);

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
  const batchSectionOptions = useMemo(() => getLocationSectionOptions(batchLocation), [batchLocation]);
  const inboundContainerWarnings = useMemo(
    () => buildInboundContainerWarnings(batchForm.containerNo, liveInboundDocuments, editingInboundDocumentId),
    [batchForm.containerNo, editingInboundDocumentId, liveInboundDocuments]
  );
  const availableOutboundSources = useMemo(
    () => buildOutboundSourceOptions(items.filter((item) => item.availableQty > 0), movements),
    [items, movements]
  );
  const selectableOutboundSources = useMemo(() => {
    const selectedIds = new Set(
      batchOutboundLines
        .map((line) => Number(line.itemId))
        .filter((itemId) => Number.isFinite(itemId) && itemId > 0)
    );

    const merged = [...availableOutboundSources];
    for (const selectedId of selectedIds) {
      const selectedItem = items.find((item) => item.id === selectedId);
      const source = selectedItem
        ? buildOutboundSourceOptions(items.filter((item) =>
          item.customerId === selectedItem.customerId
          && item.locationId === selectedItem.locationId
          && item.sku.trim().toUpperCase() === selectedItem.sku.trim().toUpperCase()
        ), movements)[0]
        : null;
      if (source && !merged.some((item) => item.id === source.id)) {
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
      const leftDate = left.deliveryDate ?? left.createdAt ?? "";
      const rightDate = right.deliveryDate ?? right.createdAt ?? "";
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
      const leftDate = left.outDate ?? left.createdAt ?? "";
      const rightDate = right.outDate ?? right.createdAt ?? "";
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

  const inboundDocumentColumns = useMemo<GridColDef<InboundDocument>[]>(() => [
    { field: "deliveryDate", headerName: t("deliveryDate"), minWidth: 140, renderCell: (params) => formatDate(params.row.deliveryDate) },
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
            { key: "details", label: t("details"), icon: <VisibilityOutlinedIcon fontSize="small" />, onClick: () => setSelectedInboundDocument(params.row) },
            ...(canManage && !params.row.archivedAt && ["DRAFT", "CONFIRMED"].includes(normalizeDocumentStatus(params.row.status))
              ? [{
                key: "edit",
                label: normalizeDocumentStatus(params.row.status) === "CONFIRMED" ? t("editReceipt") : t("editDraft"),
                icon: <EditOutlinedIcon fontSize="small" />,
                onClick: () => openEditInboundDocument(params.row)
              }]
              : []),
            ...(canManage
              ? [{ key: "copy", label: t("copyReceipt"), icon: <ContentCopyOutlinedIcon fontSize="small" />, onClick: () => void handleCopyInboundDocument(params.row) }]
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
    { field: "outDate", headerName: t("outDate"), minWidth: 130, renderCell: (params) => formatDate(params.row.outDate) },
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
            { key: "details", label: t("details"), icon: <VisibilityOutlinedIcon fontSize="small" />, onClick: () => setSelectedOutboundDocument(params.row) },
            ...(canManage && !params.row.archivedAt && normalizeDocumentStatus(params.row.status) === "DRAFT"
              ? [{ key: "edit", label: t("editDraft"), icon: <EditOutlinedIcon fontSize="small" />, onClick: () => openEditOutboundDraft(params.row) }]
              : []),
            ...(canManage
              ? [{ key: "copy", label: t("copyShipment"), icon: <ContentCopyOutlinedIcon fontSize="small" />, onClick: () => void handleCopyOutboundDocument(params.row) }]
              : []),
            ...(canManage && !params.row.archivedAt
              ? [{ key: "archive", label: t("archiveShipment"), icon: <ArchiveOutlinedIcon fontSize="small" />, onClick: () => void handleArchiveOutboundDocument(params.row) }]
              : []),
            { key: "download-pick-sheet", label: t("downloadPickSheet"), icon: <PictureAsPdfOutlinedIcon fontSize="small" />, onClick: () => downloadOutboundPickSheetPdfFromDocument(params.row) },
            { key: "download-delivery-note", label: t("downloadDeliveryNote"), icon: <PictureAsPdfOutlinedIcon fontSize="small" />, onClick: () => downloadOutboundDeliveryNotePdfFromDocument(params.row) },
            ...(canManage && !params.row.archivedAt && params.row.status !== "CANCELLED"
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
    () => batchOutboundLines.filter((line) => Number(line.itemId) > 0 && line.quantity > 0),
    [batchOutboundLines]
  );

  function validateOutboundDraft(requireAllocationReady: boolean) {
    if (validBatchOutboundLines.length === 0) {
      return t("batchOutboundRequireLine");
    }

    for (const line of validBatchOutboundLines) {
      const itemId = Number(line.itemId);
      const selectedOutboundItem = items.find((item) => item.id === itemId);
      if (!selectedOutboundItem) {
        return t("chooseSkuAndQty");
      }

      if (!requireAllocationReady) {
        continue;
      }

      const allocationSummary = batchOutboundAllocationPreview.summaries.get(line.id);
      if (!allocationSummary || allocationSummary.shortageQty > 0) {
        return t("outboundQtyExceedsStock", {
          sku: selectedOutboundItem.sku,
          available: allocationSummary?.allocatedQty ?? 0
        });
      }
      if (line.pickMode === "MANUAL" && allocationSummary.hasManualAllocations && allocationSummary.manualAllocatedQty !== line.quantity) {
        return t("manualPickPlanMismatch", {
          sku: selectedOutboundItem.sku,
          planned: allocationSummary.manualAllocatedQty,
          requested: line.quantity
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
    setOutboundWizardStep(nextStep);
  }

  function openCreateModal() {
    if (!canManage) {
      return;
    }

    if (mode === "IN") {
      openBatchModal();
      return;
    }

    if (mode === "OUT") {
      openOutboundBatchModal();
      return;
    }
  }

  function openBatchModal() {
    if (!canManage) {
      return;
    }
    setEditingInboundDocumentId(null);
    setEditingOutboundDocumentId(null);
    setBatchForm({
      ...createEmptyBatchInboundForm(),
      customerId: customers[0] ? String(customers[0].id) : "",
      locationId: locations[0] ? String(locations[0].id) : ""
    });
    pendingBatchLineIDRef.current = null;
    setBatchLines([createEmptyBatchInboundLine()]);
    setBatchInboundLineAddCount(1);
    setErrorMessage("");
    setIsBatchModalOpen(true);
  }

  function openOutboundBatchModal() {
    if (!canManage) {
      return;
    }
    if (availableOutboundSources.length === 0) {
      setErrorMessage(t("noAvailableStockRows"));
      return;
    }
    setEditingInboundDocumentId(null);
    setEditingOutboundDocumentId(null);
    setBatchOutboundForm(createEmptyBatchOutboundForm());
    setBatchOutboundLines([createEmptyBatchOutboundLine()]);
    setOutboundWizardStep(1);
    setBatchOutboundLineAddCount(1);
    setErrorMessage("");
    setIsBatchModalOpen(true);
  }

  function openEditInboundDocument(document: InboundDocument) {
    const normalizedStatus = normalizeDocumentStatus(document.status);
    if (!canManage || document.archivedAt || (normalizedStatus !== "DRAFT" && normalizedStatus !== "CONFIRMED")) {
      return;
    }

    setEditingInboundDocumentId(document.id);
    setEditingOutboundDocumentId(null);
    setBatchForm({
      deliveryDate: document.deliveryDate ? document.deliveryDate.slice(0, 10) : "",
      containerNo: document.containerNo || "",
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
            palletsDetailCtns: line.palletsDetailCtns || "",
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

    const draftLines = document.lines.length > 0
      ? document.lines.map((line) => ({
          id: String(line.id),
          itemId: String(line.itemId),
          pickMode: "AUTO" as const,
          quantity: line.quantity,
          pallets: line.pallets || 0,
          palletsDetailCtns: "",
          unitLabel: line.unitLabel || "PCS",
          cartonSizeMm: line.cartonSizeMm || "",
          netWeightKgs: line.netWeightKgs || 0,
          grossWeightKgs: line.grossWeightKgs || 0,
          reason: line.lineNote || "",
          pickAllocations: normalizeBatchOutboundPickAllocations(
            line.pickAllocations.map((allocation) => ({
              storageSection: normalizeStorageSection(allocation.storageSection),
              containerNo: allocation.containerNo || "",
              allocatedQty: allocation.allocatedQty
            }))
          )
        }))
      : [createEmptyBatchOutboundLine()];
    const autoPreview = buildOutboundAllocationPreview(
      draftLines.map((line) => ({ ...line, pickMode: "AUTO", pickAllocations: [] })),
      selectableOutboundSources
    );

    setEditingOutboundDocumentId(document.id);
    setEditingInboundDocumentId(null);
    setBatchOutboundForm({
      packingListNo: document.packingListNo || "",
      orderRef: document.orderRef || "",
      outDate: document.outDate ? document.outDate.slice(0, 10) : "",
      shipToName: document.shipToName || "",
      shipToAddress: document.shipToAddress || "",
      shipToContact: document.shipToContact || "",
      carrierName: document.carrierName || "",
      status: "DRAFT",
      documentNote: document.documentNote || ""
    });
    setOutboundWizardStep(1);
    setBatchOutboundLines(
      draftLines.map((line) => {
        const storedAllocations = normalizeBatchOutboundPickAllocations(line.pickAllocations);
        const autoAllocations = normalizeBatchOutboundPickAllocations(
          autoPreview.rows
            .filter((row) => row.id.startsWith(`${line.id}-`))
            .map((row) => ({
              storageSection: normalizeStorageSection(row.storageSection),
              containerNo: row.containerNo || "",
              allocatedQty: row.allocatedQty
            }))
        );

        return {
          ...line,
          pickMode: areOutboundPickAllocationsEqual(storedAllocations, autoAllocations) ? "AUTO" : "MANUAL"
        };
      })
    );
    setErrorMessage("");
    setIsBatchModalOpen(true);
  }

  function closeBatchModal() {
    setEditingInboundDocumentId(null);
    setEditingOutboundDocumentId(null);
    setBatchForm({
      ...createEmptyBatchInboundForm(),
      customerId: customers[0] ? String(customers[0].id) : "",
      locationId: locations[0] ? String(locations[0].id) : ""
    });
    pendingBatchLineIDRef.current = null;
    setBatchLines([createEmptyBatchInboundLine()]);
    setBatchSubmitting(false);
    setOutboundWizardStep(1);
    setBatchInboundLineAddCount(1);
    setBatchOutboundLineAddCount(1);
    setBatchOutboundForm(createEmptyBatchOutboundForm());
    setBatchOutboundLines([createEmptyBatchOutboundLine()]);
    setErrorMessage("");
    setIsBatchModalOpen(false);
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
      const totalQty = line.receivedQty || line.expectedQty;
      const previousAutoPalletPlan = buildAutoPalletPlan(totalQty, previousSkuMaster?.defaultUnitsPerPallet ?? 0);
      const nextAutoPalletPlan = buildAutoPalletPlan(totalQty, nextSkuMaster.defaultUnitsPerPallet);
      const shouldRefreshDescription = !line.description.trim() || (previousDescription && line.description.trim() === previousDescription);
      const shouldRefreshReorder = line.reorderLevel <= 0 || (previousSkuMaster !== undefined && line.reorderLevel === previousSkuMaster.reorderLevel);
      const shouldRefreshPallets = line.pallets <= 0 || (previousSkuMaster !== undefined && line.pallets === previousAutoPalletPlan.pallets);
      const shouldRefreshPalletDetail = !line.palletsDetailCtns.trim()
        || (previousSkuMaster !== undefined && line.palletsDetailCtns.trim() === previousAutoPalletPlan.detail);

      return {
        ...line,
        sku: nextSkuValue,
        description: shouldRefreshDescription ? nextDescription : line.description,
        storageSection: normalizeStorageSection(line.storageSection || batchForm.storageSection || batchSectionOptions[0]),
        reorderLevel: shouldRefreshReorder ? nextSkuMaster.reorderLevel : line.reorderLevel,
        pallets: shouldRefreshPallets ? nextAutoPalletPlan.pallets : line.pallets,
        palletsDetailCtns: shouldRefreshPalletDetail ? nextAutoPalletPlan.detail : line.palletsDetailCtns
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
      const unitsPerPallet = skuMaster?.defaultUnitsPerPallet ?? 0;
      const previousSuggested = calculateSuggestedReorderLevel(line.expectedQty, line.receivedQty);
      const nextReceivedQty = line.receivedQty <= 0 || line.receivedQty === line.expectedQty ? nextExpectedQty : line.receivedQty;
      const nextSuggested = calculateSuggestedReorderLevel(nextExpectedQty, nextReceivedQty);
      const shouldKeepAutoReorder = line.reorderLevel <= 0 || line.reorderLevel === previousSuggested;
      const previousAutoPalletPlan = buildAutoPalletPlan(line.receivedQty || line.expectedQty, unitsPerPallet);
      const nextAutoPalletPlan = buildAutoPalletPlan(nextReceivedQty || nextExpectedQty, unitsPerPallet);
      const shouldKeepAutoPallets = line.pallets <= 0 || line.pallets === previousAutoPalletPlan.pallets;
      const shouldKeepAutoPalletsDetail = !line.palletsDetailCtns || line.palletsDetailCtns === previousAutoPalletPlan.detail;

      return {
        ...line,
        expectedQty: nextExpectedQty,
        receivedQty: nextReceivedQty,
        reorderLevel: shouldKeepAutoReorder ? nextSuggested : line.reorderLevel,
        pallets: shouldKeepAutoPallets ? nextAutoPalletPlan.pallets : line.pallets,
        palletsDetailCtns: shouldKeepAutoPalletsDetail ? nextAutoPalletPlan.detail : line.palletsDetailCtns
      };
    }));
  }

  function updateBatchLineReceivedQty(lineID: string, nextReceivedQty: number) {
    setBatchLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const skuMaster = skuMastersBySku.get(normalizeSkuLookupValue(line.sku));
      const unitsPerPallet = skuMaster?.defaultUnitsPerPallet ?? 0;
      const previousSuggested = calculateSuggestedReorderLevel(line.expectedQty, line.receivedQty);
      const nextSuggested = calculateSuggestedReorderLevel(line.expectedQty, nextReceivedQty);
      const shouldKeepAutoReorder = line.reorderLevel <= 0 || line.reorderLevel === previousSuggested;
      const previousAutoPalletPlan = buildAutoPalletPlan(line.receivedQty || line.expectedQty, unitsPerPallet);
      const nextAutoPalletPlan = buildAutoPalletPlan(nextReceivedQty || line.expectedQty, unitsPerPallet);
      const shouldKeepAutoPallets = line.pallets <= 0 || line.pallets === previousAutoPalletPlan.pallets;
      const shouldKeepAutoPalletsDetail = !line.palletsDetailCtns || line.palletsDetailCtns === previousAutoPalletPlan.detail;

      return {
        ...line,
        receivedQty: nextReceivedQty,
        reorderLevel: shouldKeepAutoReorder ? nextSuggested : line.reorderLevel,
        pallets: shouldKeepAutoPallets ? nextAutoPalletPlan.pallets : line.pallets,
        palletsDetailCtns: shouldKeepAutoPalletsDetail ? nextAutoPalletPlan.detail : line.palletsDetailCtns
      };
    }));
  }

  function autofillBatchLineReceivedQty(lineID: string) {
    setBatchLines((current) => current.map((line) => {
      if (line.id !== lineID || line.receivedQty > 0 || line.expectedQty <= 0) {
        return line;
      }

      const skuMaster = skuMastersBySku.get(normalizeSkuLookupValue(line.sku));
      const unitsPerPallet = skuMaster?.defaultUnitsPerPallet ?? 0;
      const nextReceivedQty = line.expectedQty;
      const previousSuggested = calculateSuggestedReorderLevel(line.expectedQty, line.receivedQty);
      const nextSuggested = calculateSuggestedReorderLevel(line.expectedQty, nextReceivedQty);
      const shouldKeepAutoReorder = line.reorderLevel <= 0 || line.reorderLevel === previousSuggested;
      const previousAutoPalletPlan = buildAutoPalletPlan(line.receivedQty || line.expectedQty, unitsPerPallet);
      const nextAutoPalletPlan = buildAutoPalletPlan(nextReceivedQty || line.expectedQty, unitsPerPallet);
      const shouldKeepAutoPallets = line.pallets <= 0 || line.pallets === previousAutoPalletPlan.pallets;
      const shouldKeepAutoPalletsDetail = !line.palletsDetailCtns || line.palletsDetailCtns === previousAutoPalletPlan.detail;

      return {
        ...line,
        receivedQty: nextReceivedQty,
        reorderLevel: shouldKeepAutoReorder ? nextSuggested : line.reorderLevel,
        pallets: shouldKeepAutoPallets ? nextAutoPalletPlan.pallets : line.pallets,
        palletsDetailCtns: shouldKeepAutoPalletsDetail ? nextAutoPalletPlan.detail : line.palletsDetailCtns
      };
    }));
  }

  function updateBatchLinePallets(lineID: string, nextPallets: number) {
    setBatchLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const previousSuggested = getSuggestedPalletsDetail(line.receivedQty || line.expectedQty, line.pallets);
      const nextSuggested = getSuggestedPalletsDetail(line.receivedQty || line.expectedQty, nextPallets);
      const shouldKeepAutoPalletsDetail = !line.palletsDetailCtns || line.palletsDetailCtns === previousSuggested;

      return {
        ...line,
        pallets: nextPallets,
        palletsDetailCtns: shouldKeepAutoPalletsDetail ? nextSuggested : line.palletsDetailCtns
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
        itemId: ""
      };
    }

    const previousSource = findOutboundSourceOption(selectableOutboundSources, Number(currentLine.itemId));
    const previousSkuMaster = previousSource ? skuMastersBySku.get(normalizeSkuLookupValue(previousSource.sku)) : undefined;
    const nextSkuMaster = skuMastersBySku.get(normalizeSkuLookupValue(nextSource.sku));
    const previousAutoPalletPlan = buildAutoPalletPlan(currentLine.quantity, previousSkuMaster?.defaultUnitsPerPallet ?? 0);
    const nextAutoPalletPlan = buildAutoPalletPlan(currentLine.quantity, nextSkuMaster?.defaultUnitsPerPallet ?? 0);
    const shouldRefreshPallets = currentLine.pallets <= 0 || (previousSkuMaster !== undefined && currentLine.pallets === previousAutoPalletPlan.pallets);
    return {
      ...currentLine,
      itemId: String(nextSource.id),
      unitLabel: nextSource.unit?.toUpperCase() || currentLine.unitLabel || "PCS",
      pallets: shouldRefreshPallets ? nextAutoPalletPlan.pallets : currentLine.pallets,
      palletsDetailCtns: "",
      pickAllocations: []
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

      const selectedSource = findOutboundSourceOption(selectableOutboundSources, Number(line.itemId));
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

  function updateBatchOutboundLinePickAllocation(lineID: string, storageSection: string, containerNo: string, allocatedQty: number) {
    const nextQty = Math.max(0, allocatedQty);
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      const allocationKey = buildOutboundAllocationKey(storageSection, containerNo);
      const nextAllocations = normalizeBatchOutboundPickAllocations([
        ...line.pickAllocations.filter((allocation) => buildOutboundAllocationKey(allocation.storageSection, allocation.containerNo) !== allocationKey),
        ...(nextQty > 0 ? [{
          storageSection,
          containerNo,
          allocatedQty: nextQty
        }] : [])
      ]);

      return {
        ...line,
        pickAllocations: nextAllocations
      };
    }));
  }

  function updateBatchOutboundPickMode(lineID: string, nextMode: "AUTO" | "MANUAL") {
    setBatchOutboundLines((current) => current.map((line) => {
      if (line.id !== lineID) {
        return line;
      }

      if (nextMode === "AUTO") {
        return {
          ...line,
          pickMode: "AUTO",
          pickAllocations: []
        };
      }

      const previewRows = batchOutboundAllocationPreview.rows.filter((row) => row.id.startsWith(`${line.id}-`));
      const seededAllocations = normalizeBatchOutboundPickAllocations(
        previewRows.map((row) => ({
          storageSection: row.storageSection,
          containerNo: row.containerNo,
          allocatedQty: row.allocatedQty
        }))
      );

      return {
        ...line,
        pickMode: "MANUAL",
        pickAllocations: line.pickAllocations.length > 0 ? line.pickAllocations : seededAllocations
      };
    }));
  }

  async function submitInboundDocument(status: MutableDocumentStatus) {
    setBatchSubmitting(true);
    setErrorMessage("");

    const validLines = batchLines.filter((line) => line.sku.trim() && (line.receivedQty > 0 || line.expectedQty > 0));
    if (validLines.length === 0) {
      setErrorMessage(t("batchInboundRequireLine"));
      setBatchSubmitting(false);
      return;
    }
    const batchLocationId = Number(batchForm.locationId);
    const batchCustomerId = Number(batchForm.customerId);
    if (!batchCustomerId) {
      setErrorMessage(t("chooseCustomerBeforeSave"));
      setBatchSubmitting(false);
      return;
    }
    if (!batchLocationId) {
      setErrorMessage(t("chooseStorageBeforeSave"));
      setBatchSubmitting(false);
      return;
    }

    try {
      const editingInboundDocument = editingInboundDocumentId
        ? liveInboundDocuments.find((document) => document.id === editingInboundDocumentId)
        : null;
      const payload: InboundDocumentPayload = {
        customerId: batchCustomerId,
        locationId: batchLocationId,
        deliveryDate: batchForm.deliveryDate || undefined,
        containerNo: batchForm.containerNo || undefined,
        storageSection: normalizeStorageSection(validLines[0]?.storageSection || batchForm.storageSection || batchSectionOptions[0]),
        unitLabel: batchForm.unitLabel || "CTN",
        status,
        trackingStatus: status === "DRAFT"
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

          if (!matchingTemplate && !lineDescription) {
            throw new Error(t("batchInboundMissingNewSkuDetails", { sku: normalizedSku || "-" }));
          }

          return {
            sku: normalizedSku,
            description: lineDescription,
            reorderLevel: line.reorderLevel || matchingTemplate?.reorderLevel || matchingSkuMaster?.reorderLevel || 0,
            expectedQty: line.expectedQty,
            receivedQty: normalizedReceivedQty,
            pallets: line.pallets,
            palletsDetailCtns: line.palletsDetailCtns || undefined,
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
    void submitInboundDocument("CONFIRMED");
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
        outDate: batchOutboundForm.outDate || undefined,
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
          const itemId = Number(line.itemId);
          const selectedOutboundSource = findOutboundSourceOption(selectableOutboundSources, itemId);
          if (!selectedOutboundSource) {
            throw new Error(t("chooseSkuAndQty"));
          }

          return {
            itemId,
            quantity: line.quantity,
            pallets: line.pallets,
            palletsDetailCtns: undefined,
            unitLabel: line.unitLabel || selectedOutboundSource.unit.toUpperCase() || "PCS",
            cartonSizeMm: line.cartonSizeMm || undefined,
            netWeightKgs: line.netWeightKgs,
            grossWeightKgs: line.grossWeightKgs,
            lineNote: line.reason || undefined,
            pickAllocations: line.pickMode === "MANUAL" && line.pickAllocations.length > 0
              ? line.pickAllocations.map((allocation) => ({
                  storageSection: allocation.storageSection,
                  containerNo: allocation.containerNo,
                  allocatedQty: allocation.allocatedQty
                }))
              : undefined
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
    void submitOutboundDocument("CONFIRMED");
  }

  async function handleConfirmInboundDocument(document: InboundDocument) {
    if (!canManage) {
      return;
    }

    setErrorMessage("");
    try {
      const updatedDocument = await api.confirmInboundDocument(document.id);
      setSelectedInboundDocument(updatedDocument);
      await onRefresh();
      showActionSuccess(t("receiptConfirmedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    }
  }

  async function handleUpdateInboundTrackingStatus(document: InboundDocument, trackingStatus: string) {
    if (!canManage) {
      return;
    }

    setErrorMessage("");
    try {
      const updatedDocument = await api.updateInboundDocumentTrackingStatus(document.id, { trackingStatus });
      setSelectedInboundDocument(updatedDocument);
      await onRefresh();
      showActionSuccess(t("receiptTrackingUpdatedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    }
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

    setErrorMessage("");
    try {
      const updatedDocument = await api.cancelInboundDocument(document.id, {
        reason: document.documentNote || undefined
      });
      setSelectedInboundDocument(updatedDocument);
      await onRefresh();
      showActionSuccess(t("receiptCancelledSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    }
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

    setErrorMessage("");
    try {
      await api.archiveInboundDocument(document.id);
      setSelectedInboundDocument(null);
      await onRefresh();
      showActionSuccess(t("receiptArchivedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotArchiveDocument"));
    }
  }

  async function handleCopyInboundDocument(document: InboundDocument) {
    if (!canManage) {
      return;
    }

    setErrorMessage("");
    try {
      const copiedDocument = await api.copyInboundDocument(document.id);
      setOptimisticInboundDocuments((current) => [copiedDocument, ...current.filter((entry) => entry.id !== copiedDocument.id)]);
      setSelectedStatus("all");
      setSelectedInboundDocument(copiedDocument);
      openEditInboundDocument(copiedDocument);
      await onRefresh();
      showActionSuccess(t("receiptCopiedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotCopyDocument"));
    }
  }

  async function handleConfirmOutboundDocument(document: OutboundDocument) {
    if (!canManage) {
      return;
    }

    setErrorMessage("");
    try {
      const updatedDocument = await api.confirmOutboundDocument(document.id);
      setSelectedOutboundDocument(updatedDocument);
      await onRefresh();
      showActionSuccess(t("shipmentConfirmedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    }
  }

  async function handleUpdateOutboundTrackingStatus(document: OutboundDocument, trackingStatus: string) {
    if (!canManage) {
      return;
    }

    setErrorMessage("");
    try {
      const updatedDocument = await api.updateOutboundDocumentTrackingStatus(document.id, { trackingStatus });
      setSelectedOutboundDocument(updatedDocument);
      await onRefresh();
      showActionSuccess(t("shipmentTrackingUpdatedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    }
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

    setErrorMessage("");
    try {
      const updatedDocument = await api.cancelOutboundDocument(document.id, {
        reason: document.documentNote || undefined
      });
      setSelectedOutboundDocument(updatedDocument);
      await onRefresh();
      showActionSuccess(t("shipmentCancelledSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveActivity"));
    }
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

    setErrorMessage("");
    try {
      await api.archiveOutboundDocument(document.id);
      setSelectedOutboundDocument(null);
      await onRefresh();
      showActionSuccess(t("shipmentArchivedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotArchiveDocument"));
    }
  }

  async function handleCopyOutboundDocument(document: OutboundDocument) {
    if (!canManage) {
      return;
    }

    setErrorMessage("");
    try {
      const copiedDocument = await api.copyOutboundDocument(document.id);
      setOptimisticOutboundDocuments((current) => [copiedDocument, ...current.filter((entry) => entry.id !== copiedDocument.id)]);
      setSelectedStatus("all");
      setSelectedOutboundDocument(copiedDocument);
      openEditOutboundDraft(copiedDocument);
      await onRefresh();
      showActionSuccess(t("shipmentCopiedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotCopyDocument"));
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
          deliveryDate: formatDate(document.deliveryDate),
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
          outDate: formatDate(document.outDate),
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
                    <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={openCreateModal}>
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
              <label>{t("status")}<select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}><option value="all">{t("allStatuses")}</option><option value="DRAFT">{t("draft")}</option><option value="CONFIRMED">{t("confirmed")}</option><option value="CANCELLED">{t("cancelled")}</option><option value="ARCHIVED">{t("archived")}</option></select></label>
            </div>
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
                  onRowClick={(params) => setSelectedInboundDocument(params.row)}
                  getRowClassName={(params) => selectedInboundDocument?.id === params.row.id ? "document-row--selected" : ""}
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
                  onRowClick={(params) => setSelectedOutboundDocument(params.row)}
                  getRowClassName={(params) => selectedOutboundDocument?.id === params.row.id ? "document-row--selected" : ""}
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
      {feedbackToast}

      {mode === "IN" ? (
        <Drawer
          anchor="right"
          open={selectedInboundDocument !== null}
          onClose={() => setSelectedInboundDocument(null)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{ className: "document-drawer" }}
        >
          {selectedInboundDocument ? (
            <div className="document-drawer__content">
              <div className="document-drawer__header">
                <div>
                  <div className="document-drawer__eyebrow">{t("documentsView")}</div>
                  <h3>{selectedInboundDocument.containerNo || t("containerNo")}</h3>
                  <p>
                    {[selectedInboundDocument.customerName || "-", formatDate(selectedInboundDocument.deliveryDate)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <IconButton aria-label={t("close")} onClick={() => setSelectedInboundDocument(null)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </div>

              <div className="document-drawer__actions">
                {canManage && !selectedInboundDocument.archivedAt && ["DRAFT", "CONFIRMED"].includes(normalizeDocumentStatus(selectedInboundDocument.status)) ? (
                  <Button variant="outlined" onClick={() => openEditInboundDocument(selectedInboundDocument)}>
                    {normalizeDocumentStatus(selectedInboundDocument.status) === "CONFIRMED" ? t("editReceipt") : t("editDraft")}
                  </Button>
                ) : null}
                {canManage ? (
                  <Button variant="outlined" startIcon={<ContentCopyOutlinedIcon />} onClick={() => void handleCopyInboundDocument(selectedInboundDocument)}>
                    {t("copyReceipt")}
                  </Button>
                ) : null}
                {canManage && !selectedInboundDocument.archivedAt && getInboundTrackingAction(selectedInboundDocument, t) ? (
                  <Button
                    variant={getInboundTrackingAction(selectedInboundDocument, t)?.trackingStatus === "RECEIVED" ? "contained" : "outlined"}
                    onClick={() => {
                      const nextAction = getInboundTrackingAction(selectedInboundDocument, t);
                      if (nextAction) {
                        void handleUpdateInboundTrackingStatus(selectedInboundDocument, nextAction.trackingStatus);
                      }
                    }}
                  >
                    {getInboundTrackingAction(selectedInboundDocument, t)?.label}
                  </Button>
                ) : null}
                {canManage && !selectedInboundDocument.archivedAt && normalizeDocumentStatus(selectedInboundDocument.status) !== "CANCELLED" ? (
                  <Button variant="outlined" color="error" startIcon={<DeleteOutlineOutlinedIcon />} onClick={() => void handleCancelInboundDocument(selectedInboundDocument)}>
                    {t("cancelReceipt")}
                  </Button>
                ) : null}
                {canManage && canArchiveInboundDocument(selectedInboundDocument) ? (
                  <Button variant="outlined" startIcon={<ArchiveOutlinedIcon />} onClick={() => void handleArchiveInboundDocument(selectedInboundDocument)}>
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
                  <span>{formatDocumentStatusAuditValue(selectedInboundDocument.status, selectedInboundDocument.archivedAt, selectedInboundDocument.cancelledAt, resolvedTimeZone, t)}</span>
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
                <div className="sheet-note"><strong>{t("deliveryDate")}</strong> {formatDate(selectedInboundDocument.deliveryDate)}</div>
                <div className="sheet-note"><strong>{t("customer")}</strong> {selectedInboundDocument.customerName || "-"}</div>
                <div className="sheet-note"><strong>{t("currentStorage")}</strong> {`${selectedInboundDocument.locationName} / ${summarizeInboundDocumentSections(selectedInboundDocument)}`}</div>
                <div className="sheet-note"><strong>{t("inboundUnit")}</strong> {selectedInboundDocument.unitLabel || "-"}</div>
                <div className="sheet-note document-drawer__meta-note"><strong>{t("documentNotes")}</strong> {selectedInboundDocument.documentNote || "-"}</div>
                <div className="sheet-note document-drawer__meta-note"><strong>{t("cancelNote")}</strong> {selectedInboundDocument.cancelNote || "-"}</div>
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
          open={selectedOutboundDocument !== null}
          onClose={() => setSelectedOutboundDocument(null)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{ className: "document-drawer" }}
        >
          {selectedOutboundDocument ? (
            <div className="document-drawer__content">
              <div className="document-drawer__header">
                <div>
                  <div className="document-drawer__eyebrow">{t("packingListsView")}</div>
                  <h3>{selectedOutboundDocument.packingListNo || t("packingListNo")}</h3>
                  <p>
                    {[selectedOutboundDocument.customerName || "-", formatDate(selectedOutboundDocument.outDate)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <IconButton aria-label={t("close")} onClick={() => setSelectedOutboundDocument(null)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </div>

              <div className="document-drawer__actions">
                {canManage && !selectedOutboundDocument.archivedAt && normalizeDocumentStatus(selectedOutboundDocument.status) === "DRAFT" ? (
                  <Button variant="outlined" onClick={() => openEditOutboundDraft(selectedOutboundDocument)}>
                    {t("editDraft")}
                  </Button>
                ) : null}
                {canManage ? (
                  <Button variant="outlined" startIcon={<ContentCopyOutlinedIcon />} onClick={() => void handleCopyOutboundDocument(selectedOutboundDocument)}>
                    {t("copyShipment")}
                  </Button>
                ) : null}
                {canManage && !selectedOutboundDocument.archivedAt && getOutboundTrackingAction(selectedOutboundDocument, t) ? (
                  <Button
                    variant={getOutboundTrackingAction(selectedOutboundDocument, t)?.trackingStatus === "SHIPPED" ? "contained" : "outlined"}
                    onClick={() => {
                      const nextAction = getOutboundTrackingAction(selectedOutboundDocument, t);
                      if (nextAction) {
                        void handleUpdateOutboundTrackingStatus(selectedOutboundDocument, nextAction.trackingStatus);
                      }
                    }}
                  >
                    {getOutboundTrackingAction(selectedOutboundDocument, t)?.label}
                  </Button>
                ) : null}
                <Button
                  variant="contained"
                  startIcon={<PictureAsPdfOutlinedIcon />}
                  onClick={() => downloadOutboundPickSheetPdfFromDocument(selectedOutboundDocument)}
                >
                  {t("downloadPickSheet")}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<PictureAsPdfOutlinedIcon />}
                  onClick={() => downloadOutboundDeliveryNotePdfFromDocument(selectedOutboundDocument)}
                >
                  {t("downloadDeliveryNote")}
                </Button>
                {canManage && !selectedOutboundDocument.archivedAt && normalizeDocumentStatus(selectedOutboundDocument.status) !== "CANCELLED" ? (
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteOutlineOutlinedIcon />}
                    onClick={() => void handleCancelOutboundDocument(selectedOutboundDocument)}
                  >
                    {t("cancelShipment")}
                  </Button>
                ) : null}
                {canManage && !selectedOutboundDocument.archivedAt ? (
                  <Button
                    variant="outlined"
                    startIcon={<ArchiveOutlinedIcon />}
                    onClick={() => void handleArchiveOutboundDocument(selectedOutboundDocument)}
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
                  <span>{formatDocumentStatusAuditValue(selectedOutboundDocument.status, selectedOutboundDocument.archivedAt, selectedOutboundDocument.cancelledAt, resolvedTimeZone, t)}</span>
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
                <div className="sheet-note"><strong>{t("outDate")}</strong> {formatDate(selectedOutboundDocument.outDate)}</div>
                <div className="sheet-note"><strong>{t("carrier")}</strong> {selectedOutboundDocument.carrierName || "-"}</div>
                <div className="sheet-note document-drawer__meta-note"><strong>{t("documentNotes")}</strong> {selectedOutboundDocument.documentNote || "-"}</div>
                <div className="sheet-note document-drawer__meta-note"><strong>{t("cancelNote")}</strong> {selectedOutboundDocument.cancelNote || "-"}</div>
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
                  <InlineAlert severity="info">{t("confirmedReceiptEditNotice")}</InlineAlert>
                ) : null}
                <div className="sheet-form sheet-form--compact">
                  <label>{t("deliveryDate")}<input type="date" value={batchForm.deliveryDate} onChange={(event) => setBatchForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
                  <label>{t("containerNo")}<input value={batchForm.containerNo} onChange={(event) => setBatchForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="MRSU8580370" /></label>
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
                          <label>{t("sku")}<input value={line.sku} onChange={(event) => updateBatchLineSku(line.id, event.target.value)} placeholder="023042" /></label>
                          <label className="batch-line-grid__description">{t("description")}<input value={selectedBatchItem ? displayDescription(selectedBatchItem) : (line.description || (batchSkuMaster ? getSKUMasterDescription(batchSkuMaster) : "") || displayDescription(batchSkuTemplate ?? { description: "", name: "" }))} onChange={(event) => updateBatchLine(line.id, { description: event.target.value })} placeholder={t("descriptionPlaceholder")} disabled={Boolean(selectedBatchItem)} /></label>
                          <label>{t("expectedQty")}<input type="number" min="0" value={numberInputValue(line.expectedQty)} onChange={(event) => updateBatchLineExpectedQty(line.id, Math.max(0, Number(event.target.value || 0)))} /></label>
                          <label>{t("received")}<input type="number" min="0" value={numberInputValue(line.receivedQty)} onChange={(event) => updateBatchLineReceivedQty(line.id, Math.max(0, Number(event.target.value || 0)))} onBlur={() => autofillBatchLineReceivedQty(line.id)} placeholder={line.expectedQty > 0 ? String(line.expectedQty) : ""} /></label>
                          <label>{t("pallets")}<input type="number" min="0" value={numberInputValue(line.pallets)} onChange={(event) => updateBatchLinePallets(line.id, Math.max(0, Number(event.target.value || 0)))} /></label>
                          <label>{t("storageSection")}<select value={normalizeStorageSection(line.storageSection || batchSectionOptions[0])} onChange={(event) => updateBatchLine(line.id, { storageSection: event.target.value })}>{batchSectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
                          <label className="batch-line-grid__detail">{t("palletsDetail")}<input value={line.palletsDetailCtns} onChange={(event) => updateBatchLine(line.id, { palletsDetailCtns: event.target.value })} placeholder="28*115+110" /></label>
                          <label>{t("reorderLevel")}<input type="number" min="0" value={numberInputValue(displayedReorderLevel)} onChange={(event) => updateBatchLine(line.id, { reorderLevel: Math.max(0, Number(event.target.value || 0)) })} placeholder={suggestedReorderLevel > 0 ? String(suggestedReorderLevel) : ""} disabled={Boolean(selectedBatchItem)} /></label>
                        </div>
                        <div className="batch-line-card__meta">
                          <span className="batch-line-card__hint">
                            {selectedBatchItem
                              ? `${selectedBatchItem.customerName} | ${selectedBatchItem.sku} | ${selectedBatchItem.locationName}`
                              : (line.sku.trim() ? line.sku.trim().toUpperCase() : t("noSkuSelected"))}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                </div>

                <div className="sheet-form__actions" style={{ marginTop: "1rem" }}>
                  {!isEditingConfirmedInbound ? (
                    <button className="button button--ghost" type="button" disabled={batchSubmitting} onClick={() => void submitInboundDocument("DRAFT")}>{batchSubmitting ? t("saving") : isEditingInboundDraft ? t("saveChanges") : t("scheduleReceipt")}</button>
                  ) : null}
                  <button className="button button--primary" type="submit" disabled={batchSubmitting}>{batchSubmitting ? t("saving") : isEditingConfirmedInbound ? t("saveChanges") : t("confirmReceipt")}</button>
                  <button className="button button--ghost" type="button" onClick={closeBatchModal}>{t("cancel")}</button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleBatchOutboundSubmit}>
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
                  <label>{t("outDate")}<input type="date" value={batchOutboundForm.outDate} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, outDate: event.target.value }))} /></label>
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
                          />
                        </label>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<AddCircleOutlineOutlinedIcon />}
                          onClick={() => addBatchOutboundLine()}
                        >
                          {t("addOutboundLine")}
                        </Button>
                      </div>
                    ) : (
                      <span className="batch-line-card__hint">{t("pickPlanStepHint")}</span>
                    )}
                  </div>

                  {batchOutboundLines.map((line, index) => {
                    const selectedOutboundSource = findOutboundSourceOption(selectableOutboundSources, Number(line.itemId));

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
                              value={line.itemId}
                              onChange={(event) => {
                                const nextItem = findOutboundSourceOption(selectableOutboundSources, Number(event.target.value));
                                setBatchOutboundLines((current) => current.map((currentLine) =>
                                  currentLine.id === line.id ? buildOutboundLineDefaults(currentLine, nextItem) : currentLine
                                ));
                              }}
                            >
                              <option value="">{t("selectShipmentSource")}</option>
                              {selectableOutboundSources.map((item) => (
                              <option key={item.id} value={item.id}>
                                  {`${item.customerName} | ${item.locationName} / ${item.storageSections.join(", ") || DEFAULT_STORAGE_SECTION} | ${t("containers")}: ${item.containerCount} | ${t("itemNumber")}: ${item.itemNumber || "-"} | ${item.sku} - ${item.description} (${t("availableQty")}: ${item.availableQty})`}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>{t("availableQty")}<input value={selectedOutboundSource ? String(selectedOutboundSource.availableQty) : ""} readOnly /></label>
                          <label>{t("outQty")}<input type="number" min="0" value={numberInputValue(line.quantity)} onChange={(event) => updateBatchOutboundLineQuantity(line.id, Math.max(0, Number(event.target.value || 0)))} /></label>
                          <label>{t("pallets")}<input type="number" min="0" value={numberInputValue(line.pallets)} onChange={(event) => updateBatchOutboundLine(line.id, { pallets: Math.max(0, Number(event.target.value || 0)) })} /></label>
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
                              ? `${selectedOutboundSource.customerName} | ${t("itemNumber")}: ${selectedOutboundSource.itemNumber || "-"} | ${selectedOutboundSource.sku} | ${selectedOutboundSource.description} | ${selectedOutboundSource.locationName} / ${selectedOutboundSource.storageSections.join(", ") || DEFAULT_STORAGE_SECTION} | ${t("containerDistribution")}: ${selectedOutboundSource.containerSummary || "-"} | ${t("availableQty")}: ${selectedOutboundSource.availableQty}`
                              : t("selectShipmentSource")}
                          </span>
                        </div>
                        {selectedOutboundSource && outboundWizardStep === 2 ? (
                          <div className="batch-line-pick-plan">
                            <div className="batch-line-pick-summary">
                              <div className="batch-line-pick-summary__stats">
                                <div className="batch-line-pick-summary__stat">
                                  <span>{t("requiredQty")}</span>
                                  <strong>{line.quantity}</strong>
                                </div>
                                <div className="batch-line-pick-summary__stat">
                                  <span>{t("selectedQty")}</span>
                                  <strong>{batchOutboundAllocationPreview.summaries.get(line.id)?.allocatedQty ?? 0}</strong>
                                </div>
                                <div className="batch-line-pick-summary__stat">
                                  <span>{t("remainingQty")}</span>
                                  <strong>{batchOutboundAllocationPreview.summaries.get(line.id)?.shortageQty ?? 0}</strong>
                                </div>
                              </div>
                              <div className="batch-line-pick-summary__mode">
                                <button
                                  type="button"
                                  className={`batch-line-pick-summary__mode-button ${line.pickMode === "AUTO" ? "batch-line-pick-summary__mode-button--active" : ""}`}
                                  onClick={() => updateBatchOutboundPickMode(line.id, "AUTO")}
                                >
                                  {t("autoPick")}
                                </button>
                                <button
                                  type="button"
                                  className={`batch-line-pick-summary__mode-button ${line.pickMode === "MANUAL" ? "batch-line-pick-summary__mode-button--active" : ""}`}
                                  onClick={() => updateBatchOutboundPickMode(line.id, "MANUAL")}
                                >
                                  {t("manualPick")}
                                </button>
                              </div>
                            </div>
                            <div className="batch-line-pick-plan__header">
                              <div>
                                <strong>{t("containerPickPlan")}</strong>
                                <span>{line.pickMode === "MANUAL" ? t("containerPickPlanHint") : t("pickPlanAutoModeHint")}</span>
                              </div>
                              <span className="batch-line-pick-plan__auto-hint">{line.pickMode === "MANUAL" ? t("manualPick") : t("autoPick")}</span>
                            </div>
                            {line.pickMode === "MANUAL" ? (
                              <div className="batch-line-pick-plan__rows">
                                {selectedOutboundSource.candidates.map((candidate) => {
                                  const requestedAllocation = line.pickAllocations.find((allocation) =>
                                    buildOutboundAllocationKey(allocation.storageSection, allocation.containerNo)
                                    === buildOutboundAllocationKey(candidate.storageSection, candidate.containerNo)
                                  );

                                  return (
                                    <div className="batch-line-pick-plan__row" key={`${line.id}-${candidate.id}`}>
                                      <div className="batch-line-pick-plan__location">
                                        <strong>{candidate.containerNo || `${candidate.locationName}/${normalizeStorageSection(candidate.storageSection)}`}</strong>
                                        <span>{candidate.locationName} / {normalizeStorageSection(candidate.storageSection)}</span>
                                      </div>
                                      <div className="batch-line-pick-plan__available">
                                        <span>{t("availableQty")}</span>
                                        <strong>{candidate.availableQty}</strong>
                                      </div>
                                      <label className="batch-line-pick-plan__input">
                                        <span>{t("pickQty")}</span>
                                        <input
                                          type="number"
                                          min="0"
                                          max={candidate.availableQty}
                                          value={numberInputValue(requestedAllocation?.allocatedQty ?? 0)}
                                          onChange={(event) => updateBatchOutboundLinePickAllocation(
                                            line.id,
                                            normalizeStorageSection(candidate.storageSection),
                                            candidate.containerNo || "",
                                            Math.max(0, Number(event.target.value || 0))
                                          )}
                                        />
                                      </label>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="sheet-note sheet-note--readonly">{t("pickPlanAutoModeHint")}</div>
                            )}
                          </div>
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

                <div className="sheet-form__actions" style={{ marginTop: "1rem" }}>
                  <button className="button button--ghost" type="button" disabled={batchSubmitting || (!isEditingOutboundDraft && availableOutboundSources.length === 0)} onClick={() => void submitOutboundDocument("DRAFT")}>{batchSubmitting ? t("saving") : isEditingOutboundDraft ? t("saveChanges") : t("scheduleShipment")}</button>
                  <div className="shipment-wizard__actions">
                    {outboundWizardStep > 1 ? (
                      <button className="button button--ghost" type="button" onClick={() => moveOutboundWizardStep((outboundWizardStep - 1) as OutboundWizardStep)}>{t("back")}</button>
                    ) : null}
                    {outboundWizardStep < 3 ? (
                      <button className="button button--primary" type="button" onClick={() => moveOutboundWizardStep((outboundWizardStep + 1) as OutboundWizardStep)}>{t("next")}</button>
                    ) : (
                      <button className="button button--primary" type="submit" disabled={batchSubmitting || (!isEditingOutboundDraft && availableOutboundSources.length === 0)}>{batchSubmitting ? t("saving") : t("confirmShipment")}</button>
                    )}
                  </div>
                  <button className="button button--ghost" type="button" onClick={closeBatchModal}>{t("cancel")}</button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
      {confirmationDialog}
    </main>
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
    && normalizeDocumentStatus(document.status) !== "CANCELLED"
    && normalizeContainerNo(document.containerNo)
  );

  const exact = candidateDocuments
    .filter((document) => normalizeContainerNo(document.containerNo) === normalizedValue)
    .map((document) => ({
      documentId: document.id,
      containerNo: normalizeContainerNo(document.containerNo),
      customerName: document.customerName || "-",
      dateLabel: formatDate(document.deliveryDate || document.createdAt || ""),
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
      dateLabel: formatDate(document.deliveryDate || document.createdAt || ""),
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

  if (normalizedStatus === "CANCELLED") {
    return <Chip label={t("cancelled")} color="error" size="small" />;
  }

  if (normalizedStatus === "CONFIRMED") {
    return <Chip label={t("confirmed")} color="success" size="small" />;
  }

  return <Chip label={t("draft")} color="default" size="small" />;
}

function formatDocumentStatusAuditValue(
  status: string,
  archivedAt: string | null | undefined,
  cancelledAt: string | null | undefined,
  resolvedTimeZone: string,
  t: (key: string) => string
) {
  if (archivedAt) {
    return `${t("archived")} | ${formatDateTimeValue(archivedAt, resolvedTimeZone)}`;
  }
  if (cancelledAt) {
    return `${status} | ${formatDateTimeValue(cancelledAt, resolvedTimeZone)}`;
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

function buildOutboundAllocationKey(storageSection: string, containerNo: string) {
  return `${normalizeStorageSection(storageSection)}|${containerNo.trim().toUpperCase()}`;
}

function normalizeBatchOutboundPickAllocations(allocations: BatchOutboundLineAllocationState[]) {
  const normalized: BatchOutboundLineAllocationState[] = [];
  const allocationIndexByKey = new Map<string, number>();

  for (const allocation of allocations) {
    const normalizedStorageSection = normalizeStorageSection(allocation.storageSection);
    const normalizedContainerNo = allocation.containerNo.trim().toUpperCase();
    const normalizedQty = Math.max(0, Math.trunc(allocation.allocatedQty));
    if (normalizedQty <= 0) {
      continue;
    }

    const allocationKey = buildOutboundAllocationKey(normalizedStorageSection, normalizedContainerNo);
    const existingIndex = allocationIndexByKey.get(allocationKey);
    if (existingIndex !== undefined) {
      normalized[existingIndex] = {
        ...normalized[existingIndex],
        allocatedQty: normalized[existingIndex].allocatedQty + normalizedQty
      };
      continue;
    }

    allocationIndexByKey.set(allocationKey, normalized.length);
    normalized.push({
      storageSection: normalizedStorageSection,
      containerNo: normalizedContainerNo,
      allocatedQty: normalizedQty
    });
  }

  return normalized;
}

function areOutboundPickAllocationsEqual(
  left: BatchOutboundLineAllocationState[],
  right: BatchOutboundLineAllocationState[]
) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftAllocation = left[index];
    const rightAllocation = right[index];
    if (
      buildOutboundAllocationKey(leftAllocation.storageSection, leftAllocation.containerNo)
      !== buildOutboundAllocationKey(rightAllocation.storageSection, rightAllocation.containerNo)
      || leftAllocation.allocatedQty !== rightAllocation.allocatedQty
    ) {
      return false;
    }
  }

  return true;
}

function buildOutboundAllocationPreview(lines: BatchOutboundLineState[], sourceOptions: OutboundSourceOption[]): OutboundAllocationPreviewResult {
  const reservedByItemId = new Map<number, number>();
  const reservedBySourceId = new Map<string, number>();
  const rows: OutboundAllocationPreviewRow[] = [];
  const summaries = new Map<string, OutboundAllocationLineSummary>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const itemId = Number(line.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0 || line.quantity <= 0) {
      continue;
    }

    const selectedSource = findOutboundSourceOption(sourceOptions, itemId);
    if (!selectedSource) {
      continue;
    }

    const summary: OutboundAllocationLineSummary = {
      lineId: line.id,
      lineLabel: `#${index + 1}`,
      itemId: selectedSource.id,
      itemNumber: selectedSource.itemNumber || "",
      sku: selectedSource.sku,
      description: selectedSource.description,
      locationName: selectedSource.locationName,
      storageSection: selectedSource.storageSections[0] || DEFAULT_STORAGE_SECTION,
      requestedQty: line.quantity,
      allocatedQty: 0,
      shortageQty: 0,
      containerCount: 0,
      hasManualAllocations: line.pickMode === "MANUAL" && line.pickAllocations.length > 0,
      manualAllocatedQty: line.pickAllocations.reduce((sum, allocation) => sum + allocation.allocatedQty, 0)
    };

    const availableByItemId = new Map<number, number>();
    for (const candidate of selectedSource.candidates) {
      availableByItemId.set(candidate.itemId, (availableByItemId.get(candidate.itemId) ?? 0) + candidate.availableQty);
    }

    let remainingQty = line.quantity;
    const manualAllocations = normalizeBatchOutboundPickAllocations(line.pickAllocations);

    if (line.pickMode === "MANUAL" && manualAllocations.length > 0) {
      for (const manualAllocation of manualAllocations) {
        const candidate = selectedSource.candidates.find((candidateOption) =>
          buildOutboundAllocationKey(candidateOption.storageSection, candidateOption.containerNo)
          === buildOutboundAllocationKey(manualAllocation.storageSection, manualAllocation.containerNo)
        );
        if (!candidate) {
          continue;
        }

        const sourceId = `${candidate.itemId}|${candidate.storageSection}|${candidate.containerNo}`;
        const sourceRemaining = candidate.availableQty - (reservedBySourceId.get(sourceId) ?? 0);
        const itemRemaining = (availableByItemId.get(candidate.itemId) ?? 0) - (reservedByItemId.get(candidate.itemId) ?? 0);
        const effectiveAvailable = Math.min(sourceRemaining, itemRemaining);
        const allocatedQty = Math.min(effectiveAvailable, manualAllocation.allocatedQty);
        if (allocatedQty <= 0) {
          continue;
        }

        rows.push({
          id: `${line.id}-${candidate.id}`,
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
        reservedByItemId.set(candidate.itemId, (reservedByItemId.get(candidate.itemId) ?? 0) + allocatedQty);
        summary.allocatedQty += allocatedQty;
      }
      remainingQty = Math.max(0, line.quantity - summary.allocatedQty);
    } else {
      for (const candidate of selectedSource.candidates) {
        const sourceId = `${candidate.itemId}|${candidate.storageSection}|${candidate.containerNo}`;
        const sourceRemaining = candidate.availableQty - (reservedBySourceId.get(sourceId) ?? 0);
        const itemRemaining = (availableByItemId.get(candidate.itemId) ?? 0) - (reservedByItemId.get(candidate.itemId) ?? 0);
        const effectiveAvailable = Math.min(sourceRemaining, itemRemaining);
        if (effectiveAvailable <= 0) {
          continue;
        }

        const allocatedQty = Math.min(effectiveAvailable, remainingQty);
        if (allocatedQty <= 0) {
          continue;
        }

        rows.push({
          id: `${line.id}-${candidate.id}`,
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
        reservedByItemId.set(candidate.itemId, (reservedByItemId.get(candidate.itemId) ?? 0) + allocatedQty);
        summary.allocatedQty += allocatedQty;
        remainingQty -= allocatedQty;

        if (remainingQty === 0) {
          break;
        }
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

function findOutboundSourceOption(sourceOptions: OutboundSourceOption[], itemId: number) {
  return sourceOptions.find((sourceOption) =>
    sourceOption.id === itemId || sourceOption.candidates.some((candidate) => candidate.itemId === itemId)
  );
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

function buildOutboundSourceOptions(items: Item[], movements: Movement[]): OutboundSourceOption[] {
  const containerBalances = buildItemContainerBalances(items, movements);
  const grouped = new Map<string, { representative: Item; items: Item[] }>();

  for (const item of [...items].sort(compareOutboundAllocationCandidates)) {
    const key = `${item.customerId}:${item.locationId}:${item.sku.trim().toUpperCase()}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { representative: item, items: [item] });
      continue;
    }

    existing.items.push(item);
  }

  return [...grouped.values()].map(({ representative, items: sourceItems }) => {
    const sourceItemIds = new Set(sourceItems.map((item) => item.id));
    const candidates = containerBalances.filter((balance) => sourceItemIds.has(balance.itemId));
    const sourceItemWithNumber = sourceItems.find((item) => item.itemNumber.trim());
    const sourceItemWithDescription = sourceItems.find((item) => displayDescription(item).trim());
    const sourceItemNumber = sourceItemWithNumber?.itemNumber || "";
    const sourceDescription = sourceItemWithDescription ? displayDescription(sourceItemWithDescription) : displayDescription(representative);
    const sourceUnit = sourceItems.find((item) => item.unit.trim())?.unit || representative.unit;
    const sections = new Set<string>();
    let availableQty = 0;

    for (const candidate of candidates) {
      availableQty += candidate.availableQty;
      if (candidate.storageSection) {
        sections.add(candidate.storageSection);
      }
    }

    return {
      id: representative.id,
      customerId: representative.customerId,
      customerName: representative.customerName,
      locationId: representative.locationId,
      locationName: representative.locationName,
      sku: representative.sku,
      itemNumber: sourceItemNumber,
      description: sourceDescription,
      unit: sourceUnit,
      availableQty,
      storageSections: [...sections].sort(),
      containerCount: new Set(candidates.map((candidate) => candidate.containerNo || `${candidate.locationName}/${normalizeStorageSection(candidate.storageSection)}`)).size,
      containerSummary: formatContainerDistributionSummaryValue(candidates),
      candidates
    };
  }).sort((left, right) => {
    const customerCompare = left.customerName.localeCompare(right.customerName);
    if (customerCompare !== 0) return customerCompare;
    const locationCompare = left.locationName.localeCompare(right.locationName);
    if (locationCompare !== 0) return locationCompare;
    return left.sku.localeCompare(right.sku);
  });
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
