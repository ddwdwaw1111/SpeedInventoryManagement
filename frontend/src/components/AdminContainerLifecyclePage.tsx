import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Container as ContainerIcon,
  ExternalLink,
  MapPinned,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Truck,
  Wrench
} from "lucide-react";

import { api } from "../lib/api";
import { formatContainerStatus, getContainerStatusBadgeVariant } from "../lib/containerLifecycleStatus";
import { formatDateTimeValue } from "../lib/dates";
import { getErrorMessage } from "../lib/errors";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type {
  ContainerLifecycle,
  Customer,
  CustomerPortalContainerSummary,
  DeliveryEventPayload,
  DocumentAttachment,
  InboundDocument,
  Location,
  OutboundDocument,
  PalletTrace
} from "../lib/types";
import { DocumentAttachmentsPanel, type PendingDocumentAttachment } from "./DocumentAttachmentsPanel";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import {
  ContainerLifecycleView,
  type ContainerLifecycleNodeAction
} from "./ContainerLifecycleView";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

type AdminContainerLifecycleScope = {
  customerId: number;
  containerNo: string;
};

type AdminContainerLifecyclePageProps = {
  routeScope: AdminContainerLifecycleScope | null;
  customers: Customer[];
  locations: Location[];
  onOpenContainerLifecycle: (customerId: number, containerNo: string) => void;
  onOpenContainerDetail: (containerNo: string) => void;
  onOpenInboundDetail: (documentId: number) => void;
  onOpenReceiptEditor: (documentId?: number | null) => void;
  onOpenOutboundDocument: (documentId: number) => void;
  onOpenShipmentEditor: (documentId?: number | null) => void;
  onOpenPalletTrace: (sourceInboundDocumentId?: number) => void;
  onBackToContainers: () => void;
};

type ContainerFormState = {
  inboundDocumentId: string;
  locationId: string;
  containerType: string;
  handlingMode: string;
  status: string;
  trackingStatus: string;
  lastEventAt: string;
};

type LifecycleVisibilityFormState = {
  visibility: string;
  displayLabel: string;
};

type TrackingFormState = LifecycleVisibilityFormState & {
  eventType: string;
  eventTime: string;
  location: string;
  notes: string;
};

type PickupFormState = LifecycleVisibilityFormState & {
  assignmentType: string;
  driverName: string;
  vendorName: string;
  phone: string;
  actualPickupAt: string;
  cost: string;
  status: string;
  notes: string;
};

type ReworkFormState = LifecycleVisibilityFormState & {
  referenceNo: string;
  eventType: string;
  eventTime: string;
  notes: string;
  palletIds: number[];
};

type DeliveryFormState = LifecycleVisibilityFormState & {
  deliveryEventId: string;
  outboundDocumentId: string;
  eventType: string;
  eventTime: string;
  driverName: string;
  vendorName: string;
  vehicleNo: string;
  bolNumber: string;
  notes: string;
};

type SelectOption = {
  value: string;
  labelKey?: string;
  label?: string;
};

const TRACKING_EVENT_TYPE_OPTIONS: SelectOption[] = [
  { value: "NOT_ARRIVED", labelKey: "containerLifecycleStatusNotArrived" },
  { value: "ARRIVED_PORT", labelKey: "containerLifecycleStatusArrivedPort" },
  { value: "UNLOADED", labelKey: "containerLifecycleStatusUnloaded" }
];

const CONTAINER_TYPE_OPTIONS: SelectOption[] = [
  { value: "NORMAL", labelKey: "billingContainerTypeNormal" },
  { value: "WEST_COAST_TRANSFER", labelKey: "billingContainerTypeWestCoastTransfer" }
];

const HANDLING_MODE_OPTIONS: SelectOption[] = [
  { value: "PALLETIZED", labelKey: "handlingModePalletized" },
  { value: "SEALED_TRANSIT", labelKey: "handlingModeSealedTransit" }
];

const PICKUP_ASSIGNMENT_TYPE_OPTIONS: SelectOption[] = [
  { value: "OWN_DRIVER", labelKey: "pickupAssignmentOwnDriver" },
  { value: "THIRD_PARTY", labelKey: "pickupAssignmentThirdParty" }
];

const PICKUP_STATUS_OPTIONS: SelectOption[] = [
  { value: "SCHEDULED", labelKey: "pickupStatusScheduled" },
  { value: "PICKED_UP", labelKey: "containerLifecycleStatusPickedUp" },
  { value: "CANCELLED", labelKey: "cancelled" }
];

const REWORK_EVENT_TYPE_OPTIONS: SelectOption[] = [
  { value: "REPACK", labelKey: "reworkEventRepack" },
  { value: "LOAD_CONSOLIDATION_NOTE", labelKey: "reworkEventLoadConsolidation" },
  { value: "REWORK", labelKey: "containerLifecycleStatusReworked" }
];

const DELIVERY_EVENT_TYPE_OPTIONS: SelectOption[] = [
  { value: "DISPATCHED", labelKey: "containerLifecycleStatusDispatched" },
  { value: "DELIVERED", labelKey: "deliveryEventDelivered" },
  { value: "BOL_RECEIVED", labelKey: "containerLifecycleStatusBolReceived" }
];

