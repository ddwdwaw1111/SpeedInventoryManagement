import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { type FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { RowActionsMenu } from "./RowActionsMenu";
import { formatDateTimeValue, formatDateValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { downloadOutboundPackingListPdfFromDocument } from "../lib/outboundPackingListPdf";
import type { Customer, InboundDocument, InboundDocumentPayload, Item, Location, Movement, OutboundDocument, OutboundDocumentPayload, UserRole } from "../lib/types";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";

type ActivityMode = "IN" | "OUT";

type ActivityManagementPageProps = {
  mode: ActivityMode;
  items: Item[];
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
  documentNote: string;
};

type BatchInboundLineState = {
  id: string;
  sku: string;
  description: string;
  reorderLevel: number;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  palletsDetailCtns: string;
};

type BatchOutboundFormState = {
  packingListNo: string;
  orderRef: string;
  outDate: string;
  documentNote: string;
};

type BatchOutboundLineState = {
  id: string;
  itemId: string;
  quantity: number;
  unitLabel: string;
  cartonSizeMm: string;
  netWeightKgs: number;
  grossWeightKgs: number;
  reason: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function createEmptyBatchInboundForm(): BatchInboundFormState {
  return {
    deliveryDate: "",
    containerNo: "",
    customerId: "",
    locationId: "",
    storageSection: "A",
    unitLabel: "CTN",
    documentNote: ""
  };
}

function createEmptyBatchInboundLine(): BatchInboundLineState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku: "",
    description: "",
    reorderLevel: 0,
    expectedQty: 0,
    receivedQty: 0,
    pallets: 0,
    palletsDetailCtns: ""
  };
}

function createEmptyBatchOutboundForm(): BatchOutboundFormState {
  return {
    packingListNo: "",
    orderRef: "",
    outDate: "",
    documentNote: ""
  };
}

function createEmptyBatchOutboundLine(): BatchOutboundLineState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemId: "",
    quantity: 0,
    unitLabel: "PCS",
    cartonSizeMm: "",
    netWeightKgs: 0,
    grossWeightKgs: 0,
    reason: ""
  };
}

function getSuggestedPalletsDetail(totalQty: number, pallets: number) {
  if (totalQty <= 0 || pallets <= 0) return "";
  if (pallets === 1) return String(totalQty);

  const cartonsPerFullPallet = Math.ceil(totalQty / pallets);
  const remainingCartons = totalQty - (pallets - 1) * cartonsPerFullPallet;
  if (remainingCartons <= 0) return `${pallets}*${Math.floor(totalQty / pallets)}`;

  return `${pallets - 1}*${cartonsPerFullPallet}+${remainingCartons}`;
}

