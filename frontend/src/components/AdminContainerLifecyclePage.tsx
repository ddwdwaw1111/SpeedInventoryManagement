import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Boxes,
  ClipboardList,
  Container as ContainerIcon,
  ExternalLink,
  MapPinned,
  PackageCheck,
  RotateCcw,
  Search,
  Send,
  Truck
} from "lucide-react";

import { api } from "../lib/api";
import { formatContainerStatus, getContainerStatusBadgeVariant } from "../lib/containerLifecycleStatus";
import { formatDateTimeValue } from "../lib/dates";
import { getErrorMessage } from "../lib/errors";
import { formatNumber } from "../lib/formatters";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type {
  ContainerLifecycle,
  ContainerType,
  Customer,
  CustomerPortalContainerSummary,
  DeliveryEventPayload,
  DocumentAttachment,
  InboundDocument,
  Location,
  OutboundDocument
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
  onOpenContainerDetail: (containerNo: string, customerId: number) => void;
  onOpenInboundDetail: (documentId: number) => void;
  onOpenReceiptEditor: (documentId?: number | null) => void;
  onOpenOutboundDocument: (documentId: number) => void;
  onOpenShipmentEditor: (documentId?: number | null) => void;
};

type ContainerFormState = {
  containerType: ContainerType;
  handlingMode: "PALLETIZED" | "SEALED_TRANSIT";
};

type LifecycleVisibilityFormState = {
  visibility: string;
  displayLabel: string;
};

