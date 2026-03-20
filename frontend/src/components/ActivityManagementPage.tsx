import { type Dispatch, type FormEvent, type SetStateAction, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { formatDateValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import type { Item, ItemPayload, Location, Movement, MovementPayload } from "../lib/types";

type ActivityMode = "IN" | "OUT";

type ActivityManagementPageProps = {
  mode: ActivityMode;
  items: Item[];
  locations: Location[];
  movements: Movement[];
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
  itemNumber: string;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  palletsDetailCtns: string;
  cartonSizeMm: string;
  cartonCount: number;
  unitLabel: string;
  netWeightKgs: number;
  grossWeightKgs: number;
  heightIn: number;
  outDate: string;
  reason: string;
  referenceCode: string;
};

type NewSkuFormState = {
  sku: string;
  description: string;
  locationId: string;
  storageSection: string;
  reorderLevel: number;
};

type BatchInboundFormState = {
  deliveryDate: string;
  containerNo: string;
  locationId: string;
  storageSection: string;
  unitLabel: string;
  reason: string;
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
    itemNumber: "",
    expectedQty: 0,
    receivedQty: 0,
    pallets: 0,
    palletsDetailCtns: "",
    cartonSizeMm: "",
    cartonCount: 0,
    unitLabel: "PCS",
    netWeightKgs: 0,
    grossWeightKgs: 0,
    heightIn: mode === "IN" ? 0 : 87,
    outDate: "",
    reason: mode === "IN" ? "Inbound shipment recorded" : "Outbound shipment recorded",
    referenceCode: ""
  };
}

function createEmptyNewSkuForm(defaultLocationId = ""): NewSkuFormState {
  return {
    sku: "",
    description: "",
    locationId: defaultLocationId,
    storageSection: "A",
    reorderLevel: 0
  };
}

function createEmptyBatchInboundForm(): BatchInboundFormState {
  return {
    deliveryDate: "",
    containerNo: "",
    locationId: "",
    storageSection: "A",
    unitLabel: "PCS",
    reason: "Inbound shipment recorded"
  };
}

function createEmptyBatchInboundLine(defaultSku = ""): BatchInboundLineState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku: defaultSku,
    description: "",
    reorderLevel: 0,
    expectedQty: 0,
    receivedQty: 0,
    pallets: 0,
    palletsDetailCtns: ""
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

export function ActivityManagementPage({ mode, items, locations, movements, isLoading, onRefresh }: ActivityManagementPageProps) {
  const { t } = useI18n();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [form, setForm] = useState<ActivityFormState>(() => createEmptyActivityForm(mode));
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [editingMovementId, setEditingMovementId] = useState<number | null>(null);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [newSkuForm, setNewSkuForm] = useState<NewSkuFormState>(() => createEmptyNewSkuForm(""));
  const [batchForm, setBatchForm] = useState<BatchInboundFormState>(() => createEmptyBatchInboundForm());
  const [batchLines, setBatchLines] = useState<BatchInboundLineState[]>(() => [createEmptyBatchInboundLine("")]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const deferredSearchTerm = useDeferredValue(searchTerm);

  useEffect(() => {
    setForm((current) => ({ ...createEmptyActivityForm(mode), itemId: current.itemId }));
    setEditingMovementId(null);
    setIsFormModalOpen(false);
    setIsBatchModalOpen(false);
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
    if (!batchForm.locationId && locations[0]) {
      setBatchForm((current) => ({ ...current, locationId: String(locations[0].id) }));
    }
  }, [batchForm.locationId, locations]);

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
    const storageSection = newSkuForm.storageSection.trim();
    if (!normalizedSku || !locationID || !storageSection) return undefined;
    return items.find((item) =>
      item.sku.trim().toUpperCase() === normalizedSku
      && item.locationId === locationID
      && item.storageSection === storageSection
    );
  }, [items, newSkuForm.locationId, newSkuForm.sku, newSkuForm.storageSection]);
  const historyRows = useMemo(() => movements.filter((movement) => movement.movementType === mode), [mode, movements]);
  const isAutoMatchedInboundSku = mode === "IN" && editingMovementId === null && Boolean(matchingNewSkuItem);
  const shouldAutoCreateInboundSku = mode === "IN" && editingMovementId === null && !matchingNewSkuItem && Boolean(newSkuForm.sku.trim());

  useEffect(() => {
    if (selectedItem) {
      const fallbackSection = selectedItem.storageSection || selectedItemSectionOptions[0] || "A";
      setForm((current) => current.storageSection === fallbackSection ? current : { ...current, storageSection: fallbackSection });
    }
  }, [selectedItem, selectedItemSectionOptions]);

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
      const fallbackSection = matchingNewSkuItem.storageSection || selectedItemSectionOptions[0] || "A";
      setForm((current) => ({
        ...current,
        itemId: String(matchingNewSkuItem.id),
        storageSection: fallbackSection
      }));
      setNewSkuForm((current) => ({
        ...current,
        locationId: String(matchingNewSkuItem.locationId),
        storageSection: fallbackSection,
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
      || movement.description.toLowerCase().includes(normalizedSearch)
      || movement.containerNo.toLowerCase().includes(normalizedSearch)
      || movement.referenceCode.toLowerCase().includes(normalizedSearch)
      || movement.packingListNo.toLowerCase().includes(normalizedSearch)
      || movement.orderRef.toLowerCase().includes(normalizedSearch)
      || movement.itemNumber.toLowerCase().includes(normalizedSearch);
    const matchesLocation = selectedLocationId === "all"
      || items.find((item) => item.id === movement.itemId)?.locationId === Number(selectedLocationId);
    return matchesSearch && matchesLocation;
  });

  const inboundColumns = useMemo<GridColDef<Movement>[]>(() => [
    { field: "deliveryDate", headerName: t("deliveryDate"), minWidth: 140, renderCell: (params) => formatDate(params.row.deliveryDate) },
    { field: "containerNo", headerName: t("containerNo"), minWidth: 170, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.containerNo || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 260, flex: 1.4, renderCell: (params) => params.row.description },
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
      minWidth: 180,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <div className="table-actions">
          <Button size="small" variant="outlined" onClick={() => openEditModal(params.row)}>{t("edit")}</Button>
          <Button size="small" color="error" variant="outlined" onClick={() => void handleDeleteMovement(params.row)}>{t("delete")}</Button>
        </div>
      )
    }
  ], [items, selectedLocationId, t]);

  const outboundColumns = useMemo<GridColDef<Movement>[]>(() => [
    { field: "sn", headerName: "SN", minWidth: 80, sortable: false, filterable: false, renderCell: (params) => filteredRows.findIndex((row) => row.id === params.row.id) + 1 },
    { field: "packingListNo", headerName: t("packingListNo"), minWidth: 170, renderCell: (params) => <span className="cell--mono">{params.row.packingListNo || "-"}</span> },
    { field: "orderRef", headerName: t("orderRef"), minWidth: 150, renderCell: (params) => <span className="cell--mono">{params.row.orderRef || "-"}</span> },
    { field: "itemNumber", headerName: t("itemNumber"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.itemNumber || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 260, flex: 1.4, renderCell: (params) => params.row.description },
    { field: "quantityChange", headerName: "QTY", minWidth: 100, type: "number", renderCell: (params) => Math.abs(params.row.quantityChange) || "-" },
    { field: "unitLabel", headerName: t("unit"), minWidth: 90, renderCell: (params) => params.row.unitLabel || "-" },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 110, renderCell: (params) => params.row.storageSection || "A" },
    { field: "cartonSizeMm", headerName: t("cartonSize"), minWidth: 150, renderCell: (params) => <span className="cell--mono">{params.row.cartonSizeMm || "-"}</span> },
    { field: "cartonCount", headerName: t("cartonCount"), minWidth: 90, type: "number", renderCell: (params) => params.row.cartonCount || "-" },
    { field: "netWeightKgs", headerName: t("netWeight"), minWidth: 110, type: "number", renderCell: (params) => params.row.netWeightKgs ? params.row.netWeightKgs.toFixed(2) : "-" },
    { field: "grossWeightKgs", headerName: t("grossWeight"), minWidth: 110, type: "number", renderCell: (params) => params.row.grossWeightKgs ? params.row.grossWeightKgs.toFixed(2) : "-" },
    { field: "outDate", headerName: t("outDate"), minWidth: 130, renderCell: (params) => formatDate(params.row.outDate) },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 180,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <div className="table-actions">
          <Button size="small" variant="outlined" onClick={() => openEditModal(params.row)}>{t("edit")}</Button>
          <Button size="small" color="error" variant="outlined" onClick={() => void handleDeleteMovement(params.row)}>{t("delete")}</Button>
        </div>
      )
    }
  ], [filteredRows, t]);

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
          unit: (form.unitLabel || "PCS").toLowerCase(),
          quantity: 0,
          reorderLevel: newSkuForm.reorderLevel,
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
      storageSection: form.storageSection || selectedItem?.storageSection || matchingNewSkuItem?.storageSection || "A",
      deliveryDate: form.deliveryDate || undefined,
      containerNo: form.containerNo || undefined,
      packingListNo: form.packingListNo || undefined,
      orderRef: form.orderRef || undefined,
      itemNumber: form.itemNumber || undefined,
      expectedQty: form.expectedQty,
      receivedQty: form.receivedQty,
      pallets: form.pallets,
      palletsDetailCtns: form.palletsDetailCtns || undefined,
      cartonSizeMm: form.cartonSizeMm || undefined,
      cartonCount: form.cartonCount,
      unitLabel: form.unitLabel || undefined,
      netWeightKgs: form.netWeightKgs,
      grossWeightKgs: form.grossWeightKgs,
      heightIn: form.heightIn,
      outDate: form.outDate || undefined,
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
      setNewSkuForm(createEmptyNewSkuForm(locations[0] ? String(locations[0].id) : ""));
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
    setEditingMovementId(null);
    setForm((current) => ({ ...createEmptyActivityForm(mode), itemId: current.itemId || (items[0] ? String(items[0].id) : "") }));
    setNewSkuForm(createEmptyNewSkuForm(locations[0] ? String(locations[0].id) : ""));
    setErrorMessage("");
    setIsFormModalOpen(true);
  }

  function openBatchModal() {
    setBatchForm({ ...createEmptyBatchInboundForm(), locationId: locations[0] ? String(locations[0].id) : "" });
    setBatchLines([createEmptyBatchInboundLine(items[0]?.sku ?? "")]);
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
      itemNumber: movement.itemNumber,
      expectedQty: movement.expectedQty,
      receivedQty: movement.receivedQty,
      pallets: movement.pallets,
      palletsDetailCtns: movement.palletsDetailCtns,
      cartonSizeMm: movement.cartonSizeMm,
      cartonCount: movement.cartonCount,
      unitLabel: movement.unitLabel || "PCS",
      netWeightKgs: movement.netWeightKgs,
      grossWeightKgs: movement.grossWeightKgs,
      heightIn: movement.heightIn || 87,
      outDate: toDateInputValue(movement.outDate),
      reason: movement.reason,
      referenceCode: movement.referenceCode
    });
    setNewSkuForm(createEmptyNewSkuForm(locations[0] ? String(locations[0].id) : ""));
    setErrorMessage("");
    setIsFormModalOpen(true);
  }

  async function handleDeleteMovement(movement: Movement) {
    if (!window.confirm(mode === "IN" ? t("deleteInboundConfirm", { sku: movement.sku }) : t("deleteOutboundConfirm", { sku: movement.sku }))) return;

    setErrorMessage("");
    try {
      await api.deleteMovement(movement.id);
      if (editingMovementId === movement.id) {
        setEditingMovementId(null);
        setIsFormModalOpen(false);
      }
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotDeleteActivity"));
    }
  }

  function closeFormModal() {
    setEditingMovementId(null);
    setIsFormModalOpen(false);
    setForm((current) => ({ ...createEmptyActivityForm(mode), itemId: current.itemId }));
    setNewSkuForm(createEmptyNewSkuForm(locations[0] ? String(locations[0].id) : ""));
    setErrorMessage("");
  }

  function closeBatchModal() {
    setBatchForm({ ...createEmptyBatchInboundForm(), locationId: locations[0] ? String(locations[0].id) : "" });
    setBatchLines([createEmptyBatchInboundLine(items[0]?.sku ?? "")]);
    setBatchSubmitting(false);
    setErrorMessage("");
    setIsBatchModalOpen(false);
  }

  function addBatchLine() {
    setBatchLines((current) => [...current, createEmptyBatchInboundLine("")]);
  }

  function removeBatchLine(lineID: string) {
    setBatchLines((current) => current.length === 1 ? current : current.filter((line) => line.id !== lineID));
  }

  function updateBatchLine(lineID: string, updates: Partial<BatchInboundLineState>) {
    setBatchLines((current) => current.map((line) => line.id === lineID ? { ...line, ...updates } : line));
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

    try {
      for (const line of validLines) {
        const normalizedSku = line.sku.trim().toUpperCase();
        const matchingItem = items.find((item) =>
          item.sku.trim().toUpperCase() === normalizedSku
          && item.locationId === Number(batchForm.locationId)
          && item.storageSection === batchForm.storageSection
        );
        const matchingTemplate = items.find((item) => item.sku.trim().toUpperCase() === normalizedSku);
        let itemID = matchingItem?.id ?? 0;

        if (!itemID) {
          const locationId = Number(batchForm.locationId);
          const lineDescription = line.description.trim() || displayDescription(matchingTemplate ?? { description: "", name: "" });
          if (!locationId || !lineDescription) {
            throw new Error(t("batchInboundMissingNewSkuDetails", { sku: normalizedSku || "-" }));
          }

          const createdItem = await api.createItem({
            sku: normalizedSku,
            name: lineDescription,
            category: "General",
            description: lineDescription,
            unit: (batchForm.unitLabel || "PCS").toLowerCase(),
            quantity: 0,
            reorderLevel: line.reorderLevel || matchingTemplate?.reorderLevel || 0,
            locationId,
            storageSection: batchForm.storageSection || "A",
            deliveryDate: batchForm.deliveryDate || undefined,
            containerNo: batchForm.containerNo || undefined,
            expectedQty: line.expectedQty,
            receivedQty: line.receivedQty,
            pallets: line.pallets,
            palletsDetailCtns: line.palletsDetailCtns || undefined,
            heightIn: 0
          });
          itemID = createdItem.id;
        }

        const payload: MovementPayload = {
          itemId: itemID,
          movementType: "IN",
          quantity: line.receivedQty || line.expectedQty,
          storageSection: matchingItem?.storageSection || batchForm.storageSection || "A",
          deliveryDate: batchForm.deliveryDate || undefined,
          containerNo: batchForm.containerNo || undefined,
          expectedQty: line.expectedQty,
          receivedQty: line.receivedQty,
          pallets: line.pallets,
          palletsDetailCtns: line.palletsDetailCtns || undefined,
          unitLabel: batchForm.unitLabel || undefined,
          heightIn: 0,
          reason: batchForm.reason || undefined
        };

        await api.createMovement(payload);
      }

      closeBatchModal();
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveActivity"));
    } finally {
      setBatchSubmitting(false);
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
                <Button variant="contained" onClick={openCreateModal}>{mode === "IN" ? t("newInbound") : t("newOutbound")}</Button>
                {mode === "IN" ? <Button variant="outlined" onClick={openBatchModal}>{t("batchInbound")}</Button> : null}
              </div>
            </div>
              <div className="filter-bar">
                <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={mode === "IN" ? t("searchInboundPlaceholder") : t("searchOutboundPlaceholder")} /></label>
                <label>{t("currentStorage")}<select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}><option value="all">{t("allStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            </div>
          </div>
          <div className="sheet-table-wrap">
            <Box sx={{ minWidth: 0 }}>
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
        maxWidth="md"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {editingMovementId ? (mode === "IN" ? t("updateInboundRow") : t("updateOutboundRow")) : (mode === "IN" ? t("addInboundRow") : t("addOutboundRow"))}
          <IconButton aria-label={t("close")} onClick={closeFormModal} sx={{ position: "absolute", right: 16, top: 16 }}>
            <span aria-hidden="true">x</span>
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <ActivityFormFields
              mode={mode}
              form={form}
              setForm={setForm}
              items={items}
              locations={locations}
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
          open={isBatchModalOpen}
          onClose={(_, reason) => {
            if (reason === "backdropClick") return;
            closeBatchModal();
          }}
          fullWidth
          maxWidth="lg"
        >
          <DialogTitle sx={{ pb: 1 }}>
            {t("batchInboundTitle")}
            <IconButton aria-label={t("close")} onClick={closeBatchModal} sx={{ position: "absolute", right: 16, top: 16 }}>
              <span aria-hidden="true">x</span>
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}
            <form onSubmit={handleBatchSubmit}>
              <div className="sheet-form sheet-form--compact">
                <label>{t("deliveryDate")}<input type="date" value={batchForm.deliveryDate} onChange={(event) => setBatchForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
                <label>{t("containerNo")}<input value={batchForm.containerNo} onChange={(event) => setBatchForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="MRSU8580370" /></label>
                <label>{t("currentStorage")}<select value={batchForm.locationId} onChange={(event) => setBatchForm((current) => ({ ...current, locationId: event.target.value }))}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                <label>{t("storageSection")}<select value={batchForm.storageSection} onChange={(event) => setBatchForm((current) => ({ ...current, storageSection: event.target.value }))}>{batchSectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
                <label>{t("inboundUnit")}<select value={batchForm.unitLabel} onChange={(event) => setBatchForm((current) => ({ ...current, unitLabel: event.target.value }))}><option value="PCS">PCS</option><option value="CTN">CTN</option><option value="PALLET">PALLET</option></select></label>
                <label className="sheet-form__wide">{t("notes")}<input value={batchForm.reason} onChange={(event) => setBatchForm((current) => ({ ...current, reason: event.target.value }))} placeholder={t("inboundNotePlaceholder")} /></label>
              </div>

              <div className="batch-lines">
                <div className="batch-lines__toolbar">
                  <strong>{t("skuLines")}</strong>
                  <Button size="small" variant="outlined" onClick={addBatchLine}>{t("addSkuLine")}</Button>
                </div>

                {batchLines.map((line, index) => {
                  const selectedBatchItem = items.find((item) =>
                    item.sku.trim().toUpperCase() === line.sku.trim().toUpperCase()
                    && item.locationId === Number(batchForm.locationId)
                    && item.storageSection === batchForm.storageSection
                  );
                  const batchSkuTemplate = items.find((item) => item.sku.trim().toUpperCase() === line.sku.trim().toUpperCase());
                  const suggestedPalletsDetail = getSuggestedPalletsDetail(line.receivedQty || line.expectedQty, line.pallets);

                  return (
                    <div className="batch-line-card" key={line.id}>
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
                        <label>{t("reorderLevel")}<input type="number" min="0" value={line.reorderLevel} onChange={(event) => updateBatchLine(line.id, { reorderLevel: Math.max(0, Number(event.target.value || 0)) })} /></label>
                        <label className="batch-line-grid__description">{t("description")}<input value={selectedBatchItem ? displayDescription(selectedBatchItem) : (line.description || displayDescription(batchSkuTemplate ?? { description: "", name: "" }))} onChange={(event) => updateBatchLine(line.id, { description: event.target.value })} placeholder={t("descriptionPlaceholder")} disabled={Boolean(selectedBatchItem)} /></label>
                        <label>{t("expectedQty")}<input type="number" min="0" value={line.expectedQty} onChange={(event) => updateBatchLine(line.id, { expectedQty: Math.max(0, Number(event.target.value || 0)) })} /></label>
                        <label>{t("received")}<input type="number" min="0" value={line.receivedQty} onChange={(event) => updateBatchLine(line.id, { receivedQty: Math.max(0, Number(event.target.value || 0)) })} /></label>
                        <label>{t("pallets")}<input type="number" min="0" value={line.pallets} onChange={(event) => updateBatchLine(line.id, { pallets: Math.max(0, Number(event.target.value || 0)) })} /></label>
                        <label>{t("storageSection")}<input value={selectedBatchItem?.storageSection || batchForm.storageSection || "A"} readOnly /></label>
                        <label className="batch-line-grid__detail">{t("palletsDetail")}<input value={line.palletsDetailCtns} onChange={(event) => updateBatchLine(line.id, { palletsDetailCtns: event.target.value })} placeholder={suggestedPalletsDetail || "28*115+110"} /></label>
                      </div>
                      <div className="batch-line-card__meta">
                        <span className="batch-line-card__hint">
                          {selectedBatchItem
                            ? `${selectedBatchItem.sku} | ${selectedBatchItem.locationName}`
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
                    {items.length === 0 ? <option value="">{t("noSkuRowsAvailable")}</option> : items.map((item) => <option key={item.id} value={item.id}>{item.sku} - {displayDescription(item)}</option>)}
                  </select>
                </label>
                <label>{t("storageSection")}<select value={form.storageSection} onChange={(event) => setForm((current) => ({ ...current, storageSection: event.target.value }))}>{selectedItemSectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
                <label>{t("deliveryDate")}<input type="date" value={form.deliveryDate} onChange={(event) => setForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
                <label>{t("containerNo")}<input value={form.containerNo} onChange={(event) => setForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="MRSU8580370" /></label>
                <label>{t("expectedQty")}<input type="number" min="0" value={form.expectedQty} onChange={(event) => setForm((current) => ({ ...current, expectedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                <label>{t("received")}<input type="number" min="0" value={form.receivedQty} onChange={(event) => setForm((current) => ({ ...current, receivedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                <label>{t("inboundUnit")}<select value={form.unitLabel} onChange={(event) => setForm((current) => ({ ...current, unitLabel: event.target.value }))}><option value="PCS">PCS</option><option value="CTN">CTN</option><option value="PALLET">PALLET</option></select></label>
                <label>{t("pallets")}<input type="number" min="0" value={form.pallets} onChange={(event) => setForm((current) => ({ ...current, pallets: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                <label className="batch-line-grid__detail">{t("palletsDetail")}<input value={form.palletsDetailCtns} onChange={(event) => setForm((current) => ({ ...current, palletsDetailCtns: event.target.value }))} placeholder={suggestedPalletsDetail || "28*115+110"} /></label>
              </div>
              <div className="batch-line-card__meta">
                <span className="batch-line-card__hint">{selectedItem ? `${selectedItem.sku} | ${displayDescription(selectedItem)} | ${selectedItem.locationName}` : t("noSkuSelected")}</span>
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
                <label>{t("currentStorage")}<select value={isAutoMatchedInboundSku ? String(matchingNewSkuItem?.locationId ?? newSkuForm.locationId) : newSkuForm.locationId} onChange={(event) => setNewSkuForm((current) => ({ ...current, locationId: event.target.value }))} required disabled={isAutoMatchedInboundSku}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                <label>{t("storageSection")}<select value={isAutoMatchedInboundSku ? (matchingNewSkuItem?.storageSection || form.storageSection) : newSkuForm.storageSection} onChange={(event) => isAutoMatchedInboundSku ? setForm((current) => ({ ...current, storageSection: event.target.value })) : setNewSkuForm((current) => ({ ...current, storageSection: event.target.value }))}>{(isAutoMatchedInboundSku ? selectedItemSectionOptions : newSkuSectionOptions).map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
                <label className="batch-line-grid__description">{t("description")}<input value={isAutoMatchedInboundSku ? displayDescription(matchingNewSkuItem ?? selectedItem ?? { description: "", name: "" }) : newSkuForm.description} onChange={(event) => setNewSkuForm((current) => ({ ...current, description: event.target.value }))} placeholder={t("descriptionPlaceholder")} required={!isAutoMatchedInboundSku} disabled={isAutoMatchedInboundSku} /></label>
                <label>{t("reorderLevel")}<input type="number" min="0" value={newSkuForm.reorderLevel} onChange={(event) => setNewSkuForm((current) => ({ ...current, reorderLevel: Math.max(0, Number(event.target.value || 0)) }))} disabled={isAutoMatchedInboundSku} /></label>
                <label>{t("deliveryDate")}<input type="date" value={form.deliveryDate} onChange={(event) => setForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
                <label>{t("containerNo")}<input value={form.containerNo} onChange={(event) => setForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="MRSU8580370" /></label>
                <label>{t("expectedQty")}<input type="number" min="0" value={form.expectedQty} onChange={(event) => setForm((current) => ({ ...current, expectedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                <label>{t("received")}<input type="number" min="0" value={form.receivedQty} onChange={(event) => setForm((current) => ({ ...current, receivedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                <label>{t("inboundUnit")}<select value={form.unitLabel} onChange={(event) => setForm((current) => ({ ...current, unitLabel: event.target.value }))}><option value="PCS">PCS</option><option value="CTN">CTN</option><option value="PALLET">PALLET</option></select></label>
                <label>{t("pallets")}<input type="number" min="0" value={form.pallets} onChange={(event) => setForm((current) => ({ ...current, pallets: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                <label className="batch-line-grid__detail">{t("palletsDetail")}<input value={form.palletsDetailCtns} onChange={(event) => setForm((current) => ({ ...current, palletsDetailCtns: event.target.value }))} placeholder={suggestedPalletsDetail || "28*115+110"} /></label>
              </div>
              <div className="batch-line-card__meta">
                <span className="batch-line-card__hint">
                  {isAutoMatchedInboundSku
                    ? `${matchingNewSkuItem?.sku} | ${displayDescription(matchingNewSkuItem ?? { description: "", name: "" })} | ${matchingNewSkuItem?.locationName}`
                    : shouldAutoCreateInboundSku
                      ? `${newSkuForm.sku.trim().toUpperCase()} | ${(locations.find((location) => String(location.id) === newSkuForm.locationId)?.name ?? t("noSkuSelected"))}`
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
              {items.length === 0 ? <option value="">{t("noSkuRowsAvailable")}</option> : items.map((item) => <option key={item.id} value={item.id}>{item.sku} - {displayDescription(item)}</option>)}
            </select>
          </label>
          <div className="sheet-note sheet-form__wide"><strong>{t("selectedDescription")}</strong> {selectedItem ? displayDescription(selectedItem) : t("noSkuSelected")}</div>
          <div className="sheet-note sheet-form__wide"><strong>{t("storageSection")}</strong> {selectedItem?.storageSection || form.storageSection || "A"}</div>
          <label>{t("packingListNo")}<input value={form.packingListNo} onChange={(event) => setForm((current) => ({ ...current, packingListNo: event.target.value }))} placeholder="TGCUS180265" /></label>
          <label>{t("orderRef")}<input value={form.orderRef} onChange={(event) => setForm((current) => ({ ...current, orderRef: event.target.value }))} placeholder="J73504" /></label>
          <label>{t("outDate")}<input type="date" value={form.outDate} onChange={(event) => setForm((current) => ({ ...current, outDate: event.target.value }))} /></label>
          <label>{t("itemNumber")}<input value={form.itemNumber} onChange={(event) => setForm((current) => ({ ...current, itemNumber: event.target.value }))} placeholder="011522" /></label>
          <label>{t("outQty")}<input type="number" min="0" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Math.max(0, Number(event.target.value || 0)) }))} /></label>
          <label>{t("unit")}<input value={form.unitLabel} onChange={(event) => setForm((current) => ({ ...current, unitLabel: event.target.value }))} placeholder="PCS" /></label>
          <label>{t("cartonSize")}<input value={form.cartonSizeMm} onChange={(event) => setForm((current) => ({ ...current, cartonSizeMm: event.target.value }))} placeholder="455*330*325" /></label>
          <label>{t("cartonCount")}<input type="number" min="0" value={form.cartonCount} onChange={(event) => setForm((current) => ({ ...current, cartonCount: Math.max(0, Number(event.target.value || 0)) }))} /></label>
          <label>{t("netWeight")}<input type="number" min="0" step="0.01" value={form.netWeightKgs} onChange={(event) => setForm((current) => ({ ...current, netWeightKgs: Math.max(0, Number(event.target.value || 0)) }))} /></label>
          <label>{t("grossWeight")}<input type="number" min="0" step="0.01" value={form.grossWeightKgs} onChange={(event) => setForm((current) => ({ ...current, grossWeightKgs: Math.max(0, Number(event.target.value || 0)) }))} /></label>
          <label className="sheet-form__wide">{t("notes")}<input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder={t("outboundNotePlaceholder")} /></label>
        </>
      )}
    </>
  );
}

function displayDescription(item: Pick<Item, "description" | "name">) { return item.description || item.name; }
function formatDate(value: string | null) { return formatDateValue(value, dateFormatter); }
function hasQtyMismatch(expectedQty: number, receivedQty: number) { return expectedQty > 0 && receivedQty > 0 && expectedQty !== receivedQty; }
function toDateInputValue(value: string | null) { return value ? value.slice(0, 10) : ""; }
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