export function AdminContainerLifecyclePage({
  routeScope,
  customers,
  locations,
  onOpenContainerLifecycle,
  onOpenContainerDetail,
  onOpenInboundDetail,
  onOpenReceiptEditor,
  onOpenOutboundDocument,
  onOpenShipmentEditor,
  onOpenPalletTrace,
  onBackToContainers
}: AdminContainerLifecyclePageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const [selectedCustomerId, setSelectedCustomerId] = useState(routeScope ? String(routeScope.customerId) : "all");
  const [searchDraft, setSearchDraft] = useState(routeScope?.containerNo ?? "");
  const [containerSearch, setContainerSearch] = useState(routeScope?.containerNo ?? "");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [containerSummaries, setContainerSummaries] = useState<CustomerPortalContainerSummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [lifecycle, setLifecycle] = useState<ContainerLifecycle | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");
  const [selectedNode, setSelectedNode] = useState<ContainerLifecycleNodeAction | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busyAction, setBusyAction] = useState("");
  const [containerForm, setContainerForm] = useState<ContainerFormState>(createEmptyContainerForm());
  const [trackingForm, setTrackingForm] = useState<TrackingFormState>(createEmptyTrackingForm());
  const [pickupForm, setPickupForm] = useState<PickupFormState>(createEmptyPickupForm());
  const [reworkForm, setReworkForm] = useState<ReworkFormState>(createEmptyReworkForm());
  const [deliveryForm, setDeliveryForm] = useState<DeliveryFormState>(createEmptyDeliveryForm());

  const activeCustomerId = routeScope?.customerId ?? parsePositiveInt(selectedCustomerId);
  const activeContainerNo = routeScope?.containerNo ?? "";
  const selectedCustomer = activeCustomerId
    ? customers.find((customer) => customer.id === activeCustomerId) ?? null
    : null;

  useEffect(() => {
    if (!routeScope) {
      return;
    }
    setSelectedCustomerId(String(routeScope.customerId));
    setSearchDraft(routeScope.containerNo);
    setContainerSearch(routeScope.containerNo);
    setSelectedNode(null);
  }, [routeScope]);

  useEffect(() => {
    let active = true;

    async function loadSummaries() {
      setSummaryLoading(true);
      setSummaryError("");
      try {
        const nextSummaries = await api.getV2Containers({
          customerId: selectedCustomerId === "all" ? "all" : Number(selectedCustomerId),
          search: containerSearch,
          limit: 100
        });
        if (!active) return;
        setContainerSummaries(nextSummaries);
      } catch (error) {
        if (!active) return;
        setSummaryError(getErrorMessage(error, t("couldNotLoadReport")));
      } finally {
        if (active) {
          setSummaryLoading(false);
        }
      }
    }

    void loadSummaries();
    return () => {
      active = false;
    };
  }, [containerSearch, selectedCustomerId, t]);

  useEffect(() => {
    let active = true;

    async function loadLifecycle() {
      if (!activeCustomerId || !activeContainerNo) {
        setLifecycle(null);
        setLifecycleError("");
        return;
      }
      setLifecycleLoading(true);
      setLifecycleError("");
      try {
        const nextLifecycle = await api.getV2ContainerLifecycle(activeContainerNo, activeCustomerId);
        if (!active) return;
        setLifecycle(nextLifecycle);
        setContainerForm(createContainerFormFromLifecycle(nextLifecycle));
        setTrackingForm(createEmptyTrackingForm());
        setPickupForm(createEmptyPickupForm());
        setReworkForm(createReworkFormFromLifecycle(nextLifecycle));
        setDeliveryForm(createDeliveryFormFromLifecycle(nextLifecycle));
      } catch (error) {
        if (!active) return;
        const message = getErrorMessage(error, t("customerPortalLoadFailed"));
        setLifecycleError(message);
        setLifecycle(null);
      } finally {
        if (active) {
          setLifecycleLoading(false);
        }
      }
    }

    void loadLifecycle();
    return () => {
      active = false;
    };
  }, [activeContainerNo, activeCustomerId, reloadToken, t]);

  const lifecycleTitle = activeContainerNo
    ? `${t("adminContainerLifecyclePage")} ${activeContainerNo}`
    : t("adminContainerLifecyclePage");
  const visiblePallets = useMemo(() => lifecycle?.pallets ?? [], [lifecycle?.pallets]);
  const filteredSummaries = useMemo(
    () => selectedStatus === "all"
      ? containerSummaries
      : containerSummaries.filter((summary) => summary.status === selectedStatus),
    [containerSummaries, selectedStatus]
  );
  const totalPages = Math.max(1, Math.ceil(filteredSummaries.length / pageSize));
  const boundedCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = (boundedCurrentPage - 1) * pageSize;
  const pageRows = filteredSummaries.slice(pageStartIndex, pageStartIndex + pageSize);
  const displayStart = filteredSummaries.length === 0 ? 0 : pageStartIndex + 1;
  const displayEnd = Math.min(pageStartIndex + pageSize, filteredSummaries.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [containerSearch, selectedCustomerId, selectedStatus, pageSize]);

  function refreshLifecycle() {
    setReloadToken((current) => current + 1);
  }

  function openSummary(summary: CustomerPortalContainerSummary) {
    onOpenContainerLifecycle(summary.customerId, summary.containerNo);
  }

  function submitTableSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setContainerSearch(searchDraft.trim());
  }

  function clearTableFilters() {
    setSelectedCustomerId("all");
    setSearchDraft("");
    setContainerSearch("");
    setSelectedStatus("all");
  }

  async function handleSaveContainer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeCustomerId || !activeContainerNo) {
      return;
    }
    await runBusyAction("container", async () => {
      await api.saveV2Container({
        customerId: activeCustomerId,
        containerNo: activeContainerNo,
        inboundDocumentId: parseOptionalPositiveInt(containerForm.inboundDocumentId),
        locationId: parseOptionalPositiveInt(containerForm.locationId),
        containerType: containerForm.containerType || undefined,
        handlingMode: containerForm.handlingMode || undefined,
        status: containerForm.status || undefined,
        trackingStatus: containerForm.trackingStatus || undefined,
        lastEventAt: containerForm.lastEventAt || undefined
      });
      showSuccess(t("adminContainerLifecycleSaved"));
      refreshLifecycle();
    });
  }

  async function handleCreateTrackingEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeCustomerId || !activeContainerNo) {
      return;
    }
    await runBusyAction("tracking", async () => {
      await api.createV2ContainerTrackingEvent(activeContainerNo, {
        customerId: activeCustomerId,
        eventType: trackingForm.eventType,
        eventTime: trackingForm.eventTime,
        location: trackingForm.location,
        notes: trackingForm.notes,
        visibility: trackingForm.visibility,
        displayLabel: trackingForm.displayLabel
      });
      showSuccess(t("adminContainerLifecycleSaved"));
      refreshLifecycle();
    });
  }

  async function handleCreatePickupAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeCustomerId || !activeContainerNo) {
      return;
    }
    await runBusyAction("pickup", async () => {
      const usesOwnDriver = pickupForm.assignmentType === "OWN_DRIVER";
      await api.createV2ContainerPickupAssignment(activeContainerNo, {
        customerId: activeCustomerId,
        assignmentType: pickupForm.assignmentType,
        driverName: pickupForm.driverName,
        vendorName: usesOwnDriver ? "" : pickupForm.vendorName,
        phone: usesOwnDriver ? "" : pickupForm.phone,
        actualPickupAt: pickupForm.actualPickupAt,
        cost: Number(pickupForm.cost || 0),
        status: pickupForm.status,
        notes: pickupForm.notes,
        visibility: pickupForm.visibility,
        displayLabel: pickupForm.displayLabel
      });
      showSuccess(t("adminContainerLifecycleSaved"));
      refreshLifecycle();
    });
  }

  async function handleCreateReworkEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeCustomerId || !activeContainerNo || reworkForm.palletIds.length === 0) {
      setLifecycleError(t("adminContainerLifecycleSelectPallet"));
      return;
    }
    await runBusyAction("rework", async () => {
      await api.recordV2PalletRework({
        customerId: activeCustomerId,
        containerNo: activeContainerNo,
        referenceNo: reworkForm.referenceNo,
        eventType: reworkForm.eventType,
        eventTime: reworkForm.eventTime,
        notes: reworkForm.notes,
        visibility: reworkForm.visibility,
        displayLabel: reworkForm.displayLabel,
        palletIds: reworkForm.palletIds
      });
      showSuccess(t("adminContainerLifecycleSaved"));
      refreshLifecycle();
    });
  }

  async function handleCreateDeliveryEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeCustomerId || !activeContainerNo) {
      return;
    }
    const payload: DeliveryEventPayload = {
      customerId: activeCustomerId,
      containerNo: activeContainerNo,
      outboundDocumentId: parseOptionalPositiveInt(deliveryForm.outboundDocumentId),
      eventType: deliveryForm.eventType,
      eventTime: deliveryForm.eventTime,
      driverName: deliveryForm.driverName,
      vendorName: deliveryForm.vendorName,
      vehicleNo: deliveryForm.vehicleNo,
      bolNumber: deliveryForm.bolNumber,
      notes: deliveryForm.notes,
      visibility: deliveryForm.visibility,
      displayLabel: deliveryForm.displayLabel
    };

    await runBusyAction("delivery", async () => {
      const deliveryEventId = parseOptionalPositiveInt(deliveryForm.deliveryEventId);
      if (deliveryForm.eventType === "BOL_RECEIVED" && deliveryEventId) {
        await api.receiveV2DeliveryBOL(deliveryEventId, payload);
      } else {
        await api.createV2DeliveryEvent(payload);
      }
      showSuccess(t("adminContainerLifecycleSaved"));
      refreshLifecycle();
    });
  }

  async function runDocumentMutation(action: () => Promise<void>, successMessage: string) {
    setBusyAction("documents");
    setLifecycleError("");
    try {
      await action();
      showSuccess(successMessage);
      refreshLifecycle();
    } catch (error) {
      const message = getErrorMessage(error, t("couldNotSaveChanges"));
      setLifecycleError(message);
      showError(message);
      throw error;
    } finally {
      setBusyAction("");
    }
  }

  async function handleUploadInboundDocumentAttachment(document: InboundDocument, file: File, displayName: string) {
    await runDocumentMutation(
      async () => {
        await api.uploadInboundDocumentAttachment(document.id, file, displayName);
      },
      t("attachmentsSavedSuccess")
    );
  }

  async function handleUploadOutboundDocumentAttachment(document: OutboundDocument, file: File, displayName: string) {
    await runDocumentMutation(
      async () => {
        await api.uploadOutboundDocumentAttachment(document.id, file, displayName);
      },
      t("attachmentsSavedSuccess")
    );
  }

  async function handleReplaceInboundDocumentAttachment(document: InboundDocument, file: File, displayName: string) {
    await runDocumentMutation(async () => {
      for (const attachment of document.attachments ?? []) {
        await api.deleteInboundDocumentAttachment(document.id, attachment.id);
      }
      await api.uploadInboundDocumentAttachment(document.id, file, displayName);
    }, t("adminContainerLifecycleDocumentReplaced"));
  }

  async function handleReplaceOutboundDocumentAttachment(document: OutboundDocument, file: File, displayName: string) {
    await runDocumentMutation(async () => {
      for (const attachment of document.attachments ?? []) {
        await api.deleteOutboundDocumentAttachment(document.id, attachment.id);
      }
      await api.uploadOutboundDocumentAttachment(document.id, file, displayName);
    }, t("adminContainerLifecycleDocumentReplaced"));
  }

  async function handleDeleteInboundDocumentAttachments(document: InboundDocument) {
    await runDocumentMutation(async () => {
      for (const attachment of document.attachments ?? []) {
        await api.deleteInboundDocumentAttachment(document.id, attachment.id);
      }
    }, t("adminContainerLifecycleDocumentDeleted"));
  }

  async function handleDeleteInboundDocumentAttachment(document: InboundDocument, attachment: DocumentAttachment) {
    await runDocumentMutation(async () => {
      await api.deleteInboundDocumentAttachment(document.id, attachment.id);
    }, t("adminContainerLifecycleDocumentDeleted"));
  }

  async function handleDeleteOutboundDocumentAttachments(document: OutboundDocument) {
    await runDocumentMutation(async () => {
      for (const attachment of document.attachments ?? []) {
        await api.deleteOutboundDocumentAttachment(document.id, attachment.id);
      }
    }, t("adminContainerLifecycleDocumentDeleted"));
  }

  async function handleDeleteOutboundDocumentAttachment(document: OutboundDocument, attachment: DocumentAttachment) {
    await runDocumentMutation(async () => {
      await api.deleteOutboundDocumentAttachment(document.id, attachment.id);
    }, t("adminContainerLifecycleDocumentDeleted"));
  }

  async function runBusyAction(key: string, action: () => Promise<void>) {
    setBusyAction(key);
    setLifecycleError("");
    try {
      await action();
    } catch (error) {
      const message = getErrorMessage(error, t("couldNotSaveChanges"));
      setLifecycleError(message);
      showError(message);
    } finally {
      setBusyAction("");
    }
  }

  if (!routeScope) {
    return (
      <main className="workspace-main">
        <section className="workbook-panel workbook-panel--full">
          <div className="tab-strip">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-950">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                    <ContainerIcon className="h-5 w-5" />
                  </span>
                  {t("adminContainerLifecyclePage")}
                </h1>
                <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-500">{t("adminContainerLifecycleTableDesc")}</p>
                {summaryError ? <InlineAlert severity="error">{summaryError}</InlineAlert> : null}
              </div>
            </div>

            <form className="mt-6 grid gap-3 rounded-xl bg-slate-50 p-3 lg:grid-cols-[minmax(260px,1fr)_220px_220px_auto_auto]" onSubmit={submitTableSearch}>
              <label className="sr-only" htmlFor="container-lifecycle-search">{t("search")}</label>
              <input
                id="container-lifecycle-search"
                className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 text-sm shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder={t("customerPortalContainerSearch")}
              />
              <label className="sr-only" htmlFor="container-lifecycle-customer">{t("customer")}</label>
              <select
                id="container-lifecycle-customer"
                className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                value={selectedCustomerId}
                onChange={(event) => setSelectedCustomerId(event.target.value)}
              >
                <option value="all">{t("allCustomers")}</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
              </select>
              <label className="sr-only" htmlFor="container-lifecycle-status">{t("status")}</label>
              <select
                id="container-lifecycle-status"
                className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                value={selectedStatus}
                onChange={(event) => setSelectedStatus(event.target.value)}
              >
                <option value="all">{t("allStatuses")}</option>
                {["PENDING", "IN_STOCK", "PARTIAL", "SHIPPED", "DEPLETED"].map((status) => (
                  <option key={status} value={status}>{formatContainerStatus(status, t)}</option>
                ))}
              </select>
              <Button type="submit" className="min-h-11">
                <Search className="h-4 w-4" />
                {t("search")}
              </Button>
              <Button type="button" variant="outline" className="min-h-11" onClick={clearTableFilters}>
                <RotateCcw className="h-4 w-4" />
                {t("clear")}
              </Button>
            </form>
          </div>

          <div className="overflow-x-auto">
            <Table aria-label={t("adminContainerLifecyclePage")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("containerNo")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead>{t("warehouses")}</TableHead>
                  <TableHead>{t("received")}</TableHead>
                  <TableHead>{t("customerPortalContainerCurrent")}</TableHead>
                  <TableHead>{t("customerPortalContainerShippedQty")}</TableHead>
                  <TableHead>{t("customerPortalPickingOrders")}</TableHead>
                  <TableHead>{t("customerPortalContainerTransfers")}</TableHead>
                  <TableHead>{t("lastActivity")}</TableHead>
                  <TableHead className="text-right">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-slate-500">{t("loadingRecords")}</TableCell>
                  </TableRow>
                ) : pageRows.length > 0 ? pageRows.map((summary) => (
                  <TableRow key={`${summary.customerId}-${summary.containerNo}`}>
                    <TableCell>
                      <div className="font-mono text-sm font-bold text-slate-950">{summary.containerNo}</div>
                      <div className="mt-1 text-xs text-slate-500">{summary.packingListCount} {t("customerPortalPackingLists")}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getContainerStatusBadgeVariant(summary.status)}>
                        {formatContainerStatus(summary.status, t)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[220px] whitespace-normal text-slate-700">
                      {summary.warehouses.join(", ") || "-"}
                    </TableCell>
                    <TableCell>{summary.totalReceivedQty}</TableCell>
                    <TableCell>
                      <Badge variant={summary.currentQty > 0 ? "success" : "secondary"}>{summary.currentQty}</Badge>
                    </TableCell>
                    <TableCell>{summary.shippedQty}</TableCell>
                    <TableCell>
                      <div>{summary.outboundOrderCount}</div>
                      {summary.pickingOrderRefs.length > 0 ? (
                        <div className="mt-1 text-xs text-slate-500">{summary.pickingOrderRefs.slice(0, 3).join(", ")}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>{summary.transferCount}</TableCell>
                    <TableCell>{summary.lastActivityAt ? formatDateTimeValue(summary.lastActivityAt, resolvedTimeZone) : "-"}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => openSummary(summary)}>
                        {t("viewDetails")}
                      </Button>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-slate-500">{t("noResults")}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-5 flex flex-col gap-3 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
            <div>{t("customerPortalInventoryPageSummary", { start: displayStart, end: displayEnd, total: filteredSummaries.length })}</div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                {t("customerPortalInventoryRowsPerPage")}
                <select
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                >
                  {[10, 25, 50].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <span className="font-semibold text-slate-600">{t("customerPortalInventoryPageStatus", { page: boundedCurrentPage, pages: totalPages })}</span>
              <Button type="button" variant="outline" size="icon" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={boundedCurrentPage <= 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={boundedCurrentPage >= totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const sidePanel = lifecycle ? (
    <AdminLifecycleNodePanel
      node={selectedNode}
      lifecycle={lifecycle}
      containerForm={containerForm}
      trackingForm={trackingForm}
      pickupForm={pickupForm}
      reworkForm={reworkForm}
      deliveryForm={deliveryForm}
      pallets={visiblePallets}
      locations={locations}
      busyAction={busyAction}
      onContainerFormChange={setContainerForm}
      onTrackingFormChange={setTrackingForm}
      onPickupFormChange={setPickupForm}
      onReworkFormChange={setReworkForm}
      onDeliveryFormChange={setDeliveryForm}
      onSaveContainer={handleSaveContainer}
      onCreateTrackingEvent={handleCreateTrackingEvent}
      onCreatePickupAssignment={handleCreatePickupAssignment}
      onCreateReworkEvent={handleCreateReworkEvent}
      onCreateDeliveryEvent={handleCreateDeliveryEvent}
      onUploadInboundDocumentAttachment={handleUploadInboundDocumentAttachment}
      onUploadOutboundDocumentAttachment={handleUploadOutboundDocumentAttachment}
      onReplaceInboundDocumentAttachment={handleReplaceInboundDocumentAttachment}
      onReplaceOutboundDocumentAttachment={handleReplaceOutboundDocumentAttachment}
      onDeleteInboundDocumentAttachments={handleDeleteInboundDocumentAttachments}
      onDeleteOutboundDocumentAttachments={handleDeleteOutboundDocumentAttachments}
      onDeleteInboundDocumentAttachment={handleDeleteInboundDocumentAttachment}
      onDeleteOutboundDocumentAttachment={handleDeleteOutboundDocumentAttachment}
      onOpenContainerDetail={() => onOpenContainerDetail(activeContainerNo)}
      onOpenInboundDetail={onOpenInboundDetail}
      onOpenReceiptEditor={onOpenReceiptEditor}
      onOpenOutboundDocument={onOpenOutboundDocument}
      onOpenShipmentEditor={onOpenShipmentEditor}
      onOpenPalletTrace={onOpenPalletTrace}
    />
  ) : null;

  return (
    <main className="workspace-main">
      <div className="space-y-4 pb-4">
        <ContainerLifecycleView
          containerNo={activeContainerNo || null}
          lifecycle={lifecycle}
          visibilityMode="admin"
          isLoading={lifecycleLoading}
          errorMessage={lifecycleError}
          title={lifecycleTitle}
          description={selectedCustomer ? `${selectedCustomer.name} - ${t("adminContainerLifecycleNodeHint")}` : t("adminContainerLifecycleNodeHint")}
          backLabel={t("backToContainers")}
          onBack={onBackToContainers}
          actions={(
            <Button type="button" variant="outline" onClick={refreshLifecycle} disabled={!activeCustomerId || !activeContainerNo || lifecycleLoading}>
              <RefreshCw className="h-4 w-4" />
              {t("refresh")}
            </Button>
          )}
          sidePanel={sidePanel}
          selectedNodeId={selectedNode?.id ?? null}
          onNodeSelect={setSelectedNode}
          documentActions={{
            onOpenPackingList: (document) => onOpenInboundDetail(document.id),
            onEditPackingList: (document) => onOpenReceiptEditor(document.id),
            onOpenPickingOrder: (document) => onOpenOutboundDocument(document.id),
            onEditPickingOrder: (document) => onOpenShipmentEditor(document.id)
          }}
        />
      </div>
      {feedbackToast}
    </main>
  );
}

function AdminLifecycleNodePanel({
  node,
  lifecycle,
  containerForm,
  trackingForm,
  pickupForm,
  reworkForm,
  deliveryForm,
  pallets,
  locations,
  busyAction,
  onContainerFormChange,
  onTrackingFormChange,
  onPickupFormChange,
  onReworkFormChange,
  onDeliveryFormChange,
  onSaveContainer,
  onCreateTrackingEvent,
  onCreatePickupAssignment,
  onCreateReworkEvent,
  onCreateDeliveryEvent,
  onUploadInboundDocumentAttachment,
  onUploadOutboundDocumentAttachment,
  onReplaceInboundDocumentAttachment,
  onReplaceOutboundDocumentAttachment,
  onDeleteInboundDocumentAttachments,
  onDeleteOutboundDocumentAttachments,
  onDeleteInboundDocumentAttachment,
  onDeleteOutboundDocumentAttachment,
  onOpenContainerDetail,
  onOpenInboundDetail,
  onOpenReceiptEditor,
  onOpenOutboundDocument,
  onOpenShipmentEditor,
  onOpenPalletTrace
}: {
  node: ContainerLifecycleNodeAction | null;
  lifecycle: ContainerLifecycle;
  containerForm: ContainerFormState;
  trackingForm: TrackingFormState;
  pickupForm: PickupFormState;
  reworkForm: ReworkFormState;
  deliveryForm: DeliveryFormState;
  pallets: PalletTrace[];
  locations: Location[];
  busyAction: string;
  onContainerFormChange: (nextForm: ContainerFormState) => void;
  onTrackingFormChange: (nextForm: TrackingFormState) => void;
  onPickupFormChange: (nextForm: PickupFormState) => void;
  onReworkFormChange: (nextForm: ReworkFormState) => void;
  onDeliveryFormChange: (nextForm: DeliveryFormState) => void;
  onSaveContainer: (event: FormEvent<HTMLFormElement>) => void;
  onCreateTrackingEvent: (event: FormEvent<HTMLFormElement>) => void;
  onCreatePickupAssignment: (event: FormEvent<HTMLFormElement>) => void;
  onCreateReworkEvent: (event: FormEvent<HTMLFormElement>) => void;
  onCreateDeliveryEvent: (event: FormEvent<HTMLFormElement>) => void;
  onUploadInboundDocumentAttachment: (document: InboundDocument, file: File, displayName: string) => Promise<void>;
  onUploadOutboundDocumentAttachment: (document: OutboundDocument, file: File, displayName: string) => Promise<void>;
  onReplaceInboundDocumentAttachment: (document: InboundDocument, file: File, displayName: string) => Promise<void>;
  onReplaceOutboundDocumentAttachment: (document: OutboundDocument, file: File, displayName: string) => Promise<void>;
  onDeleteInboundDocumentAttachments: (document: InboundDocument) => Promise<void>;
  onDeleteOutboundDocumentAttachments: (document: OutboundDocument) => Promise<void>;
  onDeleteInboundDocumentAttachment: (document: InboundDocument, attachment: DocumentAttachment) => Promise<void>;
  onDeleteOutboundDocumentAttachment: (document: OutboundDocument, attachment: DocumentAttachment) => Promise<void>;
  onOpenContainerDetail: () => void;
  onOpenInboundDetail: (documentId: number) => void;
  onOpenReceiptEditor: (documentId?: number | null) => void;
  onOpenOutboundDocument: (documentId: number) => void;
  onOpenShipmentEditor: (documentId?: number | null) => void;
  onOpenPalletTrace: (sourceInboundDocumentId?: number) => void;
}) {
  const { t } = useI18n();
  const selectedPackingList = node?.documentId ? lifecycle.packingLists.find((document) => document.id === node.documentId) : lifecycle.packingLists[0];
  const selectedPickingOrder = node?.outboundDocumentId ? lifecycle.pickingOrders.find((document) => document.id === node.outboundDocumentId) : lifecycle.pickingOrders[0];
  const shouldShowContainerForm = !node || node.kind === "container" || node.kind === "inventory" || node.kind === "complete";
  const selectedLocationID = containerForm.locationId;
  const locationOptions = buildLocationOptions(locations, selectedLocationID, t);
  const usesOwnDriver = pickupForm.assignmentType === "OWN_DRIVER";

  return (
    <Card className="sticky top-4">
      <CardHeader>
        <CardTitle>{node?.title ?? t("adminContainerLifecycleNodePanel")}</CardTitle>
        <p className="text-sm leading-6 text-slate-500">{node ? t("adminContainerLifecycleEditHint") : t("adminContainerLifecycleSelectNodeHint")}</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {shouldShowContainerForm ? (
          <form className="grid gap-3" onSubmit={onSaveContainer}>
            <PanelSectionTitle icon={<ContainerIcon className="h-4 w-4" />} title={t("containerStatus")} />
            <TextInput label={t("inboundDetailPage")} value={containerForm.inboundDocumentId} onChange={(value) => onContainerFormChange({ ...containerForm, inboundDocumentId: value })} />
            <SelectInput label={t("currentStorage")} value={containerForm.locationId} options={locationOptions} onChange={(value) => onContainerFormChange({ ...containerForm, locationId: value })} />
            <SelectInput label={t("billingContainerType")} value={containerForm.containerType} options={CONTAINER_TYPE_OPTIONS} onChange={(value) => onContainerFormChange({ ...containerForm, containerType: value })} />
            <SelectInput label={t("handlingMode")} value={containerForm.handlingMode} options={HANDLING_MODE_OPTIONS} onChange={(value) => onContainerFormChange({ ...containerForm, handlingMode: value })} />
            <TextInput type="datetime-local" label={t("lastActivity")} value={containerForm.lastEventAt} onChange={(value) => onContainerFormChange({ ...containerForm, lastEventAt: value })} />
            <Button type="submit" disabled={busyAction === "container"}>{busyAction === "container" ? t("saving") : t("saveChanges")}</Button>
            <Button type="button" variant="outline" onClick={onOpenContainerDetail}>
              <ExternalLink className="h-4 w-4" />
              {t("viewContainerDetail")}
            </Button>
          </form>
        ) : null}

        {node?.kind === "tracking" ? (
          <form className="grid gap-3" onSubmit={onCreateTrackingEvent}>
            <PanelSectionTitle icon={<MapPinned className="h-4 w-4" />} title={t("containerLifecycleTrackingNode")} />
            <SelectInput label={t("eventType")} value={trackingForm.eventType} options={TRACKING_EVENT_TYPE_OPTIONS} onChange={(value) => onTrackingFormChange({ ...trackingForm, eventType: value })} />
            <VisibilityFields value={trackingForm} onChange={(nextFields) => onTrackingFormChange({ ...trackingForm, ...nextFields })} />
            <TextInput type="datetime-local" label={t("eventTime")} value={trackingForm.eventTime} onChange={(value) => onTrackingFormChange({ ...trackingForm, eventTime: value })} />
            <TextInput label={t("location")} value={trackingForm.location} onChange={(value) => onTrackingFormChange({ ...trackingForm, location: value })} />
            <TextInput label={t("notes")} value={trackingForm.notes} onChange={(value) => onTrackingFormChange({ ...trackingForm, notes: value })} />
            <Button type="submit" disabled={busyAction === "tracking"}>{busyAction === "tracking" ? t("saving") : t("adminContainerLifecycleSubmitChanges")}</Button>
          </form>
        ) : null}

        {node?.kind === "pickup" ? (
          <form className="grid gap-3" onSubmit={onCreatePickupAssignment}>
            <PanelSectionTitle icon={<Truck className="h-4 w-4" />} title={t("containerLifecyclePickupNode")} />
            <SelectInput label={t("assignmentType")} value={pickupForm.assignmentType} options={PICKUP_ASSIGNMENT_TYPE_OPTIONS} onChange={(value) => onPickupFormChange({ ...pickupForm, assignmentType: value })} />
            <VisibilityFields value={pickupForm} onChange={(nextFields) => onPickupFormChange({ ...pickupForm, ...nextFields })} />
            <TextInput label={t("driverName")} value={pickupForm.driverName} onChange={(value) => onPickupFormChange({ ...pickupForm, driverName: value })} />
            {!usesOwnDriver ? (
              <>
                <TextInput label={t("vendorName")} value={pickupForm.vendorName} onChange={(value) => onPickupFormChange({ ...pickupForm, vendorName: value })} />
                <TextInput label={t("phone")} value={pickupForm.phone} onChange={(value) => onPickupFormChange({ ...pickupForm, phone: value })} />
              </>
            ) : null}
            <TextInput type="datetime-local" label={t("actualPickupAt")} value={pickupForm.actualPickupAt} onChange={(value) => onPickupFormChange({ ...pickupForm, actualPickupAt: value })} />
            <TextInput type="number" label={t("cost")} value={pickupForm.cost} onChange={(value) => onPickupFormChange({ ...pickupForm, cost: value })} />
            <SelectInput label={t("status")} value={pickupForm.status} options={PICKUP_STATUS_OPTIONS} onChange={(value) => onPickupFormChange({ ...pickupForm, status: value })} />
            <TextInput label={t("notes")} value={pickupForm.notes} onChange={(value) => onPickupFormChange({ ...pickupForm, notes: value })} />
            <Button type="submit" disabled={busyAction === "pickup"}>{busyAction === "pickup" ? t("saving") : t("adminContainerLifecycleSubmitChanges")}</Button>
          </form>
        ) : null}

        {node?.kind === "rework" ? (
          <form className="grid gap-3" onSubmit={onCreateReworkEvent}>
            <PanelSectionTitle icon={<Wrench className="h-4 w-4" />} title={t("containerLifecycleReworkNode")} />
            <TextInput label={t("referenceNo")} value={reworkForm.referenceNo} onChange={(value) => onReworkFormChange({ ...reworkForm, referenceNo: value })} />
            <SelectInput label={t("eventType")} value={reworkForm.eventType} options={REWORK_EVENT_TYPE_OPTIONS} onChange={(value) => onReworkFormChange({ ...reworkForm, eventType: value })} />
            <VisibilityFields value={reworkForm} onChange={(nextFields) => onReworkFormChange({ ...reworkForm, ...nextFields })} />
            <TextInput type="datetime-local" label={t("eventTime")} value={reworkForm.eventTime} onChange={(value) => onReworkFormChange({ ...reworkForm, eventTime: value })} />
            <TextInput label={t("notes")} value={reworkForm.notes} onChange={(value) => onReworkFormChange({ ...reworkForm, notes: value })} />
            <PalletChecklist pallets={pallets} selectedIds={reworkForm.palletIds} onChange={(palletIds) => onReworkFormChange({ ...reworkForm, palletIds })} />
            <Button type="submit" disabled={busyAction === "rework"}>{busyAction === "rework" ? t("saving") : t("adminContainerLifecycleSubmitChanges")}</Button>
          </form>
        ) : null}

        {node?.kind === "delivery" ? (
          <form className="grid gap-3" onSubmit={onCreateDeliveryEvent}>
            <PanelSectionTitle icon={<Truck className="h-4 w-4" />} title={t("containerLifecycleDeliveryNode")} />
            <TextInput label={t("deliveryEventId")} value={deliveryForm.deliveryEventId} onChange={(value) => onDeliveryFormChange({ ...deliveryForm, deliveryEventId: value })} />
            <TextInput label={t("customerPortalPickingOrders")} value={deliveryForm.outboundDocumentId} onChange={(value) => onDeliveryFormChange({ ...deliveryForm, outboundDocumentId: value })} />
            <SelectInput label={t("eventType")} value={deliveryForm.eventType} options={DELIVERY_EVENT_TYPE_OPTIONS} onChange={(value) => onDeliveryFormChange({ ...deliveryForm, eventType: value })} />
            <VisibilityFields value={deliveryForm} onChange={(nextFields) => onDeliveryFormChange({ ...deliveryForm, ...nextFields })} />
            <TextInput type="datetime-local" label={t("eventTime")} value={deliveryForm.eventTime} onChange={(value) => onDeliveryFormChange({ ...deliveryForm, eventTime: value })} />
            <TextInput label={t("driverName")} value={deliveryForm.driverName} onChange={(value) => onDeliveryFormChange({ ...deliveryForm, driverName: value })} />
            <TextInput label={t("vendorName")} value={deliveryForm.vendorName} onChange={(value) => onDeliveryFormChange({ ...deliveryForm, vendorName: value })} />
            <TextInput label={t("vehicleNo")} value={deliveryForm.vehicleNo} onChange={(value) => onDeliveryFormChange({ ...deliveryForm, vehicleNo: value })} />
            <TextInput label={t("bolNumber")} value={deliveryForm.bolNumber} onChange={(value) => onDeliveryFormChange({ ...deliveryForm, bolNumber: value })} />
            <TextInput label={t("notes")} value={deliveryForm.notes} onChange={(value) => onDeliveryFormChange({ ...deliveryForm, notes: value })} />
            <Button type="submit" disabled={busyAction === "delivery"}>{busyAction === "delivery" ? t("saving") : t("adminContainerLifecycleSubmitChanges")}</Button>
          </form>
        ) : null}

        {node?.kind === "documents" || node?.kind === "packing-list" || node?.kind === "receiving" ? (
          <DocumentActions
            icon={<ClipboardList className="h-4 w-4" />}
            title={t("customerPortalLifecycleDocuments")}
            document={selectedPackingList}
            emptyLabel={t("noPackingLists")}
            onOpen={(document) => onOpenInboundDetail(document.id)}
            onEdit={(document) => onOpenReceiptEditor(document.id)}
            onUpload={onUploadInboundDocumentAttachment}
            onGetDownloadUrl={async (attachment) => {
              const result = await api.getInboundDocumentAttachmentDownloadUrl(attachment.documentId, attachment.id);
              return result.url;
            }}
            onReplace={onReplaceInboundDocumentAttachment}
            onDeleteDocument={onDeleteInboundDocumentAttachments}
            onDeleteAttachment={onDeleteInboundDocumentAttachment}
          />
        ) : null}

        {node?.kind === "picking-order" ? (
          <DocumentActions
            icon={<Send className="h-4 w-4" />}
            title={t("customerPortalPickingOrders")}
            document={selectedPickingOrder}
            emptyLabel={t("noPickingOrders")}
            onOpen={(document) => onOpenOutboundDocument(document.id)}
            onEdit={(document) => onOpenShipmentEditor(document.id)}
            onUpload={onUploadOutboundDocumentAttachment}
            onGetDownloadUrl={async (attachment) => {
              const result = await api.getOutboundDocumentAttachmentDownloadUrl(attachment.documentId, attachment.id);
              return result.url;
            }}
            onReplace={onReplaceOutboundDocumentAttachment}
            onDeleteDocument={onDeleteOutboundDocumentAttachments}
            onDeleteAttachment={onDeleteOutboundDocumentAttachment}
          />
        ) : null}

        {node?.kind === "transfer" ? (
          <QuickActionPanel
            icon={<RefreshCwIcon />}
            title={t("customerPortalContainerTransfers")}
            description={t("adminContainerLifecycleTransferHint")}
            actions={<Button type="button" onClick={() => onOpenPalletTrace(lifecycle.summary.firstPackingListId)}>{t("palletTrace")}</Button>}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function PanelSectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-950">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-700">{icon}</span>
      <span>{title}</span>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "datetime-local";
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700">
      {label}
      <input
        type={type}
        className="rounded-md border border-slate-200 px-3 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectInput({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700">
      {label}
      <select
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.labelKey ? t(option.labelKey) : option.label ?? option.value}
          </option>
        ))}
      </select>
    </label>
  );
}

function buildLocationOptions(locations: Location[], currentLocationId: string, t: (key: string) => string): SelectOption[] {
  const options: SelectOption[] = [
    { value: "", label: t("selectWarehouse") }
  ];
  const seenValues = new Set(options.map((option) => option.value));
  for (const location of locations) {
    const value = String(location.id);
    options.push({ value, label: location.name });
    seenValues.add(value);
  }
  if (currentLocationId && !seenValues.has(currentLocationId)) {
    options.push({ value: currentLocationId, label: `#${currentLocationId}` });
  }
  return options;
}

function defaultAttachmentDisplayName(fileName: string) {
  return fileName.trim() || "document";
}

function VisibilityFields({
  value,
  onChange
}: {
  value: LifecycleVisibilityFormState;
  onChange: (nextFields: LifecycleVisibilityFormState) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        {t("lifecycleVisibility")}
        <select
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          value={normalizeLifecycleVisibilityFormValue(value.visibility)}
          onChange={(event) => onChange({ ...value, visibility: event.target.value })}
        >
          <option value="PUBLIC">{t("lifecycleVisibilityPublic")}</option>
          <option value="INTERNAL">{t("lifecycleVisibilityInternal")}</option>
        </select>
      </label>
      <TextInput label={t("displayLabel")} value={value.displayLabel} onChange={(displayLabel) => onChange({ ...value, displayLabel })} />
    </div>
  );
}

function PalletChecklist({
  pallets,
  selectedIds,
  onChange
}: {
  pallets: PalletTrace[];
  selectedIds: number[];
  onChange: (nextIds: number[]) => void;
}) {
  const { t } = useI18n();
  const visiblePallets = pallets.slice(0, 12);

  if (visiblePallets.length === 0) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">{t("containerDetailNoCurrentPallets")}</div>;
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-slate-700">{t("palletTrace")}</legend>
      <div className="max-h-56 overflow-auto rounded-md border border-slate-200 p-2">
        {visiblePallets.map((pallet) => {
          const checked = selectedIds.includes(pallet.id);
          return (
            <label key={pallet.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                className="mt-1"
                checked={checked}
                onChange={() => {
                  onChange(checked ? selectedIds.filter((id) => id !== pallet.id) : [...selectedIds, pallet.id]);
                }}
              />
              <span>
                <span className="block font-mono font-semibold text-slate-950">{pallet.palletCode}</span>
                <span className="block text-xs text-slate-500">{pallet.currentLocationName || "-"} / {pallet.currentStorageSection || "-"}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function DocumentActions<TDocument extends InboundDocument | OutboundDocument>({
  icon,
  title,
  document,
  emptyLabel,
  onOpen,
  onEdit,
  onUpload,
  onGetDownloadUrl,
  onReplace,
  onDeleteDocument,
  onDeleteAttachment
}: {
  icon: ReactNode;
  title: string;
  document?: TDocument;
  emptyLabel: string;
  onOpen: (document: TDocument) => void;
  onEdit: (document: TDocument) => void;
  onUpload?: (document: TDocument, file: File, displayName: string) => Promise<void>;
  onGetDownloadUrl?: (attachment: DocumentAttachment) => Promise<string>;
  onReplace?: (document: TDocument, file: File, displayName: string) => Promise<void>;
  onDeleteDocument?: (document: TDocument) => Promise<void>;
  onDeleteAttachment?: (document: TDocument, attachment: DocumentAttachment) => Promise<void>;
}) {
  const { t } = useI18n();
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingDocumentAttachment[]>([]);
  const [replacementAttachment, setReplacementAttachment] = useState<PendingDocumentAttachment | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const attachments = document?.attachments ?? [];
  const canManageAttachments = Boolean(document && onUpload && onGetDownloadUrl);

  function handleReplacementSelected(files: FileList | null) {
    const file = files?.[0];
    if (!file) {
      return;
    }
    setReplacementAttachment({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      displayName: defaultAttachmentDisplayName(file.name)
    });
    setErrorMessage("");
    if (replaceInputRef.current) {
      replaceInputRef.current.value = "";
    }
  }

  function updateReplacementDisplayName(displayName: string) {
    setReplacementAttachment((current) => current ? { ...current, displayName } : current);
  }

  async function saveReplacement() {
    if (!document || !replacementAttachment || !onReplace) {
      return;
    }
    setBusyAction("replace");
    setErrorMessage("");
    try {
      await onReplace(document, replacementAttachment.file, replacementAttachment.displayName.trim() || replacementAttachment.file.name);
      setReplacementAttachment(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, t("couldNotSaveChanges")));
    } finally {
      setBusyAction("");
    }
  }

  async function deleteDocumentAttachments() {
    if (!document || !onDeleteDocument || attachments.length === 0) {
      return;
    }
    setBusyAction("delete");
    setErrorMessage("");
    try {
      await onDeleteDocument(document);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, t("couldNotSaveChanges")));
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <PanelSectionTitle icon={icon} title={title} />
      {document ? (
        <>
          <div className="text-sm text-slate-600">
            <div className="font-semibold text-slate-950">#{document.id}</div>
            <div>{document.status || "-"}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => onOpen(document)}>{t("view")}</Button>
            <Button type="button" onClick={() => onEdit(document)}>{t("edit")}</Button>
          </div>
          {canManageAttachments && onGetDownloadUrl ? (
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3">
              <DocumentAttachmentsPanel
                attachments={attachments}
                pendingAttachments={pendingAttachments}
                canUploadNow
                onPendingAttachmentsChange={setPendingAttachments}
                onUpload={async (file, displayName) => {
                  await onUpload?.(document, file, displayName);
                }}
                onGetDownloadUrl={onGetDownloadUrl}
                onDelete={onDeleteAttachment ? async (attachment) => {
                  if (!onDeleteAttachment) {
                    return;
                  }
                  await onDeleteAttachment(document, attachment);
                } : undefined}
              />
              <div className="grid gap-2 rounded-md border border-dashed border-slate-300 p-3">
                <input
                  ref={replaceInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => handleReplacementSelected(event.target.files)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => replaceInputRef.current?.click()} disabled={Boolean(busyAction)}>
                    {t("replaceDocument")}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void deleteDocumentAttachments()} disabled={attachments.length === 0 || busyAction === "delete"}>
                    {busyAction === "delete" ? t("saving") : t("deleteDocument")}
                  </Button>
                </div>
                {replacementAttachment ? (
                  <div className="grid gap-2">
                    <div className="text-xs text-slate-500">{t("selectedReplacementDocument")}: {replacementAttachment.file.name}</div>
                    <TextInput label={t("fileDisplayName")} value={replacementAttachment.displayName} onChange={updateReplacementDisplayName} />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={() => void saveReplacement()} disabled={busyAction === "replace"}>
                        {busyAction === "replace" ? t("saving") : t("saveChanges")}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setReplacementAttachment(null)} disabled={Boolean(busyAction)}>
                        {t("cancel")}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {errorMessage ? <InlineAlert severity="error">{errorMessage}</InlineAlert> : null}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="text-sm text-slate-500">{emptyLabel}</div>
      )}
    </div>
  );
}

function QuickActionPanel({
  icon,
  title,
  description,
  actions
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actions: ReactNode;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <PanelSectionTitle icon={icon} title={title} />
      <p className="text-sm leading-6 text-slate-500">{description}</p>
      {actions}
    </div>
  );
}

function RefreshCwIcon() {
  return <RefreshCw className="h-4 w-4" />;
}

function createEmptyContainerForm(): ContainerFormState {
  return {
    inboundDocumentId: "",
    locationId: "",
    containerType: "NORMAL",
    handlingMode: "PALLETIZED",
    status: "PENDING",
    trackingStatus: "TRACKING_RECEIVED",
    lastEventAt: toDateTimeInputValue(new Date())
  };
}

function createContainerFormFromLifecycle(lifecycle: ContainerLifecycle): ContainerFormState {
  const container = lifecycle.container;
  const firstPackingList = lifecycle.packingLists[0];
  return {
    inboundDocumentId: String(container?.inboundDocumentId || firstPackingList?.id || ""),
    locationId: String(container?.locationId || firstPackingList?.locationId || ""),
    containerType: container?.containerType || firstPackingList?.containerType || "NORMAL",
    handlingMode: container?.handlingMode || firstPackingList?.handlingMode || "PALLETIZED",
    status: container?.status || lifecycle.summary.status || "PENDING",
    trackingStatus: container?.trackingStatus || firstPackingList?.trackingStatus || "TRACKING_RECEIVED",
    lastEventAt: toDateTimeInputValue(container?.lastEventAt || lifecycle.summary.lastActivityAt || new Date())
  };
}

function createDefaultVisibilityFields(): LifecycleVisibilityFormState {
  return {
    visibility: "PUBLIC",
    displayLabel: ""
  };
}

function normalizeLifecycleVisibilityFormValue(value: string | null | undefined) {
  return String(value || "").toUpperCase() === "INTERNAL" ? "INTERNAL" : "PUBLIC";
}

function createEmptyTrackingForm(): TrackingFormState {
  return {
    ...createDefaultVisibilityFields(),
    eventType: "NOT_ARRIVED",
    eventTime: toDateTimeInputValue(new Date()),
    location: "",
    notes: ""
  };
}

function createEmptyPickupForm(): PickupFormState {
  return {
    ...createDefaultVisibilityFields(),
    assignmentType: "OWN_DRIVER",
    driverName: "",
    vendorName: "",
    phone: "",
    actualPickupAt: toDateTimeInputValue(new Date()),
    cost: "",
    status: "PICKED_UP",
    notes: ""
  };
}

function createEmptyReworkForm(): ReworkFormState {
  return {
    ...createDefaultVisibilityFields(),
    referenceNo: "",
    eventType: "REPACK",
    eventTime: toDateTimeInputValue(new Date()),
    notes: "",
    palletIds: []
  };
}

function createReworkFormFromLifecycle(lifecycle: ContainerLifecycle): ReworkFormState {
  return {
    ...createEmptyReworkForm(),
    palletIds: lifecycle.pallets.length === 1 ? [lifecycle.pallets[0].id] : []
  };
}

function createEmptyDeliveryForm(): DeliveryFormState {
  return {
    ...createDefaultVisibilityFields(),
    deliveryEventId: "",
    outboundDocumentId: "",
    eventType: "DISPATCHED",
    eventTime: toDateTimeInputValue(new Date()),
    driverName: "",
    vendorName: "",
    vehicleNo: "",
    bolNumber: "",
    notes: ""
  };
}

function createDeliveryFormFromLifecycle(lifecycle: ContainerLifecycle): DeliveryFormState {
  const latestDelivery = lifecycle.deliveryEvents[0];
  const firstPickingOrder = lifecycle.pickingOrders[0];
  return {
    deliveryEventId: latestDelivery ? String(latestDelivery.id) : "",
    outboundDocumentId: String(latestDelivery?.outboundDocumentId || firstPickingOrder?.id || ""),
    eventType: latestDelivery?.bolReceivedAt ? "BOL_RECEIVED" : "DISPATCHED",
    eventTime: toDateTimeInputValue(latestDelivery?.eventTime || new Date()),
    driverName: latestDelivery?.driverName || "",
    vendorName: latestDelivery?.vendorName || "",
    vehicleNo: latestDelivery?.vehicleNo || "",
    bolNumber: latestDelivery?.bolNumber || "",
    notes: latestDelivery?.notes || "",
    visibility: normalizeLifecycleVisibilityFormValue(latestDelivery?.visibility),
    displayLabel: latestDelivery?.displayLabel || latestDelivery?.publicLabel || latestDelivery?.internalLabel || ""
  };
}

function toDateTimeInputValue(value: string | Date | null | undefined) {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parsePositiveInt(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseOptionalPositiveInt(value: string) {
  const parsed = parsePositiveInt(value);
  return parsed > 0 ? parsed : undefined;
}

function normalizeContainerNo(value: string) {
  return value.trim().toUpperCase();
}