type TrackingFormState = LifecycleVisibilityFormState & {
  eventType: string;
  eventTime: string;
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

type SkuQuantityRow = {
  sku: string;
  pallets: number;
  quantity: number;
  referenceQuantity?: number;
};

type ReceivingSkuQuantityRow = {
  sku: string;
  itemNumber: string;
  expectedQuantity: number;
  receivedPallets: number;
  receivedQuantity: number;
  shortageReason: string;
};

type OutboundOrderGoodsRow = {
  key: string;
  sku: string;
  description: string;
  quantity: number;
  allocatedQty: number;
  pallets: number;
  highlighted: boolean;
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

const DELIVERY_EVENT_TYPE_OPTIONS: SelectOption[] = [
  { value: "DISPATCHED", labelKey: "containerLifecycleStatusDispatched" },
  { value: "DELIVERED", labelKey: "deliveryEventDelivered" },
  { value: "BOL_RECEIVED", labelKey: "containerLifecycleStatusBolReceived" }
];

export function AdminContainerLifecyclePage({
  routeScope,
  customers,
  onOpenContainerLifecycle,
  onOpenContainerDetail,
  onOpenInboundDetail,
  onOpenReceiptEditor,
  onOpenOutboundDocument,
  onOpenShipmentEditor
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
  const [deliveryForm, setDeliveryForm] = useState<DeliveryFormState>(createEmptyDeliveryForm());

  const activeCustomerId = routeScope?.customerId ?? parsePositiveInt(selectedCustomerId);
  const activeContainerNo = routeScope?.containerNo ?? "";

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

  useEffect(() => {
    if (!lifecycle || selectedNode?.kind !== "delivery") {
      return;
    }
    setDeliveryForm(createDeliveryFormFromLifecycle(lifecycle, selectedNode));
  }, [lifecycle, selectedNode]);

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
    if (!activeCustomerId || !activeContainerNo || !lifecycle?.container) {
      return;
    }
    await runBusyAction("container", async () => {
      await api.updateV2ContainerMetadata(activeContainerNo, {
        customerId: activeCustomerId,
        containerType: containerForm.containerType,
        handlingMode: containerForm.handlingMode
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
        notes: trackingForm.notes,
        visibility: trackingForm.visibility
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
        visibility: pickupForm.visibility
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

  async function handleDeleteInboundDocumentAttachment(document: InboundDocument, attachment: DocumentAttachment) {
    await runDocumentMutation(async () => {
      await api.deleteInboundDocumentAttachment(document.id, attachment.id);
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
                  <TableHead>{t("containerLifecycleInboundNode")}</TableHead>
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
      deliveryForm={deliveryForm}
      busyAction={busyAction}
      onContainerFormChange={setContainerForm}
      onTrackingFormChange={setTrackingForm}
      onPickupFormChange={setPickupForm}
      onDeliveryFormChange={setDeliveryForm}
      onSaveContainer={handleSaveContainer}
      onCreateTrackingEvent={handleCreateTrackingEvent}
      onCreatePickupAssignment={handleCreatePickupAssignment}
      onCreateDeliveryEvent={handleCreateDeliveryEvent}
      onUploadInboundDocumentAttachment={handleUploadInboundDocumentAttachment}
      onUploadOutboundDocumentAttachment={handleUploadOutboundDocumentAttachment}
      onDeleteInboundDocumentAttachment={handleDeleteInboundDocumentAttachment}
      onDeleteOutboundDocumentAttachment={handleDeleteOutboundDocumentAttachment}
      onOpenContainerDetail={() => onOpenContainerDetail(activeContainerNo, activeCustomerId!)}
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
          hideHeaderText
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
  deliveryForm,
  busyAction,
  onContainerFormChange,
  onTrackingFormChange,
  onPickupFormChange,
  onDeliveryFormChange,
  onSaveContainer,
  onCreateTrackingEvent,
  onCreatePickupAssignment,
  onCreateDeliveryEvent,
  onUploadInboundDocumentAttachment,
  onUploadOutboundDocumentAttachment,
  onDeleteInboundDocumentAttachment,
  onDeleteOutboundDocumentAttachment,
  onOpenContainerDetail
}: {
  node: ContainerLifecycleNodeAction | null;
  lifecycle: ContainerLifecycle;
  containerForm: ContainerFormState;
  trackingForm: TrackingFormState;
  pickupForm: PickupFormState;
  deliveryForm: DeliveryFormState;
  busyAction: string;
  onContainerFormChange: (nextForm: ContainerFormState) => void;
  onTrackingFormChange: (nextForm: TrackingFormState) => void;
  onPickupFormChange: (nextForm: PickupFormState) => void;
  onDeliveryFormChange: (nextForm: DeliveryFormState) => void;
  onSaveContainer: (event: FormEvent<HTMLFormElement>) => void;
  onCreateTrackingEvent: (event: FormEvent<HTMLFormElement>) => void;
  onCreatePickupAssignment: (event: FormEvent<HTMLFormElement>) => void;
  onCreateDeliveryEvent: (event: FormEvent<HTMLFormElement>) => void;
  onUploadInboundDocumentAttachment: (document: InboundDocument, file: File, displayName: string) => Promise<void>;
  onUploadOutboundDocumentAttachment: (document: OutboundDocument, file: File, displayName: string) => Promise<void>;
  onDeleteInboundDocumentAttachment: (document: InboundDocument, attachment: DocumentAttachment) => Promise<void>;
  onDeleteOutboundDocumentAttachment: (document: OutboundDocument, attachment: DocumentAttachment) => Promise<void>;
  onOpenContainerDetail: () => void;
}) {
  const { t } = useI18n();
  const selectedPackingList = node?.documentId ? lifecycle.packingLists.find((document) => document.id === node.documentId) : lifecycle.packingLists[0];
  const selectedPickingOrder = node?.outboundDocumentId ? lifecycle.pickingOrders.find((document) => document.id === node.outboundDocumentId) : lifecycle.pickingOrders[0];
  const receivingSkuRows = useMemo(() => buildReceivingSkuRows(lifecycle.packingLists), [lifecycle.packingLists]);
  const currentInventorySkuRows = useMemo(
    () => buildCurrentInventorySkuRows(lifecycle.lifecycleEvents, receivingSkuRows),
    [lifecycle.lifecycleEvents, receivingSkuRows]
  );
  const shouldShowContainerForm = !node || node.kind === "container";
  const canEditContainerMetadata = Boolean(lifecycle.container);
  const usesOwnDriver = pickupForm.assignmentType === "OWN_DRIVER";
  const panelTitle = node?.kind === "picking-order" && selectedPickingOrder
    ? getOutboundOrderReference(selectedPickingOrder)
    : node?.title ?? t("adminContainerLifecycleNodePanel");

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden xl:sticky xl:top-4">
      <CardHeader className="shrink-0">
        <CardTitle>{panelTitle}</CardTitle>
      </CardHeader>
      <CardContent className="grid min-h-0 flex-1 auto-rows-max content-start gap-4 overflow-y-auto">
        {shouldShowContainerForm ? (
          <form className="grid gap-3" onSubmit={onSaveContainer}>
            <PanelSectionTitle icon={<ContainerIcon className="h-4 w-4" />} title={t("containerStatus")} />
            <SelectInput disabled={!canEditContainerMetadata} label={t("billingContainerType")} value={containerForm.containerType} options={CONTAINER_TYPE_OPTIONS} onChange={(value) => onContainerFormChange({ ...containerForm, containerType: value as ContainerType })} />
            <SelectInput disabled={!canEditContainerMetadata} label={t("handlingMode")} value={containerForm.handlingMode} options={HANDLING_MODE_OPTIONS} onChange={(value) => onContainerFormChange({ ...containerForm, handlingMode: value as ContainerFormState["handlingMode"] })} />
            {!canEditContainerMetadata ? <InlineAlert severity="info">{t("adminContainerMetadataUnavailableUntilConfirmed")}</InlineAlert> : null}
            {canEditContainerMetadata ? <Button type="submit" disabled={busyAction === "container"}>{busyAction === "container" ? t("saving") : t("saveChanges")}</Button> : null}
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
            <VisibilityFields value={trackingForm} hideDisplayLabel onChange={(nextFields) => onTrackingFormChange({ ...trackingForm, ...nextFields })} />
            <TextInput type="datetime-local" label={t("eventTime")} value={trackingForm.eventTime} onChange={(value) => onTrackingFormChange({ ...trackingForm, eventTime: value })} />
            <TextInput label={t("notes")} value={trackingForm.notes} onChange={(value) => onTrackingFormChange({ ...trackingForm, notes: value })} />
            <Button type="submit" disabled={busyAction === "tracking"}>{busyAction === "tracking" ? t("saving") : t("adminContainerLifecycleSubmitChanges")}</Button>
          </form>
        ) : null}

        {node?.kind === "receiving" ? (
          <ReceivingSkuSummary rows={receivingSkuRows} />
        ) : null}

        {node?.kind === "inventory" ? <CurrentInventorySkuSummary rows={currentInventorySkuRows} /> : null}

        {node?.kind === "picking-order" ? (
          <OutboundOrderSummary document={selectedPickingOrder} containerNo={lifecycle.summary.containerNo} />
        ) : null}

        {node?.kind === "pickup" ? (
          <form className="grid gap-3" onSubmit={onCreatePickupAssignment}>
            <PanelSectionTitle icon={<Truck className="h-4 w-4" />} title={t("containerLifecyclePickupNode")} />
            <SelectInput label={t("assignmentType")} value={pickupForm.assignmentType} options={PICKUP_ASSIGNMENT_TYPE_OPTIONS} onChange={(value) => onPickupFormChange({ ...pickupForm, assignmentType: value })} />
            <VisibilityFields value={pickupForm} hideDisplayLabel onChange={(nextFields) => onPickupFormChange({ ...pickupForm, ...nextFields })} />
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

        {node?.kind === "documents" && node.documentId ? (
          <DocumentActions
            icon={<ClipboardList className="h-4 w-4" />}
            title={t("customerPortalLifecycleDocuments")}
            document={selectedPackingList}
            emptyLabel={t("noPackingLists")}
            onUpload={onUploadInboundDocumentAttachment}
            onGetDownloadUrl={async (attachment) => {
              const result = await api.getInboundDocumentAttachmentDownloadUrl(attachment.documentId, attachment.id);
              return result.url;
            }}
            onDeleteAttachment={onDeleteInboundDocumentAttachment}
          />
        ) : null}

        {node?.kind === "documents" && node.outboundDocumentId ? (
          <DocumentActions
            icon={<Send className="h-4 w-4" />}
            title={t("customerPortalPickingOrders")}
            document={selectedPickingOrder}
            emptyLabel={t("noPickingOrders")}
            onUpload={onUploadOutboundDocumentAttachment}
            onGetDownloadUrl={async (attachment) => {
              const result = await api.getOutboundDocumentAttachmentDownloadUrl(attachment.documentId, attachment.id);
              return result.url;
            }}
            onDeleteAttachment={onDeleteOutboundDocumentAttachment}
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

function ReceivingSkuSummary({ rows }: { rows: ReceivingSkuQuantityRow[] }) {
  const { t } = useI18n();

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <PanelSectionTitle icon={<PackageCheck className="h-4 w-4" />} title={t("containerLifecycleInboundNode")} />
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("sku")}</TableHead>
              <TableHead className="w-24 text-right">{t("expectedQty")}</TableHead>
              <TableHead className="w-24 text-right">{t("receivedPallets")}</TableHead>
              <TableHead className="w-24 text-right">{t("received")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => {
                const shortage = row.receivedQuantity < row.expectedQuantity;
                const overage = row.receivedQuantity > row.expectedQuantity;
                return (
                  <TableRow
                    key={row.sku}
                    className={shortage ? "bg-red-50/70" : overage ? "bg-amber-50/70" : undefined}
                  >
                    <TableCell className="align-top">
                      <div className="font-medium text-slate-950">{row.sku}</div>
                      {shortage ? (
                        <div className="mt-1 grid gap-1">
                          <Badge variant="destructive" className="w-fit">{t("inboundDiscrepancyShortage")}</Badge>
                          <div className="text-xs text-red-700">
                            {t("inboundShortageReason")}: {row.shortageReason || t("inboundDiscrepancyShortage")}
                          </div>
                        </div>
                      ) : overage ? (
                        <Badge variant="warning" className="mt-1 w-fit">{t("inboundDiscrepancyOverage")}</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top text-right tabular-nums">{formatNumber(row.expectedQuantity)}</TableCell>
                    <TableCell className="align-top text-right tabular-nums">{formatNumber(row.receivedPallets)}</TableCell>
                    <TableCell className="align-top text-right tabular-nums">{formatNumber(row.receivedQuantity)}</TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-slate-500">
                  {t("noResults")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CurrentInventorySkuSummary({ rows }: { rows: SkuQuantityRow[] }) {
  const { t } = useI18n();

  return (
    <SkuQuantitySummary
      icon={<Boxes className="h-4 w-4" />}
      title={t("customerPortalContainerCurrent")}
      rows={rows}
      showReferenceQuantity
    />
  );
}

function OutboundOrderSummary({ document, containerNo }: { document?: OutboundDocument; containerNo: string }) {
  const { t } = useI18n();
  const rows = useMemo(() => buildOutboundOrderGoodsRows(document, containerNo), [document, containerNo]);

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <PanelSectionTitle icon={<Send className="h-4 w-4" />} title={t("customerPortalPickingOrders")} />
      {document ? (
        <div className="grid gap-2">
          {rows.length > 0 ? rows.map((row) => (
            <div
              key={row.key}
              className={[
                "grid gap-2 rounded-md border px-3 py-2 text-sm transition",
                row.highlighted
                  ? "border-emerald-200 bg-emerald-50 text-slate-950 shadow-sm"
                  : "border-slate-200 bg-white text-slate-400"
              ].join(" ")}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={row.highlighted ? "font-semibold text-slate-950" : "font-medium text-slate-500"}>
                    {row.sku}
                  </div>
                  {row.description ? (
                    <div className={row.highlighted ? "mt-1 truncate text-xs text-slate-600" : "mt-1 truncate text-xs text-slate-400"} title={row.description}>
                      {row.description}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div className={row.highlighted ? "font-semibold text-slate-950" : "text-slate-500"}>{formatNumber(row.quantity)}</div>
                  {row.pallets > 0 ? <div className="mt-1 text-xs text-slate-400">{formatNumber(row.pallets)} {t("pallets")}</div> : null}
                </div>
              </div>
              {row.highlighted ? (
                <div>
                  <Badge variant="success">{containerNo} / {formatNumber(row.allocatedQty || row.quantity)}</Badge>
                </div>
              ) : null}
            </div>
          )) : (
            <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-500">{t("noResults")}</div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-500">{t("noPickingOrders")}</div>
      )}
    </div>
  );
}

function SkuQuantitySummary({
  icon,
  title,
  rows,
  showReferenceQuantity = false
}: {
  icon: ReactNode;
  title: string;
  rows: SkuQuantityRow[];
  showReferenceQuantity?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <PanelSectionTitle icon={icon} title={title} />
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("sku")}</TableHead>
              <TableHead className="w-24 text-right">{t("pallets")}</TableHead>
              <TableHead className="w-24 text-right">{t("quantity")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.sku}>
                  <TableCell className="font-medium text-slate-950">{row.sku}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.pallets)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {showReferenceQuantity
                      ? `${formatNumber(row.quantity)} / ${formatNumber(row.referenceQuantity ?? row.quantity)}`
                      : formatNumber(row.quantity)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-sm text-slate-500">
                  {t("noResults")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
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
  onChange,
  disabled = false
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700">
      {label}
      <select
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
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

function VisibilityFields({
  value,
  onChange,
  hideDisplayLabel = false
}: {
  value: LifecycleVisibilityFormState;
  onChange: (nextFields: LifecycleVisibilityFormState) => void;
  hideDisplayLabel?: boolean;
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
      {!hideDisplayLabel ? (
        <TextInput label={t("displayLabel")} value={value.displayLabel} onChange={(displayLabel) => onChange({ ...value, displayLabel })} />
      ) : null}
    </div>
  );
}

function DocumentActions<TDocument extends InboundDocument | OutboundDocument>({
  icon,
  title,
  document,
  emptyLabel,
  onUpload,
  onGetDownloadUrl,
  onDeleteAttachment
}: {
  icon: ReactNode;
  title: string;
  document?: TDocument;
  emptyLabel: string;
  onUpload?: (document: TDocument, file: File, displayName: string) => Promise<void>;
  onGetDownloadUrl?: (attachment: DocumentAttachment) => Promise<string>;
  onDeleteAttachment?: (document: TDocument, attachment: DocumentAttachment) => Promise<void>;
}) {
  const [pendingAttachments, setPendingAttachments] = useState<PendingDocumentAttachment[]>([]);
  const attachments = document?.attachments ?? [];
  const canManageAttachments = Boolean(document && onUpload && onGetDownloadUrl);

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <PanelSectionTitle icon={icon} title={title} />
      {document ? (
        <>
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
                canDeleteAttachment={(attachment) => attachment.documentId === document.id}
                onDelete={onDeleteAttachment ? async (attachment) => {
                  if (!onDeleteAttachment) {
                    return;
                  }
                  await onDeleteAttachment(document, attachment);
                } : undefined}
              />
            </div>
          ) : null}
        </>
      ) : (
        <div className="text-sm text-slate-500">{emptyLabel}</div>
      )}
    </div>
  );
}

export function buildReceivingSkuRows(packingLists: InboundDocument[]): ReceivingSkuQuantityRow[] {
  const rows = new Map<string, ReceivingSkuQuantityRow>();

  packingLists.forEach((document) => {
    (document.lines ?? []).forEach((line) => {
      const sku = line.sku || "-";
      const itemNumber = line.itemNumber || "";
      const key = inventorySkuRowKey(sku);
      const expectedQuantity = line.expectedQty || 0;
      const receivedQuantity = line.receivedQty || 0;
      const receivedPallets = line.pallets || 0;
      const shortageReason = receivedQuantity < expectedQuantity
        ? firstNonEmptyText(line.lineNote, document.documentNote)
        : "";
      const existing = rows.get(key);
      if (existing) {
        existing.itemNumber ||= itemNumber;
        existing.expectedQuantity += expectedQuantity;
        existing.receivedPallets += receivedPallets;
        existing.receivedQuantity += receivedQuantity;
        existing.shortageReason = appendUniqueText(existing.shortageReason, shortageReason);
        return;
      }
      rows.set(key, {
        sku,
        itemNumber,
        expectedQuantity,
        receivedPallets,
        receivedQuantity,
        shortageReason
      });
    });
  });

  return Array.from(rows.values()).sort((left, right) => left.sku.localeCompare(right.sku));
}

function firstNonEmptyText(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function appendUniqueText(current: string, next: string) {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  const parts = current.split(" / ");
  return parts.includes(next) ? current : `${current} / ${next}`;
}

function getOutboundOrderReference(document: OutboundDocument) {
  return document.packingListNo || document.orderRef || `#${document.id}`;
}

export function buildOutboundOrderGoodsRows(document: OutboundDocument | undefined, containerNo: string): OutboundOrderGoodsRow[] {
  if (!document) {
    return [];
  }
  const normalizedContainerNo = normalizeContainerNo(containerNo);
  const hasAnyPickAllocation = (document.lines ?? []).some((line) => (line.pickAllocations ?? []).length > 0);

  return (document.lines ?? []).map((line, index) => {
    const matchingAllocations = (line.pickAllocations ?? []).filter(
      (allocation) => normalizeContainerNo(allocation.containerNo) === normalizedContainerNo
    );
    const allocatedQty = matchingAllocations.reduce((total, allocation) => total + (allocation.allocatedQty || 0), 0);
    const quantity = line.quantity || 0;
    return {
      key: String(line.id || `${line.sku || line.itemNumber || "line"}-${index}`),
      sku: line.sku || line.itemNumber || "-",
      description: line.description || line.itemNumber || "",
      quantity,
      allocatedQty: hasAnyPickAllocation ? allocatedQty : quantity,
      pallets: line.pallets || 0,
      highlighted: hasAnyPickAllocation ? allocatedQty > 0 : true
    };
  });
}

export function buildCurrentInventorySkuRows(
  lifecycleEvents: ContainerLifecycle["lifecycleEvents"],
  receivedRows: ReceivingSkuQuantityRow[]
): SkuQuantityRow[] {
  const rows = new Map<string, { sku: string; pallets: number; quantity: number; referenceQuantity: number }>();
  const aliases = new Map<string, string>();

  receivedRows.forEach((row) => {
    const key = inventorySkuRowKey(row.sku);
    rows.set(key, {
      sku: row.sku,
      pallets: 0,
      quantity: 0,
      referenceQuantity: row.receivedQuantity
    });
    aliases.set(inventorySkuRowKey(row.sku), key);
    if (row.itemNumber) {
      aliases.set(inventorySkuRowKey(row.itemNumber), key);
    }
  });

  lifecycleEvents.forEach((event) => {
    const sku = event.itemNumber || event.description || "-";
    const labelKey = inventorySkuRowKey(sku);
    const key = aliases.get(labelKey) ?? labelKey;
    const existing = rows.get(key);
    if (existing) {
      existing.quantity += event.quantityDelta || 0;
      existing.pallets += event.palletDelta || 0;
      return;
    }
    rows.set(key, {
      sku,
      pallets: event.palletDelta || 0,
      quantity: event.quantityDelta || 0,
      referenceQuantity: Math.max(event.receivedQty || 0, event.quantityDelta || 0)
    });
  });

  return Array.from(rows.values())
    .map((row) => ({
      sku: row.sku,
      pallets: Math.max(0, row.pallets),
      quantity: Math.max(0, row.quantity),
      referenceQuantity: row.referenceQuantity
    }))
    .sort((left, right) => left.sku.localeCompare(right.sku));
}

function inventorySkuRowKey(label: string) {
  return label.trim().toUpperCase();
}

function createEmptyContainerForm(): ContainerFormState {
  return {
    containerType: "NORMAL",
    handlingMode: "PALLETIZED"
  };
}

function createContainerFormFromLifecycle(lifecycle: ContainerLifecycle): ContainerFormState {
  const container = lifecycle.container;
  const packingList = lifecycle.packingLists.find((document) => document.containerType || document.handlingMode)
    ?? lifecycle.packingLists[0];
  const containerType = container?.containerType || packingList?.containerType;
  const handlingMode = container?.handlingMode || packingList?.handlingMode;
  return {
    containerType: containerType === "WEST_COAST_TRANSFER" ? "WEST_COAST_TRANSFER" : "NORMAL",
    handlingMode: handlingMode === "SEALED_TRANSIT" ? "SEALED_TRANSIT" : "PALLETIZED"
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

function createDeliveryFormFromLifecycle(lifecycle: ContainerLifecycle, node?: ContainerLifecycleNodeAction | null): DeliveryFormState {
  const latestDelivery = node?.deliveryEventId
    ? lifecycle.deliveryEvents.find((event) => event.id === node.deliveryEventId)
    : node?.outboundDocumentId
      ? lifecycle.deliveryEvents.find((event) => event.outboundDocumentId === node.outboundDocumentId)
      : lifecycle.deliveryEvents[0];
  const firstPickingOrder = lifecycle.pickingOrders[0];
  const outboundDocumentId = node?.outboundDocumentId || latestDelivery?.outboundDocumentId || firstPickingOrder?.id || "";
  return {
    deliveryEventId: latestDelivery ? String(latestDelivery.id) : "",
    outboundDocumentId: String(outboundDocumentId),
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

function normalizeContainerNo(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}