export function ActivityManagementPage({ mode, items, locations, customers, inboundDocuments, outboundDocuments, currentUserRole, isLoading, onRefresh }: ActivityManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [errorMessage, setErrorMessage] = useState("");
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchForm, setBatchForm] = useState<BatchInboundFormState>(() => createEmptyBatchInboundForm());
  const [batchLines, setBatchLines] = useState<BatchInboundLineState[]>(() => [createEmptyBatchInboundLine()]);
  const [batchOutboundForm, setBatchOutboundForm] = useState<BatchOutboundFormState>(() => createEmptyBatchOutboundForm());
  const [batchOutboundLines, setBatchOutboundLines] = useState<BatchOutboundLineState[]>(() => [createEmptyBatchOutboundLine()]);
  const [selectedInboundDocument, setSelectedInboundDocument] = useState<InboundDocument | null>(null);
  const [selectedOutboundDocument, setSelectedOutboundDocument] = useState<OutboundDocument | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const pendingBatchLineIDRef = useRef<string | null>(null);
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const pageDescription = mode === "IN" ? t("inboundDesc") : t("outboundDesc");
  const permissionNotice = canManage ? "" : t("readOnlyModeNotice");

  useEffect(() => {
    setIsBatchModalOpen(false);
    setBatchOutboundForm(createEmptyBatchOutboundForm());
    setBatchOutboundLines([createEmptyBatchOutboundLine()]);
    setSelectedInboundDocument(null);
    setSelectedOutboundDocument(null);
  }, [mode]);

  useEffect(() => {
    if (mode !== "OUT" || !selectedOutboundDocument) {
      return;
    }

    const nextSelectedDocument = outboundDocuments.find((document) => document.id === selectedOutboundDocument.id) ?? null;
    if (!nextSelectedDocument) {
      setSelectedOutboundDocument(null);
      return;
    }

    if (nextSelectedDocument !== selectedOutboundDocument) {
      setSelectedOutboundDocument(nextSelectedDocument);
    }
  }, [mode, outboundDocuments, selectedOutboundDocument]);

  useEffect(() => {
    if (mode !== "IN" || !selectedInboundDocument) {
      return;
    }

    const nextSelectedDocument = inboundDocuments.find((document) => document.id === selectedInboundDocument.id) ?? null;
    if (!nextSelectedDocument) {
      setSelectedInboundDocument(null);
      return;
    }

    if (nextSelectedDocument !== selectedInboundDocument) {
      setSelectedInboundDocument(nextSelectedDocument);
    }
  }, [inboundDocuments, mode, selectedInboundDocument]);

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
  const batchSectionOptions = getLocationSectionOptions(batchLocation);
  const availableOutboundItems = useMemo(
    () => items.filter((item) => item.quantity > 0).sort((left, right) => {
      const customerCompare = left.customerName.localeCompare(right.customerName);
      if (customerCompare !== 0) return customerCompare;
      const locationCompare = left.locationName.localeCompare(right.locationName);
      if (locationCompare !== 0) return locationCompare;
      return left.sku.localeCompare(right.sku);
    }),
    [items]
  );
  useEffect(() => {
    const fallbackSection = batchSectionOptions[0] || "A";
    if (!batchSectionOptions.includes(batchForm.storageSection)) {
      setBatchForm((current) => ({ ...current, storageSection: fallbackSection }));
    }
  }, [batchForm.storageSection, batchSectionOptions]);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const inboundDocumentRows = useMemo(() => {
    if (mode !== "IN") return [];

    return inboundDocuments.filter((document) => {
      const searchBlob = [
        document.customerName,
        document.locationName,
        document.containerNo,
        document.documentNote,
        ...document.lines.flatMap((line) => [line.sku, line.description, line.lineNote])
      ].join(" ").toLowerCase();
      const matchesSearch = normalizedSearch.length === 0 || searchBlob.includes(normalizedSearch);
      const matchesCustomer = selectedCustomerId === "all" || document.customerId === Number(selectedCustomerId);
      const matchesLocation = selectedLocationId === "all" || document.locationId === Number(selectedLocationId);
      return matchesSearch && matchesCustomer && matchesLocation;
    }).sort((left, right) => {
      const leftDate = left.deliveryDate ?? left.createdAt ?? "";
      const rightDate = right.deliveryDate ?? right.createdAt ?? "";
      return rightDate.localeCompare(leftDate);
    });
  }, [inboundDocuments, mode, normalizedSearch, selectedCustomerId, selectedLocationId]);
  const outboundDocumentRows = useMemo(() => {
    if (mode !== "OUT") return [];

    return outboundDocuments.filter((document) => {
      const searchBlob = [
        document.packingListNo,
        document.orderRef,
        document.customerName,
        document.documentNote,
        document.storages,
        ...document.lines.flatMap((line) => [line.sku, line.description, line.locationName, line.lineNote])
      ].join(" ").toLowerCase();
      const matchesSearch = normalizedSearch.length === 0 || searchBlob.includes(normalizedSearch);
      const matchesCustomer = selectedCustomerId === "all" || document.customerId === Number(selectedCustomerId);
      const matchesLocation = selectedLocationId === "all"
        || document.lines.some((line) =>
          line.locationId === Number(selectedLocationId)
          || locations.find((location) => location.id === Number(selectedLocationId))?.name === line.locationName
        );
      return matchesSearch && matchesCustomer && matchesLocation;
    }).sort((left, right) => {
      const leftDate = left.outDate ?? left.createdAt ?? "";
      const rightDate = right.outDate ?? right.createdAt ?? "";
      return rightDate.localeCompare(leftDate);
    });
  }, [locations, mode, normalizedSearch, outboundDocuments, selectedCustomerId, selectedLocationId]);
  const hasActiveFilters = normalizedSearch.length > 0 || selectedCustomerId !== "all" || selectedLocationId !== "all";
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
    { field: "locationName", headerName: t("currentStorage"), minWidth: 180, flex: 1, renderCell: (params) => `${params.row.locationName} / ${params.row.storageSection || "A"}` },
    { field: "totalLines", headerName: t("totalLines"), minWidth: 100, type: "number" },
    { field: "totalExpectedQty", headerName: t("expectedQty"), minWidth: 120, type: "number" },
    { field: "totalReceivedQty", headerName: t("received"), minWidth: 110, type: "number" },
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
            { key: "details", label: t("details"), icon: <VisibilityOutlinedIcon fontSize="small" />, onClick: () => setSelectedInboundDocument(params.row) }
          ]}
        />
      )
    }
  ], [t]);

  const inboundDocumentDetailColumns = useMemo<GridColDef<InboundDocument["lines"][number]>[]>(() => [
    { field: "sku", headerName: t("sku"), minWidth: 110, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 260, flex: 1.4, renderCell: (params) => params.row.description || "-" },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 100, renderCell: (params) => params.row.storageSection || "A" },
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
            { key: "download-pdf", label: t("downloadPdf"), icon: <PictureAsPdfOutlinedIcon fontSize="small" />, onClick: () => downloadOutboundPackingListPdfFromDocument(params.row) },
            ...(canManage && params.row.status !== "CANCELLED"
              ? [{ key: "cancel", label: t("cancelShipment"), icon: <DeleteOutlineOutlinedIcon fontSize="small" />, danger: true, onClick: () => void handleCancelOutboundDocument(params.row) }]
              : [])
          ]}
        />
      )
    }
  ], [canManage, t]);

  const outboundDocumentDetailColumns = useMemo<GridColDef<OutboundDocument["lines"][number]>[]>(() => [
    { field: "sku", headerName: t("sku"), minWidth: 110, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 240, flex: 1.4, renderCell: (params) => params.row.description },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 150, flex: 1, renderCell: (params) => `${params.row.locationName} / ${params.row.storageSection || "A"}` },
    { field: "quantity", headerName: t("outQty"), minWidth: 90, type: "number", renderCell: (params) => params.row.quantity || "-" },
    { field: "unitLabel", headerName: t("unit"), minWidth: 80, renderCell: (params) => params.row.unitLabel || "-" },
    { field: "cartonSizeMm", headerName: t("cartonSize"), minWidth: 140, renderCell: (params) => <span className="cell--mono">{params.row.cartonSizeMm || "-"}</span> },
    { field: "netWeightKgs", headerName: t("netWeight"), minWidth: 100, type: "number", renderCell: (params) => params.row.netWeightKgs ? params.row.netWeightKgs.toFixed(2) : "-" },
    { field: "grossWeightKgs", headerName: t("grossWeight"), minWidth: 100, type: "number", renderCell: (params) => params.row.grossWeightKgs ? params.row.grossWeightKgs.toFixed(2) : "-" },
    { field: "lineNote", headerName: t("internalNotes"), minWidth: 220, flex: 1.1, renderCell: (params) => params.row.lineNote || "-" }
  ], [t]);

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
    setBatchForm({
      ...createEmptyBatchInboundForm(),
      customerId: customers[0] ? String(customers[0].id) : "",
      locationId: locations[0] ? String(locations[0].id) : ""
    });
    pendingBatchLineIDRef.current = null;
    setBatchLines([createEmptyBatchInboundLine()]);
    setErrorMessage("");
    setIsBatchModalOpen(true);
  }

  function openOutboundBatchModal() {
    if (!canManage) {
      return;
    }
    if (availableOutboundItems.length === 0) {
      setErrorMessage(t("noAvailableStockRows"));
      return;
    }
    setBatchOutboundForm(createEmptyBatchOutboundForm());
    setBatchOutboundLines([createEmptyBatchOutboundLine()]);
    setErrorMessage("");
    setIsBatchModalOpen(true);
  }

  function closeBatchModal() {
    setBatchForm({
      ...createEmptyBatchInboundForm(),
      customerId: customers[0] ? String(customers[0].id) : "",
      locationId: locations[0] ? String(locations[0].id) : ""
    });
    pendingBatchLineIDRef.current = null;
    setBatchLines([createEmptyBatchInboundLine()]);
    setBatchSubmitting(false);
    setBatchOutboundForm(createEmptyBatchOutboundForm());
    setBatchOutboundLines([createEmptyBatchOutboundLine()]);
    setErrorMessage("");
    setIsBatchModalOpen(false);
  }

  function addBatchLine() {
    const nextLine = createEmptyBatchInboundLine();
    pendingBatchLineIDRef.current = nextLine.id;
    setBatchLines((current) => [...current, nextLine]);
  }

  function removeBatchLine(lineID: string) {
    setBatchLines((current) => current.length === 1 ? current : current.filter((line) => line.id !== lineID));
  }

  function updateBatchLine(lineID: string, updates: Partial<BatchInboundLineState>) {
    setBatchLines((current) => current.map((line) => line.id === lineID ? { ...line, ...updates } : line));
  }

  function addBatchOutboundLine() {
    setBatchOutboundLines((current) => [...current, createEmptyBatchOutboundLine()]);
  }

  function removeBatchOutboundLine(lineID: string) {
    setBatchOutboundLines((current) => current.length === 1 ? current : current.filter((line) => line.id !== lineID));
  }

  function updateBatchOutboundLine(lineID: string, updates: Partial<BatchOutboundLineState>) {
    setBatchOutboundLines((current) => current.map((line) => line.id === lineID ? { ...line, ...updates } : line));
  }

  async function handleBatchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      const payload: InboundDocumentPayload = {
        customerId: batchCustomerId,
        locationId: batchLocationId,
        deliveryDate: batchForm.deliveryDate || undefined,
        containerNo: batchForm.containerNo || undefined,
        storageSection: batchForm.storageSection || "A",
        unitLabel: batchForm.unitLabel || "CTN",
        documentNote: batchForm.documentNote || undefined,
        lines: validLines.map((line) => {
          const normalizedSku = line.sku.trim().toUpperCase();
          const matchingTemplate = items.find((item) => item.sku.trim().toUpperCase() === normalizedSku);
          const lineDescription = line.description.trim() || displayDescription(matchingTemplate ?? { description: "", name: "" });

          if (!matchingTemplate && !lineDescription) {
            throw new Error(t("batchInboundMissingNewSkuDetails", { sku: normalizedSku || "-" }));
          }

          return {
            sku: normalizedSku,
            description: lineDescription,
            reorderLevel: line.reorderLevel || matchingTemplate?.reorderLevel || 0,
            expectedQty: line.expectedQty,
            receivedQty: line.receivedQty,
            pallets: line.pallets,
            palletsDetailCtns: line.palletsDetailCtns || undefined,
            storageSection: batchForm.storageSection || "A"
          };
        })
      };

      await api.createInboundDocument(payload);
      closeBatchModal();
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveActivity"));
    } finally {
      setBatchSubmitting(false);
    }
  }

  async function handleBatchOutboundSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBatchSubmitting(true);
    setErrorMessage("");

    const validLines = batchOutboundLines.filter((line) => Number(line.itemId) > 0 && line.quantity > 0);
    if (validLines.length === 0) {
      setErrorMessage(t("batchOutboundRequireLine"));
      setBatchSubmitting(false);
      return;
    }

    const requestedByItemId = new Map<number, number>();
    for (const line of validLines) {
      const itemId = Number(line.itemId);
      const selectedOutboundItem = items.find((item) => item.id === itemId);
      if (!selectedOutboundItem) {
        setErrorMessage(t("chooseSkuAndQty"));
        setBatchSubmitting(false);
        return;
      }

      const requestedQty = (requestedByItemId.get(itemId) ?? 0) + line.quantity;
      requestedByItemId.set(itemId, requestedQty);
      if (requestedQty > selectedOutboundItem.quantity) {
        setErrorMessage(t("outboundQtyExceedsStock", {
          sku: selectedOutboundItem.sku,
          available: selectedOutboundItem.quantity
        }));
        setBatchSubmitting(false);
        return;
      }
    }

    try {
      const payload: OutboundDocumentPayload = {
        packingListNo: batchOutboundForm.packingListNo || undefined,
        orderRef: batchOutboundForm.orderRef || undefined,
        outDate: batchOutboundForm.outDate || undefined,
        documentNote: batchOutboundForm.documentNote || undefined,
        lines: validLines.map((line) => {
          const itemId = Number(line.itemId);
          const selectedOutboundItem = items.find((item) => item.id === itemId);
          if (!selectedOutboundItem) {
            throw new Error(t("chooseSkuAndQty"));
          }

          return {
            itemId,
            quantity: line.quantity,
            unitLabel: line.unitLabel || selectedOutboundItem.unit.toUpperCase() || "PCS",
            cartonSizeMm: line.cartonSizeMm || undefined,
            netWeightKgs: line.netWeightKgs,
            grossWeightKgs: line.grossWeightKgs,
            lineNote: line.reason || undefined
          };
        })
      };

      await api.createOutboundDocument(payload);

      closeBatchModal();
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveActivity"));
    } finally {
      setBatchSubmitting(false);
    }
  }

  async function handleCancelOutboundDocument(document: OutboundDocument) {
    if (!canManage) {
      return;
    }

    if (!window.confirm(t("cancelOutboundConfirm", { packingListNo: document.packingListNo || String(document.id) }))) {
      return;
    }

    setErrorMessage("");
    try {
      await api.cancelOutboundDocument(document.id, {
        reason: document.documentNote || undefined
      });
      if (selectedOutboundDocument?.id === document.id) {
        setSelectedOutboundDocument(null);
      }
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveActivity"));
    }
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
              <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={mode === "IN" ? t("searchInboundPlaceholder") : t("searchOutboundPlaceholder")} /></label>
              <label>{t("customer")}<select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}><option value="all">{t("allCustomers")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
              <label>{t("currentStorage")}<select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}><option value="all">{t("allStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
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

              <div className="document-drawer__status-bar">
                <div className="document-drawer__status-main">
                  {renderDocumentStatus(selectedInboundDocument.status, t)}
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
                  <span>{selectedInboundDocument.status}</span>
                </div>
              </div>

              <div className="document-drawer__meta">
                <div className="sheet-note"><strong>{t("deliveryDate")}</strong> {formatDate(selectedInboundDocument.deliveryDate)}</div>
                <div className="sheet-note"><strong>{t("customer")}</strong> {selectedInboundDocument.customerName || "-"}</div>
                <div className="sheet-note"><strong>{t("currentStorage")}</strong> {`${selectedInboundDocument.locationName} / ${selectedInboundDocument.storageSection || "A"}`}</div>
                <div className="sheet-note"><strong>{t("inboundUnit")}</strong> {selectedInboundDocument.unitLabel || "-"}</div>
                <div className="sheet-note document-drawer__meta-note"><strong>{t("documentNotes")}</strong> {selectedInboundDocument.documentNote || "-"}</div>
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
                <Button
                  variant="contained"
                  startIcon={<PictureAsPdfOutlinedIcon />}
                  onClick={() => downloadOutboundPackingListPdfFromDocument(selectedOutboundDocument)}
                >
                  {t("downloadPdf")}
                </Button>
                {canManage && selectedOutboundDocument.status !== "CANCELLED" ? (
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteOutlineOutlinedIcon />}
                    onClick={() => void handleCancelOutboundDocument(selectedOutboundDocument)}
                  >
                    {t("cancelShipment")}
                  </Button>
                ) : null}
              </div>

              <div className="document-drawer__status-bar">
                <div className="document-drawer__status-main">
                  {renderDocumentStatus(selectedOutboundDocument.status, t)}
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
                  <span>{selectedOutboundDocument.cancelledAt ? `${selectedOutboundDocument.status} | ${formatDateTimeValue(selectedOutboundDocument.cancelledAt, resolvedTimeZone)}` : selectedOutboundDocument.status}</span>
                </div>
              </div>

              <div className="document-drawer__meta">
                <div className="sheet-note"><strong>{t("orderRef")}</strong> {selectedOutboundDocument.orderRef || "-"}</div>
                <div className="sheet-note"><strong>{t("customer")}</strong> {selectedOutboundDocument.customerName || "-"}</div>
                <div className="sheet-note"><strong>{t("currentStorage")}</strong> {selectedOutboundDocument.storages || "-"}</div>
                <div className="sheet-note"><strong>{t("outDate")}</strong> {formatDate(selectedOutboundDocument.outDate)}</div>
                <div className="sheet-note document-drawer__meta-note"><strong>{t("documentNotes")}</strong> {selectedOutboundDocument.documentNote || "-"}</div>
                <div className="sheet-note document-drawer__meta-note"><strong>{t("cancelNote")}</strong> {selectedOutboundDocument.cancelNote || "-"}</div>
              </div>

              <div className="document-drawer__section-title">{t("outboundLines")}</div>
              <Box sx={{ minWidth: 0, height: 440 }}>
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
          maxWidth="lg"
        >
          <DialogTitle sx={{ pb: 1 }}>
            {mode === "IN" ? t("batchInboundTitle") : t("batchOutboundTitle")}
            <IconButton aria-label={t("close")} onClick={closeBatchModal} sx={{ position: "absolute", right: 16, top: 16 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}
            {mode === "IN" ? (
              <form onSubmit={handleBatchSubmit}>
                <div className="sheet-form sheet-form--compact">
                  <label>{t("deliveryDate")}<input type="date" value={batchForm.deliveryDate} onChange={(event) => setBatchForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
                  <label>{t("containerNo")}<input value={batchForm.containerNo} onChange={(event) => setBatchForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="MRSU8580370" /></label>
                  <label>{t("customer")}<select value={batchForm.customerId} onChange={(event) => setBatchForm((current) => ({ ...current, customerId: event.target.value }))}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
                  <label>{t("currentStorage")}<select value={batchForm.locationId} onChange={(event) => setBatchForm((current) => ({ ...current, locationId: event.target.value }))}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                  <label>{t("storageSection")}<select value={batchForm.storageSection} onChange={(event) => setBatchForm((current) => ({ ...current, storageSection: event.target.value }))}>{batchSectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
                  <label>{t("inboundUnit")}<select value={batchForm.unitLabel} onChange={(event) => setBatchForm((current) => ({ ...current, unitLabel: event.target.value }))}><option value="CTN">CTN</option><option value="PCS">PCS</option><option value="PALLET">PALLET</option></select></label>
                  <label className="sheet-form__wide">{t("documentNotes")}<input value={batchForm.documentNote} onChange={(event) => setBatchForm((current) => ({ ...current, documentNote: event.target.value }))} placeholder={t("inboundNotePlaceholder")} /></label>
                </div>

                <div className="batch-lines">
                  <div className="batch-lines__toolbar batch-lines__toolbar--sticky">
                    <strong>{t("skuLines")}</strong>
                    <Button size="small" variant="outlined" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={addBatchLine}>{t("addSkuLine")}</Button>
                  </div>

                  {batchLines.map((line, index) => {
                    const selectedBatchItem = items.find((item) =>
                      item.sku.trim().toUpperCase() === line.sku.trim().toUpperCase()
                      && item.locationId === Number(batchForm.locationId)
                      && item.customerId === Number(batchForm.customerId)
                    );
                    const batchSkuTemplate = items.find((item) => item.sku.trim().toUpperCase() === line.sku.trim().toUpperCase());
                    const suggestedPalletsDetail = getSuggestedPalletsDetail(line.receivedQty || line.expectedQty, line.pallets);

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
                        <div className="batch-line-grid">
                          <label>{t("sku")}<input value={line.sku} onChange={(event) => updateBatchLine(line.id, { sku: event.target.value })} placeholder="023042" /></label>
                          <label>{t("reorderLevel")}<input type="number" min="0" value={numberInputValue(line.reorderLevel)} onChange={(event) => updateBatchLine(line.id, { reorderLevel: Math.max(0, Number(event.target.value || 0)) })} /></label>
                          <label className="batch-line-grid__description">{t("description")}<input value={selectedBatchItem ? displayDescription(selectedBatchItem) : (line.description || displayDescription(batchSkuTemplate ?? { description: "", name: "" }))} onChange={(event) => updateBatchLine(line.id, { description: event.target.value })} placeholder={t("descriptionPlaceholder")} disabled={Boolean(selectedBatchItem)} /></label>
                          <label>{t("expectedQty")}<input type="number" min="0" value={numberInputValue(line.expectedQty)} onChange={(event) => updateBatchLine(line.id, { expectedQty: Math.max(0, Number(event.target.value || 0)) })} /></label>
                          <label>{t("received")}<input type="number" min="0" value={numberInputValue(line.receivedQty)} onChange={(event) => updateBatchLine(line.id, { receivedQty: Math.max(0, Number(event.target.value || 0)) })} /></label>
                          <label>{t("pallets")}<input type="number" min="0" value={numberInputValue(line.pallets)} onChange={(event) => updateBatchLine(line.id, { pallets: Math.max(0, Number(event.target.value || 0)) })} /></label>
                          <label>{t("storageSection")}<input value={selectedBatchItem?.storageSection || batchForm.storageSection || "A"} readOnly /></label>
                          <label className="batch-line-grid__detail">{t("palletsDetail")}<input value={line.palletsDetailCtns} onChange={(event) => updateBatchLine(line.id, { palletsDetailCtns: event.target.value })} placeholder={suggestedPalletsDetail || "28*115+110"} /></label>
                        </div>
                        <div className="batch-line-card__meta">
                          <span className="batch-line-card__hint">
                            {selectedBatchItem
                              ? `${selectedBatchItem.customerName} | ${selectedBatchItem.sku} | ${selectedBatchItem.locationName}`
                              : (line.sku.trim() ? line.sku.trim().toUpperCase() : t("noSkuSelected"))}
                          </span>
                          {suggestedPalletsDetail ? (
                            <button className="button button--ghost button--small" type="button" onClick={() => updateBatchLine(line.id, { palletsDetailCtns: suggestedPalletsDetail })}>
                              {t("useSuggestion")}: {suggestedPalletsDetail}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                </div>

                <div className="sheet-form__actions" style={{ marginTop: "1rem" }}>
                  <button className="button button--primary" type="submit" disabled={batchSubmitting}>{batchSubmitting ? t("saving") : t("saveBatchInbound")}</button>
                  <button className="button button--ghost" type="button" onClick={closeBatchModal}>{t("cancel")}</button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleBatchOutboundSubmit}>
                <div className="sheet-form sheet-form--compact">
                  <label>{t("packingListNo")}<input value={batchOutboundForm.packingListNo} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, packingListNo: event.target.value }))} placeholder="TGCUS180265" /></label>
                  <label>{t("orderRef")}<input value={batchOutboundForm.orderRef} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, orderRef: event.target.value }))} placeholder="J73504" /></label>
                  <label>{t("outDate")}<input type="date" value={batchOutboundForm.outDate} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, outDate: event.target.value }))} /></label>
                  <label className="sheet-form__wide">{t("documentNotes")}<input value={batchOutboundForm.documentNote} onChange={(event) => setBatchOutboundForm((current) => ({ ...current, documentNote: event.target.value }))} placeholder={t("outboundDocumentNotePlaceholder")} /></label>
                </div>

                <div className="batch-lines">
                  <div className="batch-lines__toolbar batch-lines__toolbar--sticky">
                    <strong>{t("outboundLines")}</strong>
                    <Button size="small" variant="outlined" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={addBatchOutboundLine}>{t("addOutboundLine")}</Button>
                  </div>

                  {batchOutboundLines.map((line, index) => {
                    const selectedOutboundItem = availableOutboundItems.find((item) => item.id === Number(line.itemId));

                    return (
                      <div className="batch-line-card" key={line.id}>
                        <div className="batch-line-card__header">
                          <div className="batch-line-card__title">
                            <strong>{t("stockRow")} #{index + 1}</strong>
                            <span className={`status-pill ${selectedOutboundItem ? "status-pill--ok" : "status-pill--alert"}`}>
                              {selectedOutboundItem ? t("selected") : t("selectStockRow")}
                            </span>
                          </div>
                          <button className="button button--danger button--small" type="button" onClick={() => removeBatchOutboundLine(line.id)} disabled={batchOutboundLines.length === 1}>{t("removeLine")}</button>
                        </div>
                        <div className="batch-line-grid">
                          <label className="batch-line-grid__description">
                            {t("stockRow")}
                            <select
                              value={line.itemId}
                              onChange={(event) => {
                                const nextItem = availableOutboundItems.find((item) => item.id === Number(event.target.value));
                                updateBatchOutboundLine(line.id, {
                                  itemId: event.target.value,
                                  unitLabel: nextItem?.unit?.toUpperCase() || line.unitLabel || "PCS"
                                });
                              }}
                            >
                              <option value="">{t("selectStockRow")}</option>
                              {availableOutboundItems.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {`${item.customerName} | ${item.locationName} / ${item.storageSection || "A"} | ${item.sku} - ${displayDescription(item)} (${t("availableQty")}: ${item.quantity})`}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>{t("availableQty")}<input value={selectedOutboundItem ? String(selectedOutboundItem.quantity) : ""} readOnly /></label>
                          <label>{t("outQty")}<input type="number" min="0" value={numberInputValue(line.quantity)} onChange={(event) => updateBatchOutboundLine(line.id, { quantity: Math.max(0, Number(event.target.value || 0)) })} /></label>
                          <label>{t("unit")}<input value={line.unitLabel} onChange={(event) => updateBatchOutboundLine(line.id, { unitLabel: event.target.value })} placeholder="PCS" /></label>
                          <label>{t("cartonSize")}<input value={line.cartonSizeMm} onChange={(event) => updateBatchOutboundLine(line.id, { cartonSizeMm: event.target.value })} placeholder="455*330*325" /></label>
                          <label>{t("netWeight")}<input type="number" min="0" step="0.01" value={numberInputValue(line.netWeightKgs)} onChange={(event) => updateBatchOutboundLine(line.id, { netWeightKgs: Math.max(0, Number(event.target.value || 0)) })} /></label>
                          <label>{t("grossWeight")}<input type="number" min="0" step="0.01" value={numberInputValue(line.grossWeightKgs)} onChange={(event) => updateBatchOutboundLine(line.id, { grossWeightKgs: Math.max(0, Number(event.target.value || 0)) })} /></label>
                          <label className="batch-line-grid__detail">{t("internalNotes")}<input value={line.reason} onChange={(event) => updateBatchOutboundLine(line.id, { reason: event.target.value })} placeholder={t("outboundInternalNotePlaceholder")} /></label>
                        </div>
                        <div className="batch-line-card__meta">
                          <span className="batch-line-card__hint">
                            {selectedOutboundItem
                              ? `${selectedOutboundItem.customerName} | ${selectedOutboundItem.sku} | ${displayDescription(selectedOutboundItem)} | ${selectedOutboundItem.locationName} / ${selectedOutboundItem.storageSection || "A"} | ${t("availableQty")}: ${selectedOutboundItem.quantity}`
                              : t("selectStockRow")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="sheet-form__actions" style={{ marginTop: "1rem" }}>
                  <button className="button button--primary" type="submit" disabled={batchSubmitting || availableOutboundItems.length === 0}>{batchSubmitting ? t("saving") : t("saveBatchOutbound")}</button>
                  <button className="button button--ghost" type="button" onClick={closeBatchModal}>{t("cancel")}</button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
    </main>
  );
}

function displayDescription(item: Pick<Item, "description" | "name">) { return item.description || item.name; }
function formatDate(value: string | null) { return formatDateValue(value, dateFormatter); }
function numberInputValue(value: number) { return value === 0 ? "" : String(value); }
function getLocationSectionOptions(location: Location | undefined) {
  const sectionNames = location?.sectionNames?.map((sectionName) => sectionName.trim()).filter(Boolean) ?? [];
  return sectionNames.length > 0 ? sectionNames : ["A"];
}

function renderDocumentStatus(status: string, t: (key: string) => string) {
  const normalizedStatus = status.trim().toUpperCase();

  if (normalizedStatus === "CANCELLED") {
    return <Chip label={status || t("cancelShipment")} color="error" size="small" />;
  }

  if (normalizedStatus === "POSTED") {
    return <Chip label={status || "POSTED"} color="success" size="small" />;
  }

  return <Chip label={status || "DRAFT"} color="default" size="small" />;
}
