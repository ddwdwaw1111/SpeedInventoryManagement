import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { type Dispatch, type FormEvent, type SetStateAction, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { RowActionsMenu } from "./RowActionsMenu";
import { formatDateValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { downloadOutboundPackingListPdfFromDocument } from "../lib/outboundPackingListPdf";
import type { Customer, InboundDocument, InboundDocumentPayload, Item, ItemPayload, Location, Movement, MovementPayload, OutboundDocument, OutboundDocumentPayload, UserRole } from "../lib/types";

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

type ActivityFormState = {
  itemId: string;
  quantity: number;
  storageSection: string;
  deliveryDate: string;
  containerNo: string;
  packingListNo: string;
  orderRef: string;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  palletsDetailCtns: string;
  cartonSizeMm: string;
  unitLabel: string;
  netWeightKgs: number;
  grossWeightKgs: number;
  heightIn: number;
  outDate: string;
  documentNote: string;
  reason: string;
  referenceCode: string;
};

type NewSkuFormState = {
  sku: string;
  description: string;
  customerId: string;
  locationId: string;
  storageSection: string;
  reorderLevel: number;
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

type InboundViewMode = "documents" | "line-items";
type OutboundViewMode = "packing-lists" | "line-items";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function createEmptyActivityForm(mode: ActivityMode): ActivityFormState {
  return {
    itemId: "",
    quantity: 0,
    storageSection: "A",
    deliveryDate: "",
    containerNo: "",
    packingListNo: "",
    orderRef: "",
    expectedQty: 0,
    receivedQty: 0,
    pallets: 0,
    palletsDetailCtns: "",
    cartonSizeMm: "",
    unitLabel: mode === "IN" ? "CTN" : "PCS",
    netWeightKgs: 0,
    grossWeightKgs: 0,
    heightIn: mode === "IN" ? 0 : 87,
    outDate: "",
    documentNote: "",
    reason: mode === "IN" ? "Inbound shipment recorded" : "Outbound shipment recorded",
    referenceCode: ""
  };
}

function createEmptyNewSkuForm(defaultCustomerId = "", defaultLocationId = ""): NewSkuFormState {
  return {
    sku: "",
    description: "",
    customerId: defaultCustomerId,
    locationId: defaultLocationId,
    storageSection: "A",
    reorderLevel: 0
  };
}

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

export function ActivityManagementPage({ mode, items, locations, customers, movements, inboundDocuments, outboundDocuments, currentUserRole, isLoading, onRefresh }: ActivityManagementPageProps) {
  const { t } = useI18n();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [form, setForm] = useState<ActivityFormState>(() => createEmptyActivityForm(mode));
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [editingMovementId, setEditingMovementId] = useState<number | null>(null);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [pendingDeleteMovement, setPendingDeleteMovement] = useState<Movement | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [newSkuForm, setNewSkuForm] = useState<NewSkuFormState>(() => createEmptyNewSkuForm("", ""));
  const [batchForm, setBatchForm] = useState<BatchInboundFormState>(() => createEmptyBatchInboundForm());
  const [batchLines, setBatchLines] = useState<BatchInboundLineState[]>(() => [createEmptyBatchInboundLine()]);
  const [batchOutboundForm, setBatchOutboundForm] = useState<BatchOutboundFormState>(() => createEmptyBatchOutboundForm());
  const [batchOutboundLines, setBatchOutboundLines] = useState<BatchOutboundLineState[]>(() => [createEmptyBatchOutboundLine()]);
  const [inboundViewMode, setInboundViewMode] = useState<InboundViewMode>("documents");
  const [outboundViewMode, setOutboundViewMode] = useState<OutboundViewMode>("packing-lists");
  const [selectedInboundDocument, setSelectedInboundDocument] = useState<InboundDocument | null>(null);
  const [selectedOutboundDocument, setSelectedOutboundDocument] = useState<OutboundDocument | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const pendingBatchLineIDRef = useRef<string | null>(null);
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";

  useEffect(() => {
    setForm((current) => ({ ...createEmptyActivityForm(mode), itemId: current.itemId }));
    setEditingMovementId(null);
    setIsFormModalOpen(false);
    setIsBatchModalOpen(false);
    setPendingDeleteMovement(null);
    setDeleteSubmitting(false);
    setInboundViewMode("documents");
    setBatchOutboundForm(createEmptyBatchOutboundForm());
    setBatchOutboundLines([createEmptyBatchOutboundLine()]);
    setSelectedInboundDocument(null);
    setSelectedOutboundDocument(null);
  }, [mode]);

  useEffect(() => {
    if (items.length > 0 && !form.itemId) {
      setForm((current) => ({ ...current, itemId: String(items[0].id) }));
    }
  }, [form.itemId, items]);

  useEffect(() => {
    if (!newSkuForm.locationId && locations[0]) {
      setNewSkuForm((current) => ({ ...current, locationId: String(locations[0].id) }));
    }
  }, [locations, newSkuForm.locationId]);

  useEffect(() => {
    if (!newSkuForm.customerId && customers[0]) {
      setNewSkuForm((current) => ({ ...current, customerId: String(customers[0].id) }));
    }
  }, [customers, newSkuForm.customerId]);

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

  const selectedItem = items.find((item) => item.id === Number(form.itemId));
  const selectedItemLocation = locations.find((location) => location.id === selectedItem?.locationId);
  const selectedItemSectionOptions = getLocationSectionOptions(selectedItemLocation);
  const newSkuLocation = locations.find((location) => location.id === Number(newSkuForm.locationId));
  const newSkuSectionOptions = getLocationSectionOptions(newSkuLocation);
  const batchLocation = locations.find((location) => location.id === Number(batchForm.locationId));
  const batchSectionOptions = getLocationSectionOptions(batchLocation);
  const matchingNewSkuTemplate = useMemo(() => {
    const normalizedSku = newSkuForm.sku.trim().toUpperCase();
    if (!normalizedSku) return undefined;
    return items.find((item) => item.sku.trim().toUpperCase() === normalizedSku);
  }, [items, newSkuForm.sku]);
  const matchingNewSkuItem = useMemo(() => {
    const normalizedSku = newSkuForm.sku.trim().toUpperCase();
    const locationID = Number(newSkuForm.locationId);
    const customerID = Number(newSkuForm.customerId);
    if (!normalizedSku || !locationID || !customerID) return undefined;
    return items.find((item) =>
      item.sku.trim().toUpperCase() === normalizedSku
      && item.locationId === locationID
      && item.customerId === customerID
    );
  }, [items, newSkuForm.customerId, newSkuForm.locationId, newSkuForm.sku, newSkuForm.storageSection]);
  const historyRows = useMemo(() => movements.filter((movement) => movement.movementType === mode), [mode, movements]);
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
  const isAutoMatchedInboundSku = mode === "IN" && editingMovementId === null && Boolean(matchingNewSkuItem);
  const shouldAutoCreateInboundSku = mode === "IN" && editingMovementId === null && !matchingNewSkuItem && Boolean(newSkuForm.sku.trim());

  useEffect(() => {
    if (!selectedItem) {
      return;
    }

    const fallbackSection = selectedItem.storageSection || selectedItemSectionOptions[0] || "A";
    setForm((current) => {
      if (editingMovementId !== null) {
        if (selectedItemSectionOptions.includes(current.storageSection)) {
          return current;
        }

        return { ...current, storageSection: fallbackSection };
      }

      return current.storageSection === fallbackSection ? current : { ...current, storageSection: fallbackSection };
    });
  }, [editingMovementId, selectedItem, selectedItemSectionOptions]);

  useEffect(() => {
    const fallbackSection = newSkuSectionOptions[0] || "A";
    if (!newSkuSectionOptions.includes(newSkuForm.storageSection)) {
      setNewSkuForm((current) => ({ ...current, storageSection: fallbackSection }));
    }
  }, [newSkuForm.storageSection, newSkuSectionOptions]);

  useEffect(() => {
    const fallbackSection = batchSectionOptions[0] || "A";
    if (!batchSectionOptions.includes(batchForm.storageSection)) {
      setBatchForm((current) => ({ ...current, storageSection: fallbackSection }));
    }
  }, [batchForm.storageSection, batchSectionOptions]);

  useEffect(() => {
    if (mode !== "IN" || editingMovementId !== null) {
      return;
    }

    if (matchingNewSkuItem) {
      const fallbackSection = matchingNewSkuItem.storageSection || "A";
      setForm((current) => ({
        ...current,
        itemId: String(matchingNewSkuItem.id),
        storageSection: fallbackSection
      }));
      setNewSkuForm((current) => ({
        ...current,
        description: current.description || displayDescription(matchingNewSkuItem)
      }));
      return;
    }

    setForm((current) => current.itemId === "" ? current : { ...current, itemId: "" });
  }, [editingMovementId, matchingNewSkuItem, mode, selectedItemSectionOptions]);

  useEffect(() => {
    if (mode !== "IN" || editingMovementId !== null || matchingNewSkuItem || !matchingNewSkuTemplate) {
      return;
    }

    setNewSkuForm((current) => ({
      ...current,
      description: current.description || displayDescription(matchingNewSkuTemplate),
      reorderLevel: current.reorderLevel > 0 ? current.reorderLevel : matchingNewSkuTemplate.reorderLevel
    }));
  }, [editingMovementId, matchingNewSkuItem, matchingNewSkuTemplate, mode]);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const filteredRows = historyRows.filter((movement) => {
    const matchesSearch = normalizedSearch.length === 0
      || movement.sku.toLowerCase().includes(normalizedSearch)
      || movement.customerName.toLowerCase().includes(normalizedSearch)
      || movement.description.toLowerCase().includes(normalizedSearch)
      || movement.containerNo.toLowerCase().includes(normalizedSearch)
      || movement.referenceCode.toLowerCase().includes(normalizedSearch)
      || movement.packingListNo.toLowerCase().includes(normalizedSearch)
      || movement.orderRef.toLowerCase().includes(normalizedSearch);
    const matchesLocation = selectedLocationId === "all"
      || items.find((item) => item.id === movement.itemId)?.locationId === Number(selectedLocationId);
    const matchesCustomer = selectedCustomerId === "all" || movement.customerId === Number(selectedCustomerId);
    return matchesSearch && matchesLocation && matchesCustomer;
  });
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

  const inboundColumns = useMemo<GridColDef<Movement>[]>(() => [
    { field: "deliveryDate", headerName: t("deliveryDate"), minWidth: 140, renderCell: (params) => formatDate(params.row.deliveryDate) },
    { field: "containerNo", headerName: t("containerNo"), minWidth: 170, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.containerNo || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 260, flex: 1.4, renderCell: (params) => params.row.description },
    { field: "customerName", headerName: t("customer"), minWidth: 170, flex: 1, renderCell: (params) => params.row.customerName },
    { field: "expectedQty", headerName: t("expectedQty"), minWidth: 130, type: "number", renderCell: (params) => params.row.expectedQty || "-" },
    {
      field: "receivedQty",
      headerName: t("received"),
      minWidth: 110,
      type: "number",
      renderCell: (params) => (
        <span className={hasQtyMismatch(params.row.expectedQty, params.row.receivedQty) ? "cell--mismatch" : ""}>
          {params.row.receivedQty || params.row.quantityChange || "-"}
        </span>
      )
    },
    { field: "pallets", headerName: t("pallets"), minWidth: 100, type: "number", renderCell: (params) => params.row.pallets || "-" },
    { field: "unitLabel", headerName: t("inboundUnit"), minWidth: 110, renderCell: (params) => params.row.unitLabel || "-" },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 110, renderCell: (params) => params.row.storageSection || "A" },
    { field: "palletsDetailCtns", headerName: t("palletsDetail"), minWidth: 180, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.palletsDetailCtns || "-"}</span> },
    { field: "heightIn", headerName: t("heightIn"), minWidth: 110, type: "number", renderCell: (params) => params.row.heightIn || "-" },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 170, flex: 1, renderCell: (params) => params.row.locationName },
    {
      field: "status",
      headerName: t("status"),
      minWidth: 140,
      sortable: false,
      filterable: false,
      renderCell: (params) => renderInboundStatus(params.row.expectedQty, params.row.receivedQty, t)
    },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 90,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        const linkedDocument = params.row.inboundDocumentId > 0
          ? inboundDocuments.find((document) => document.id === params.row.inboundDocumentId)
          : undefined;

        return (
          <RowActionsMenu
            ariaLabel={t("actions")}
            actions={linkedDocument
              ? [
                  { key: "details", label: t("details"), icon: <VisibilityOutlinedIcon fontSize="small" />, onClick: () => setSelectedInboundDocument(linkedDocument) }
                ]
              : canManage
                ? [
                    { key: "edit", label: t("edit"), icon: <EditOutlinedIcon fontSize="small" />, onClick: () => openEditModal(params.row) },
                    { key: "delete", label: t("delete"), icon: <DeleteOutlineOutlinedIcon fontSize="small" />, danger: true, onClick: () => handleDeleteMovement(params.row) }
                  ]
                : []}
          />
        );
      }
    }
  ], [canManage, inboundDocuments, t]);

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

  const outboundColumns = useMemo<GridColDef<Movement>[]>(() => [
    { field: "sn", headerName: "SN", minWidth: 80, sortable: false, filterable: false, renderCell: (params) => filteredRows.findIndex((row) => row.id === params.row.id) + 1 },
    { field: "packingListNo", headerName: t("packingListNo"), minWidth: 170, renderCell: (params) => <span className="cell--mono">{params.row.packingListNo || "-"}</span> },
    { field: "orderRef", headerName: t("orderRef"), minWidth: 150, renderCell: (params) => <span className="cell--mono">{params.row.orderRef || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 260, flex: 1.4, renderCell: (params) => params.row.description },
    { field: "customerName", headerName: t("customer"), minWidth: 170, flex: 1, renderCell: (params) => params.row.customerName },
    { field: "quantityChange", headerName: "QTY", minWidth: 100, type: "number", renderCell: (params) => Math.abs(params.row.quantityChange) || "-" },
    { field: "unitLabel", headerName: t("unit"), minWidth: 90, renderCell: (params) => params.row.unitLabel || "-" },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 110, renderCell: (params) => params.row.storageSection || "A" },
    { field: "cartonSizeMm", headerName: t("cartonSize"), minWidth: 150, renderCell: (params) => <span className="cell--mono">{params.row.cartonSizeMm || "-"}</span> },
    { field: "netWeightKgs", headerName: t("netWeight"), minWidth: 110, type: "number", renderCell: (params) => params.row.netWeightKgs ? params.row.netWeightKgs.toFixed(2) : "-" },
    { field: "grossWeightKgs", headerName: t("grossWeight"), minWidth: 110, type: "number", renderCell: (params) => params.row.grossWeightKgs ? params.row.grossWeightKgs.toFixed(2) : "-" },
    { field: "outDate", headerName: t("outDate"), minWidth: 130, renderCell: (params) => formatDate(params.row.outDate) },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 90,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        const linkedDocument = params.row.outboundDocumentId > 0
          ? outboundDocuments.find((document) => document.id === params.row.outboundDocumentId)
          : undefined;

        return (
          <RowActionsMenu
            ariaLabel={t("actions")}
            actions={linkedDocument
              ? [
                  { key: "details", label: t("details"), icon: <VisibilityOutlinedIcon fontSize="small" />, onClick: () => setSelectedOutboundDocument(linkedDocument) },
                  { key: "download-pdf", label: t("downloadPdf"), icon: <PictureAsPdfOutlinedIcon fontSize="small" />, onClick: () => downloadOutboundPackingListPdfFromDocument(linkedDocument) }
                ]
              : canManage
                ? [
                    { key: "edit", label: t("edit"), icon: <EditOutlinedIcon fontSize="small" />, onClick: () => openEditModal(params.row) },
                    { key: "delete", label: t("delete"), icon: <DeleteOutlineOutlinedIcon fontSize="small" />, danger: true, onClick: () => handleDeleteMovement(params.row) }
                  ]
                : []}
          />
        );
      }
    }
  ], [canManage, filteredRows, outboundDocuments, t]);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    let itemId = Number(form.itemId);
    const resolvedQuantity = mode === "IN"
      ? form.receivedQty || form.expectedQty
      : form.quantity;
    if (resolvedQuantity === 0) {
      setErrorMessage(t("chooseSkuAndQty"));
      setSubmitting(false);
      return;
    }

    if (mode === "IN" && editingMovementId === null) {
      if (matchingNewSkuItem) {
        itemId = matchingNewSkuItem.id;
      } else {
        const locationId = Number(newSkuForm.locationId);
        const customerId = Number(newSkuForm.customerId);
        if (!customerId) {
          setErrorMessage(t("chooseCustomerBeforeSave"));
          setSubmitting(false);
          return;
        }
        if (!newSkuForm.sku.trim() || !locationId || !newSkuForm.description.trim()) {
          setErrorMessage(t("enterNewSkuRequired"));
          setSubmitting(false);
          return;
        }

        const createItemPayload: ItemPayload = {
          sku: newSkuForm.sku.trim(),
          name: newSkuForm.description.trim(),
          category: "General",
          description: newSkuForm.description.trim(),
          unit: (form.unitLabel || "CTN").toLowerCase(),
          quantity: 0,
          reorderLevel: newSkuForm.reorderLevel,
          customerId,
          locationId,
          storageSection: newSkuForm.storageSection || "A",
          deliveryDate: form.deliveryDate || undefined,
          containerNo: form.containerNo || undefined,
          expectedQty: form.expectedQty,
          receivedQty: form.receivedQty,
          pallets: form.pallets,
          palletsDetailCtns: form.palletsDetailCtns || undefined,
          heightIn: form.heightIn,
          outDate: form.outDate || undefined
        };

        try {
          const createdItem = await api.createItem(createItemPayload);
          itemId = createdItem.id;
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : t("createNewSkuError"));
          setSubmitting(false);
          return;
        }
      }
    }

    if (!itemId) {
      setErrorMessage(t("chooseSkuAndQty"));
      setSubmitting(false);
      return;
    }

    const payload: MovementPayload = {
      itemId,
      movementType: mode,
      quantity: resolvedQuantity,
      storageSection: mode === "IN"
        ? (
          editingMovementId !== null
            ? (form.storageSection || selectedItem?.storageSection || "A")
            : (newSkuForm.storageSection || form.storageSection || matchingNewSkuItem?.storageSection || "A")
        )
        : (form.storageSection || selectedItem?.storageSection || "A"),
      deliveryDate: form.deliveryDate || undefined,
      containerNo: form.containerNo || undefined,
      packingListNo: form.packingListNo || undefined,
      orderRef: form.orderRef || undefined,
      itemNumber: undefined,
      expectedQty: form.expectedQty,
      receivedQty: form.receivedQty,
      pallets: form.pallets,
      palletsDetailCtns: form.palletsDetailCtns || undefined,
      cartonSizeMm: form.cartonSizeMm || undefined,
      cartonCount: mode === "OUT" ? resolvedQuantity : 0,
      unitLabel: form.unitLabel || undefined,
      netWeightKgs: form.netWeightKgs,
      grossWeightKgs: form.grossWeightKgs,
      heightIn: form.heightIn,
      outDate: form.outDate || undefined,
      documentNote: mode === "OUT" ? form.documentNote || undefined : undefined,
      reason: form.reason || undefined,
      referenceCode: form.referenceCode || undefined
    };

    try {
      if (editingMovementId) {
        await api.updateMovement(editingMovementId, payload);
      } else {
        await api.createMovement(payload);
      }
      setForm((current) => ({ ...createEmptyActivityForm(mode), itemId: current.itemId }));
      setNewSkuForm(createEmptyNewSkuForm(
        customers[0] ? String(customers[0].id) : "",
        locations[0] ? String(locations[0].id) : ""
      ));
      setEditingMovementId(null);
      setIsFormModalOpen(false);
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveActivity"));
    } finally {
      setSubmitting(false);
    }
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

  function openEditModal(movement: Movement) {
    setEditingMovementId(movement.id);
    setForm({
      itemId: String(movement.itemId),
      quantity: Math.abs(movement.quantityChange),
      storageSection: movement.storageSection || "A",
      deliveryDate: toDateInputValue(movement.deliveryDate),
      containerNo: movement.containerNo,
      packingListNo: movement.packingListNo,
      orderRef: movement.orderRef,
      expectedQty: movement.expectedQty,
      receivedQty: movement.receivedQty,
      pallets: movement.pallets,
      palletsDetailCtns: movement.palletsDetailCtns,
      cartonSizeMm: movement.cartonSizeMm,
      unitLabel: movement.unitLabel || (movement.movementType === "IN" ? "CTN" : "PCS"),
      netWeightKgs: movement.netWeightKgs,
      grossWeightKgs: movement.grossWeightKgs,
      heightIn: movement.heightIn || 87,
      outDate: toDateInputValue(movement.outDate),
      documentNote: movement.documentNote,
      reason: movement.reason,
      referenceCode: movement.referenceCode
    });
    setNewSkuForm(createEmptyNewSkuForm(
      customers[0] ? String(customers[0].id) : "",
      locations[0] ? String(locations[0].id) : ""
    ));
    setErrorMessage("");
    setIsFormModalOpen(true);
  }

  async function handleDeleteMovement(movement: Movement) {
    if (!canManage) {
      return;
    }
    if (mode === "OUT") {
      setPendingDeleteMovement(movement);
      setErrorMessage("");
      return;
    }

    if (!window.confirm(t("deleteInboundConfirm", { sku: movement.sku }))) return;
    await performDeleteMovement(movement, true);
  }

  async function performDeleteMovement(movement: Movement, restoreStock: boolean) {
    setErrorMessage("");
    setDeleteSubmitting(true);
    try {
      await api.deleteMovement(movement.id, { restoreStock });
      if (editingMovementId === movement.id) {
        setEditingMovementId(null);
        setIsFormModalOpen(false);
      }
      setPendingDeleteMovement(null);
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotDeleteActivity"));
    } finally {
      setDeleteSubmitting(false);
    }
  }

  function closeDeleteDialog() {
    if (deleteSubmitting) return;
    setPendingDeleteMovement(null);
  }

  function closeFormModal() {
    setEditingMovementId(null);
    setIsFormModalOpen(false);
    setForm((current) => ({ ...createEmptyActivityForm(mode), itemId: current.itemId }));
    setNewSkuForm(createEmptyNewSkuForm(
      customers[0] ? String(customers[0].id) : "",
      locations[0] ? String(locations[0].id) : ""
    ));
    setErrorMessage("");
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
      {errorMessage && !isFormModalOpen ? <div className="alert-banner">{errorMessage}</div> : null}

      <section>
        <article className="workbook-panel workbook-panel--full">
          <div className="tab-strip">
            <div className="tab-strip__toolbar">
              <div className="tab-strip__actions">
                {canManage ? (
                  <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={openCreateModal}>
                    {mode === "IN" ? t("newInbound") : t("newOutbound")}
                  </Button>
                ) : null}
                {mode === "IN" ? (
                  <>
                    <Button variant={inboundViewMode === "documents" ? "outlined" : "text"} onClick={() => setInboundViewMode("documents")}>{t("documentsView")}</Button>
                    <Button variant={inboundViewMode === "line-items" ? "outlined" : "text"} onClick={() => setInboundViewMode("line-items")}>{t("lineItemsView")}</Button>
                  </>
                ) : null}
                {mode === "OUT" ? (
                  <>
                    <Button variant={outboundViewMode === "packing-lists" ? "outlined" : "text"} onClick={() => setOutboundViewMode("packing-lists")}>{t("packingListsView")}</Button>
                    <Button variant={outboundViewMode === "line-items" ? "outlined" : "text"} onClick={() => setOutboundViewMode("line-items")}>{t("lineItemsView")}</Button>
                  </>
                ) : null}
              </div>
            </div>
            <div className="filter-bar">
              <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={mode === "IN" ? t("searchInboundPlaceholder") : t("searchOutboundPlaceholder")} /></label>
              <label>{t("customer")}<select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}><option value="all">{t("allCustomers")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
              <label>{t("currentStorage")}<select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}><option value="all">{t("allStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            </div>
          </div>
          <div className="sheet-table-wrap">
            <Box sx={{ minWidth: 0 }}>
              {mode === "IN" && inboundViewMode === "documents" ? (
                <DataGrid
                  rows={inboundDocumentRows}
                  columns={inboundDocumentColumns}
                  loading={isLoading}
                  pagination
                  pageSizeOptions={[10, 20, 50]}
                  disableRowSelectionOnClick
                  initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                  getRowHeight={() => 68}
                  sx={{ border: 0 }}
                />
              ) : mode === "OUT" && outboundViewMode === "packing-lists" ? (
                <DataGrid
                  rows={outboundDocumentRows}
                  columns={outboundDocumentColumns}
                  loading={isLoading}
                  pagination
                  pageSizeOptions={[10, 20, 50]}
                  disableRowSelectionOnClick
                  initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                  getRowHeight={() => 68}
                  sx={{ border: 0 }}
                />
              ) : (
                <DataGrid
                  rows={filteredRows}
                  columns={mode === "IN" ? inboundColumns : outboundColumns}
                  loading={isLoading}
                  pagination
                  pageSizeOptions={[10, 20, 50]}
                  disableRowSelectionOnClick
                  initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                  getRowHeight={() => 68}
                  sx={{ border: 0 }}
                />
              )}
            </Box>
          </div>
        </article>
      </section>

      <Dialog
        open={isFormModalOpen}
        onClose={(_, reason) => {
          if (reason === "backdropClick") return;
          closeFormModal();
        }}
        fullWidth
        maxWidth={mode === "IN" ? "lg" : "md"}
        PaperProps={{
          sx: mode === "IN"
            ? {
                width: "min(1180px, calc(100vw - 32px))",
                maxWidth: "1180px"
              }
            : undefined
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          {editingMovementId ? (mode === "IN" ? t("updateInboundRow") : t("updateOutboundRow")) : (mode === "IN" ? t("addInboundRow") : t("addOutboundRow"))}
          <IconButton aria-label={t("close")} onClick={closeFormModal} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={mode === "IN" ? { px: 3, py: 2.5 } : undefined}>
          {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <ActivityFormFields
              mode={mode}
              form={form}
              setForm={setForm}
              items={items}
              locations={locations}
              customers={customers}
              selectedItem={selectedItem}
              selectedItemSectionOptions={selectedItemSectionOptions}
              matchingNewSkuItem={matchingNewSkuItem}
              isAutoMatchedInboundSku={isAutoMatchedInboundSku}
              shouldAutoCreateInboundSku={shouldAutoCreateInboundSku}
              newSkuForm={newSkuForm}
              setNewSkuForm={setNewSkuForm}
              newSkuSectionOptions={newSkuSectionOptions}
              isEditing={editingMovementId !== null}
            />
            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={submitting || (mode !== "IN" && items.length === 0)}>{submitting ? t("saving") : editingMovementId ? (mode === "IN" ? t("updateInboundRow") : t("updateOutboundRow")) : (mode === "IN" ? t("addInboundRow") : t("addOutboundRow"))}</button>
              <button className="button button--ghost" type="button" onClick={closeFormModal}>{t("cancel")}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {mode === "IN" ? (
        <Dialog
          open={selectedInboundDocument !== null}
          onClose={() => setSelectedInboundDocument(null)}
          fullWidth
          maxWidth="lg"
        >
          <DialogTitle sx={{ pb: 1 }}>
            {selectedInboundDocument?.containerNo || t("containerNo")}
            <IconButton aria-label={t("close")} onClick={() => setSelectedInboundDocument(null)} sx={{ position: "absolute", right: 16, top: 16 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            {selectedInboundDocument ? (
              <>
                <div className="sheet-form">
                  <div className="sheet-note"><strong>{t("deliveryDate")}</strong> {formatDate(selectedInboundDocument.deliveryDate)}</div>
                  <div className="sheet-note"><strong>{t("customer")}</strong> {selectedInboundDocument.customerName || "-"}</div>
                  <div className="sheet-note"><strong>{t("currentStorage")}</strong> {`${selectedInboundDocument.locationName} / ${selectedInboundDocument.storageSection || "A"}`}</div>
                  <div className="sheet-note"><strong>{t("inboundUnit")}</strong> {selectedInboundDocument.unitLabel || "-"}</div>
                  <div className="sheet-note"><strong>{t("documentNotes")}</strong> {selectedInboundDocument.documentNote || "-"}</div>
                  <div className="sheet-note"><strong>{t("totalLines")}</strong> {selectedInboundDocument.totalLines}</div>
                  <div className="sheet-note"><strong>{t("expectedQty")}</strong> {selectedInboundDocument.totalExpectedQty}</div>
                  <div className="sheet-note"><strong>{t("received")}</strong> {selectedInboundDocument.totalReceivedQty}</div>
                </div>
                <Box sx={{ minWidth: 0 }}>
                  <DataGrid
                    rows={selectedInboundDocument.lines}
                    columns={inboundDocumentDetailColumns}
                    pagination
                    pageSizeOptions={[5, 10, 20]}
                    disableRowSelectionOnClick
                    initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
                    getRowHeight={() => 68}
                    sx={{ border: 0 }}
                  />
                </Box>
              </>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}

      {mode === "OUT" ? (
        <Dialog
          open={selectedOutboundDocument !== null}
          onClose={() => setSelectedOutboundDocument(null)}
          fullWidth
          maxWidth="lg"
        >
          <DialogTitle sx={{ pb: 1 }}>
            {selectedOutboundDocument?.packingListNo || t("packingListNo")}
            <IconButton aria-label={t("close")} onClick={() => setSelectedOutboundDocument(null)} sx={{ position: "absolute", right: 16, top: 16 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            {selectedOutboundDocument ? (
              <>
                <div className="sheet-form">
                  <div className="sheet-note"><strong>{t("orderRef")}</strong> {selectedOutboundDocument.orderRef || "-"}</div>
                  <div className="sheet-note"><strong>{t("customer")}</strong> {selectedOutboundDocument.customerName || "-"}</div>
                  <div className="sheet-note"><strong>{t("currentStorage")}</strong> {selectedOutboundDocument.storages || "-"}</div>
                  <div className="sheet-note"><strong>{t("outDate")}</strong> {formatDate(selectedOutboundDocument.outDate)}</div>
                  <div className="sheet-note"><strong>{t("status")}</strong> {selectedOutboundDocument.status || "-"}</div>
                  <div className="sheet-note"><strong>{t("documentNotes")}</strong> {selectedOutboundDocument.documentNote || "-"}</div>
                  <div className="sheet-note"><strong>{t("cancelNote")}</strong> {selectedOutboundDocument.cancelNote || "-"}</div>
                  <div className="sheet-note"><strong>{t("totalLines")}</strong> {selectedOutboundDocument.totalLines}</div>
                  <div className="sheet-note"><strong>{t("totalQty")}</strong> {selectedOutboundDocument.totalQty}</div>
                  <div className="sheet-note"><strong>{t("grossWeight")}</strong> {selectedOutboundDocument.totalGrossWeightKgs ? selectedOutboundDocument.totalGrossWeightKgs.toFixed(2) : "-"}</div>
                </div>
                <div className="sheet-form__actions" style={{ margin: "0 0 1rem" }}>
                  <button className="button button--primary" type="button" onClick={() => downloadOutboundPackingListPdfFromDocument(selectedOutboundDocument)}>
                    {t("downloadPdf")}
                  </button>
                  {canManage && selectedOutboundDocument.status !== "CANCELLED" ? (
                    <button className="button button--danger" type="button" onClick={() => void handleCancelOutboundDocument(selectedOutboundDocument)}>
                      {t("cancelShipment")}
                    </button>
                  ) : null}
                </div>
                <Box sx={{ minWidth: 0 }}>
                  <DataGrid
                    rows={selectedOutboundDocument.lines}
                    columns={outboundDocumentDetailColumns}
                    pagination
                    pageSizeOptions={[5, 10, 20]}
                    disableRowSelectionOnClick
                    initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
                    getRowHeight={() => 68}
                    sx={{ border: 0 }}
                  />
                </Box>
              </>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}

      {mode === "OUT" ? (
        <Dialog
          open={pendingDeleteMovement !== null}
          onClose={(_, reason) => {
            if (reason === "backdropClick") return;
            closeDeleteDialog();
          }}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle sx={{ pb: 1 }}>
            {t("deleteOutboundTitle")}
            <IconButton aria-label={t("close")} onClick={closeDeleteDialog} disabled={deleteSubmitting} sx={{ position: "absolute", right: 16, top: 16 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            {pendingDeleteMovement ? (
              <>
                <div className="sheet-note sheet-form__wide">
                  <strong>{pendingDeleteMovement.sku}</strong>
                  {" "}
                  {t("deleteOutboundMessage", {
                    qty: Math.abs(pendingDeleteMovement.quantityChange),
                    storage: `${pendingDeleteMovement.locationName} / ${pendingDeleteMovement.storageSection || "A"}`
                  })}
                </div>
                <div className="sheet-form__actions sheet-form__wide" style={{ marginTop: "1rem" }}>
                  <button className="button button--ghost" type="button" onClick={closeDeleteDialog} disabled={deleteSubmitting}>{t("cancel")}</button>
                  <button className="button button--danger" type="button" onClick={() => void performDeleteMovement(pendingDeleteMovement, false)} disabled={deleteSubmitting}>{deleteSubmitting ? t("saving") : t("deleteWithoutRestore")}</button>
                  <button className="button button--primary" type="button" onClick={() => void performDeleteMovement(pendingDeleteMovement, true)} disabled={deleteSubmitting}>{deleteSubmitting ? t("saving") : t("deleteAndRestore")}</button>
                </div>
              </>
            ) : null}
          </DialogContent>
        </Dialog>
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

function ActivityFormFields({
  mode,
  form,
  setForm,
  items,
  locations,
  customers,
  selectedItem,
  selectedItemSectionOptions,
  matchingNewSkuItem,
  isAutoMatchedInboundSku,
  shouldAutoCreateInboundSku,
  newSkuForm,
  setNewSkuForm,
  newSkuSectionOptions,
  isEditing
}: {
  mode: ActivityMode;
  form: ActivityFormState;
  setForm: Dispatch<SetStateAction<ActivityFormState>>;
  items: Item[];
  locations: Location[];
  customers: Customer[];
  selectedItem: Item | undefined;
  selectedItemSectionOptions: string[];
  matchingNewSkuItem: Item | undefined;
  isAutoMatchedInboundSku: boolean;
  shouldAutoCreateInboundSku: boolean;
  newSkuForm: NewSkuFormState;
  setNewSkuForm: Dispatch<SetStateAction<NewSkuFormState>>;
  newSkuSectionOptions: string[];
  isEditing: boolean;
}) {
  const { t } = useI18n();
  const suggestedPalletsDetail = mode === "IN"
    ? getSuggestedPalletsDetail(form.receivedQty || form.expectedQty || form.quantity, form.pallets)
    : "";

  return (
    <>
      {mode === "IN" ? (
        <>
          {isEditing ? (
            <div className="batch-line-card inbound-compact-card">
              <div className="batch-line-card__header">
                <div className="batch-line-card__title">
                  <strong>{t("sku")}</strong>
                  <span className="status-pill status-pill--ok">{t("edit")}</span>
                </div>
              </div>
              <div className="batch-line-grid">
                <label className="batch-line-grid__description">
                  {t("sku")}
                  <select value={form.itemId} onChange={(event) => setForm((current) => ({ ...current, itemId: event.target.value }))} required>
                    {items.length === 0 ? <option value="">{t("noSkuRowsAvailable")}</option> : items.map((item) => <option key={item.id} value={item.id}>{item.customerName} | {item.locationName} | {item.sku} - {displayDescription(item)}</option>)}
                  </select>
                </label>
                <label>{t("storageSection")}<select value={form.storageSection} onChange={(event) => setForm((current) => ({ ...current, storageSection: event.target.value }))}>{selectedItemSectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
                <label>{t("deliveryDate")}<input type="date" value={form.deliveryDate} onChange={(event) => setForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
                <label>{t("containerNo")}<input value={form.containerNo} onChange={(event) => setForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="MRSU8580370" /></label>
                <label>{t("expectedQty")}<input type="number" min="0" value={numberInputValue(form.expectedQty)} onChange={(event) => setForm((current) => ({ ...current, expectedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                <label>{t("received")}<input type="number" min="0" value={numberInputValue(form.receivedQty)} onChange={(event) => setForm((current) => ({ ...current, receivedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                <label>{t("inboundUnit")}<select value={form.unitLabel} onChange={(event) => setForm((current) => ({ ...current, unitLabel: event.target.value }))}><option value="CTN">CTN</option><option value="PCS">PCS</option><option value="PALLET">PALLET</option></select></label>
                <label>{t("pallets")}<input type="number" min="0" value={numberInputValue(form.pallets)} onChange={(event) => setForm((current) => ({ ...current, pallets: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                <label className="batch-line-grid__detail">{t("palletsDetail")}<input value={form.palletsDetailCtns} onChange={(event) => setForm((current) => ({ ...current, palletsDetailCtns: event.target.value }))} placeholder={suggestedPalletsDetail || "28*115+110"} /></label>
              </div>
              <div className="batch-line-card__meta">
                <span className="batch-line-card__hint">{selectedItem ? `${selectedItem.customerName} | ${selectedItem.sku} | ${displayDescription(selectedItem)} | ${selectedItem.locationName}` : t("noSkuSelected")}</span>
                {suggestedPalletsDetail ? <button className="button button--ghost button--small" type="button" onClick={() => setForm((current) => ({ ...current, palletsDetailCtns: suggestedPalletsDetail }))}>{t("useSuggestion")}: {suggestedPalletsDetail}</button> : null}
              </div>
            </div>
          ) : (
            <div className="batch-line-card inbound-compact-card">
              <div className="batch-line-card__header">
                <div className="batch-line-card__title">
                  <strong>{t("sku")}</strong>
                  <span className={`status-pill ${isAutoMatchedInboundSku ? "status-pill--ok" : "status-pill--alert"}`}>
                    {isAutoMatchedInboundSku ? t("useExistingSku") : t("createNewSku")}
                  </span>
                </div>
              </div>
              <div className="batch-line-grid">
                <label>{t("sku")}<input value={newSkuForm.sku} onChange={(event) => setNewSkuForm((current) => ({ ...current, sku: event.target.value }))} placeholder="023042" required /></label>
                <label>{t("customer")}<select value={newSkuForm.customerId} onChange={(event) => setNewSkuForm((current) => ({ ...current, customerId: event.target.value }))} required>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
                <label>{t("currentStorage")}<select value={newSkuForm.locationId} onChange={(event) => setNewSkuForm((current) => ({ ...current, locationId: event.target.value }))} required>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                <label>{t("storageSection")}<select value={newSkuForm.storageSection} onChange={(event) => setNewSkuForm((current) => ({ ...current, storageSection: event.target.value }))}>{newSkuSectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
                <label className="batch-line-grid__description">{t("description")}<input value={isAutoMatchedInboundSku ? displayDescription(matchingNewSkuItem ?? selectedItem ?? { description: "", name: "" }) : newSkuForm.description} onChange={(event) => setNewSkuForm((current) => ({ ...current, description: event.target.value }))} placeholder={t("descriptionPlaceholder")} required={!isAutoMatchedInboundSku} disabled={isAutoMatchedInboundSku} /></label>
                <label>{t("reorderLevel")}<input type="number" min="0" value={numberInputValue(newSkuForm.reorderLevel)} onChange={(event) => setNewSkuForm((current) => ({ ...current, reorderLevel: Math.max(0, Number(event.target.value || 0)) }))} disabled={isAutoMatchedInboundSku} /></label>
                <label>{t("deliveryDate")}<input type="date" value={form.deliveryDate} onChange={(event) => setForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
                <label>{t("containerNo")}<input value={form.containerNo} onChange={(event) => setForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="MRSU8580370" /></label>
                <label>{t("expectedQty")}<input type="number" min="0" value={numberInputValue(form.expectedQty)} onChange={(event) => setForm((current) => ({ ...current, expectedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                <label>{t("received")}<input type="number" min="0" value={numberInputValue(form.receivedQty)} onChange={(event) => setForm((current) => ({ ...current, receivedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                <label>{t("inboundUnit")}<select value={form.unitLabel} onChange={(event) => setForm((current) => ({ ...current, unitLabel: event.target.value }))}><option value="CTN">CTN</option><option value="PCS">PCS</option><option value="PALLET">PALLET</option></select></label>
                <label>{t("pallets")}<input type="number" min="0" value={numberInputValue(form.pallets)} onChange={(event) => setForm((current) => ({ ...current, pallets: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                <label className="batch-line-grid__detail">{t("palletsDetail")}<input value={form.palletsDetailCtns} onChange={(event) => setForm((current) => ({ ...current, palletsDetailCtns: event.target.value }))} placeholder={suggestedPalletsDetail || "28*115+110"} /></label>
              </div>
              <div className="batch-line-card__meta">
                <span className="batch-line-card__hint">
                  {isAutoMatchedInboundSku
                    ? `${matchingNewSkuItem?.customerName} | ${matchingNewSkuItem?.sku} | ${displayDescription(matchingNewSkuItem ?? { description: "", name: "" })} | ${matchingNewSkuItem?.locationName} | ${matchingNewSkuItem?.storageSection || "A"}`
                    : shouldAutoCreateInboundSku
                      ? `${(customers.find((customer) => String(customer.id) === newSkuForm.customerId)?.name ?? "-")} | ${newSkuForm.sku.trim().toUpperCase()} | ${(locations.find((location) => String(location.id) === newSkuForm.locationId)?.name ?? t("noSkuSelected"))} | ${newSkuForm.storageSection || "A"}`
                      : t("noSkuSelected")}
                </span>
                {suggestedPalletsDetail ? <button className="button button--ghost button--small" type="button" onClick={() => setForm((current) => ({ ...current, palletsDetailCtns: suggestedPalletsDetail }))}>{t("useSuggestion")}: {suggestedPalletsDetail}</button> : null}
              </div>
            </div>
          )}
          <label className="sheet-form__wide">{t("notes")}<input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder={t("inboundNotePlaceholder")} /></label>
        </>
      ) : (
        <>
          <label className="sheet-form__wide">
            {t("sku")}
            <select value={form.itemId} onChange={(event) => setForm((current) => ({ ...current, itemId: event.target.value }))} required>
              {items.length === 0 ? <option value="">{t("noSkuRowsAvailable")}</option> : items.map((item) => <option key={item.id} value={item.id}>{item.customerName} | {item.locationName} | {item.sku} - {displayDescription(item)}</option>)}
            </select>
          </label>
          <div className="sheet-note sheet-form__wide"><strong>{t("selectedDescription")}</strong> {selectedItem ? `${selectedItem.customerName} | ${displayDescription(selectedItem)}` : t("noSkuSelected")}</div>
          <div className="sheet-note sheet-form__wide"><strong>{t("storageSection")}</strong> {selectedItem ? `${selectedItem.locationName} / ${selectedItem.storageSection || form.storageSection || "A"}` : (form.storageSection || "A")}</div>
          <label>{t("packingListNo")}<input value={form.packingListNo} onChange={(event) => setForm((current) => ({ ...current, packingListNo: event.target.value }))} placeholder="TGCUS180265" /></label>
          <label>{t("orderRef")}<input value={form.orderRef} onChange={(event) => setForm((current) => ({ ...current, orderRef: event.target.value }))} placeholder="J73504" /></label>
          <label>{t("outDate")}<input type="date" value={form.outDate} onChange={(event) => setForm((current) => ({ ...current, outDate: event.target.value }))} /></label>
          <label>{t("outQty")}<input type="number" min="0" value={numberInputValue(form.quantity)} onChange={(event) => setForm((current) => ({ ...current, quantity: Math.max(0, Number(event.target.value || 0)) }))} /></label>
          <label>{t("unit")}<input value={form.unitLabel} onChange={(event) => setForm((current) => ({ ...current, unitLabel: event.target.value }))} placeholder="PCS" /></label>
          <label>{t("cartonSize")}<input value={form.cartonSizeMm} onChange={(event) => setForm((current) => ({ ...current, cartonSizeMm: event.target.value }))} placeholder="455*330*325" /></label>
          <label>{t("netWeight")}<input type="number" min="0" step="0.01" value={numberInputValue(form.netWeightKgs)} onChange={(event) => setForm((current) => ({ ...current, netWeightKgs: Math.max(0, Number(event.target.value || 0)) }))} /></label>
          <label>{t("grossWeight")}<input type="number" min="0" step="0.01" value={numberInputValue(form.grossWeightKgs)} onChange={(event) => setForm((current) => ({ ...current, grossWeightKgs: Math.max(0, Number(event.target.value || 0)) }))} /></label>
          <label className="sheet-form__wide">{t("documentNotes")}<input value={form.documentNote} onChange={(event) => setForm((current) => ({ ...current, documentNote: event.target.value }))} placeholder={t("outboundDocumentNotePlaceholder")} /></label>
          <label className="sheet-form__wide">{t("internalNotes")}<input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder={t("outboundInternalNotePlaceholder")} /></label>
        </>
      )}
    </>
  );
}

function displayDescription(item: Pick<Item, "description" | "name">) { return item.description || item.name; }
function formatDate(value: string | null) { return formatDateValue(value, dateFormatter); }
function hasQtyMismatch(expectedQty: number, receivedQty: number) { return expectedQty > 0 && receivedQty > 0 && expectedQty !== receivedQty; }
function toDateInputValue(value: string | null) { return value ? value.slice(0, 10) : ""; }
function numberInputValue(value: number) { return value === 0 ? "" : String(value); }
function getLocationSectionOptions(location: Location | undefined) {
  const sectionNames = location?.sectionNames?.map((sectionName) => sectionName.trim()).filter(Boolean) ?? [];
  return sectionNames.length > 0 ? sectionNames : ["A"];
}

function renderInboundStatus(
  expectedQty: number,
  receivedQty: number,
  t: (key: string) => string
) {
  if (expectedQty > 0 && receivedQty > expectedQty) {
    return <Chip label={t("overReceived")} color="warning" size="small" />;
  }

  if (expectedQty > 0 && receivedQty < expectedQty) {
    return <Chip label={t("shortReceived")} color="error" size="small" />;
  }

  return <Chip label={t("matched")} color="success" size="small" />;
}
