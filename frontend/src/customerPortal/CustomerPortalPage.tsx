import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import { type FormEvent, useEffect, useState } from "react";

import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import { CustomerPortalInventoryPage } from "./CustomerPortalInventoryPage";
import {
  CustomerPortalNewPickingOrderPage,
  emptyPickingOrderForm,
  type PickingOrderFormState,
  type PickingOrderLineDraft
} from "./CustomerPortalNewPickingOrderPage";
import { CustomerPortalPackingListDetailPage } from "./CustomerPortalPackingListDetailPage";
import { CustomerPortalPackingListsPage } from "./CustomerPortalPackingListsPage";
import { CustomerPortalPickingOrderDetailPage } from "./CustomerPortalPickingOrderDetailPage";
import { CustomerPortalPickingOrdersPage } from "./CustomerPortalPickingOrdersPage";
import {
  isOpenPackingList,
  isOpenPickingOrder,
  type CustomerPortalDetailTabRequest
} from "./CustomerPortalTrackingShared";
import type { CustomerPortalSection } from "./navigation";
import { InlineAlert, InlineLoadingIndicator, useFeedbackToast } from "./sharedUi";
import type { PendingDocumentAttachment } from "./sharedUi";
import type { InboundDocument, Item, OutboundDocument, OutboundDocumentPayload, User } from "./types";

type CustomerPortalPageProps = {
  activeSection?: CustomerPortalSection;
  currentUser: User;
  onSectionChange?: (section: CustomerPortalSection) => void;
  portalCustomerId?: number;
  portalCustomerName?: string;
};

export function CustomerPortalPage({ activeSection, currentUser, onSectionChange, portalCustomerId, portalCustomerName = "" }: CustomerPortalPageProps) {
  const { t } = useI18n();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventory, setInventory] = useState<Item[]>([]);
  const [packingLists, setPackingLists] = useState<InboundDocument[]>([]);
  const [pickingOrders, setPickingOrders] = useState<OutboundDocument[]>([]);
  const [selectedPackingListId, setSelectedPackingListId] = useState<number | null>(null);
  const [selectedPickingOrderId, setSelectedPickingOrderId] = useState<number | null>(null);
  const [pickingOrderDetailTabRequest, setPickingOrderDetailTabRequest] = useState<CustomerPortalDetailTabRequest | null>(null);
  const [form, setForm] = useState<PickingOrderFormState>(emptyPickingOrderForm);
  const [lineDrafts, setLineDrafts] = useState<PickingOrderLineDraft[]>([]);
  const [draftPickingOrderAttachments, setDraftPickingOrderAttachments] = useState<PendingDocumentAttachment[]>([]);
  const [pendingPickingOrderAttachments, setPendingPickingOrderAttachments] = useState<PendingDocumentAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const adminPortalCustomerId = currentUser.role === "admin" && portalCustomerId ? portalCustomerId : undefined;
  const activeCustomerId = adminPortalCustomerId ?? currentUser.customerId;
  const activeCustomerName = currentUser.role === "admin" ? portalCustomerName : currentUser.customerName;

  const openPackingListCount = packingLists.filter(isOpenPackingList).length;
  const openPickingOrderCount = pickingOrders.filter(isOpenPickingOrder).length;
  const pickingOrderAttachmentCount = pickingOrders.reduce((total, document) => total + (document.attachments?.length ?? 0), 0);
  const visibleInventory = inventory.filter((item) => item.availableQty > 0 || item.quantity > 0);
  const showAllSections = !activeSection;
  const showOverviewSection = showAllSections || activeSection === "overview";
  const showInventorySection = showAllSections || activeSection === "inventory";
  const showNewPickingOrderSection = activeSection === "new-picking-order";
  const showPackingListSection = showAllSections || activeSection === "packing-lists";
  const showPackingListDetailSection = activeSection === "packing-list-detail";
  const showPickingOrderSection = showAllSections || activeSection === "picking-orders";
  const showPickingOrderDetailSection = activeSection === "picking-order-detail";

  useEffect(() => {
    void loadPortalData();
  }, [adminPortalCustomerId]);

  async function loadPortalData() {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const [inventoryRows, packingListRows, pickingOrderRows] = await Promise.all([
        customerPortalApi.getInventory(inventorySearch, adminPortalCustomerId),
        customerPortalApi.getPackingLists(100, { search: "", status: "all", trackingStatus: "all" }, adminPortalCustomerId),
        customerPortalApi.getPickingOrders(100, { search: "", status: "all", trackingStatus: "all" }, adminPortalCustomerId)
      ]);
      setInventory(inventoryRows);
      setPackingLists(packingListRows);
      setPickingOrders(pickingOrderRows);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("customerPortalLoadFailed");
      setErrorMessage(message);
      showError(message);
    } finally {
      setIsLoading(false);
    }
  }

  function startPickingOrderFromInventory(item: Item) {
    setLineDrafts((current) => {
      const existing = current.find((line) => line.skuMasterId === item.skuMasterId && line.locationId === item.locationId);
      if (existing) {
        return current.map((line) => line.id === existing.id ? {
          ...line,
          quantity: String(Math.min(Number(line.quantity || "0") + 1, Math.max(1, item.availableQty)))
        } : line);
      }
      return [
        ...current,
        {
          id: `${item.id}-${Date.now()}`,
          skuMasterId: item.skuMasterId,
          itemNumber: item.itemNumber,
          sku: item.sku,
          description: item.description || item.name,
          locationId: item.locationId,
          locationName: item.locationName,
          unitLabel: item.unit || "CTN",
          availableQty: item.availableQty,
          quantity: item.availableQty > 0 ? "1" : "0",
          lineNote: ""
        }
      ];
    });
    onSectionChange?.("new-picking-order");
  }

  function updateLineDraft(id: string, updates: Partial<PickingOrderLineDraft>) {
    setLineDrafts((current) => current.map((line) => line.id === id ? { ...line, ...updates } : line));
  }

  function removeLineDraft(id: string) {
    setLineDrafts((current) => current.filter((line) => line.id !== id));
  }

  function updatePickingOrderForm(updates: Partial<PickingOrderFormState>) {
    setForm((current) => ({ ...current, ...updates }));
  }

  function openNewPickingOrder() {
    setErrorMessage("");
    onSectionChange?.("new-picking-order");
  }

  function openPackingListDetail(documentId: number) {
    setSelectedPackingListId(documentId);
    setErrorMessage("");
    onSectionChange?.("packing-list-detail");
  }

  function openPickingOrderDetail(documentId: number, tab: CustomerPortalDetailTabRequest["tab"] = "details") {
    setSelectedPickingOrderId(documentId);
    setPendingPickingOrderAttachments(tab === "details" ? [] : pendingPickingOrderAttachments);
    requestPickingOrderDetailTab(tab);
    setErrorMessage("");
    onSectionChange?.("picking-order-detail");
  }

  function cancelPickingOrderDraft() {
    setForm(emptyPickingOrderForm);
    setLineDrafts([]);
    setDraftPickingOrderAttachments([]);
    setErrorMessage("");
    onSectionChange?.("picking-orders");
  }

  async function handleSubmitPickingOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const lines = lineDrafts.map((line) => ({
        ...line,
        parsedQuantity: Number(line.quantity)
      }));
      const invalidLine = lines.find((line) => !Number.isFinite(line.parsedQuantity) || line.parsedQuantity <= 0);
      if (invalidLine) {
        throw new Error(t("customerPortalQuantityRequired"));
      }
      const overQuantityLine = lines.find((line) => line.parsedQuantity > line.availableQty);
      if (overQuantityLine) {
        throw new Error(t("customerPortalQuantityExceedsAvailable"));
      }
      if (lines.length === 0) {
        throw new Error(t("customerPortalLineRequired"));
      }

      const payload: OutboundDocumentPayload = {
        packingListNo: form.packingListNo,
        orderRef: form.orderRef,
        expectedShipDate: form.expectedShipDate,
        shipToName: form.shipToName,
        shipToAddress: form.shipToAddress,
        shipToContact: form.shipToContact,
        carrierName: form.carrierName,
        documentNote: form.documentNote,
        lines: lines.map((line) => ({
          customerId: activeCustomerId,
          locationId: line.locationId,
          skuMasterId: line.skuMasterId,
          quantity: line.parsedQuantity,
          pallets: 0,
          unitLabel: line.unitLabel,
          lineNote: line.lineNote
        }))
      };

      const createdDocument = await customerPortalApi.createPickingOrder(payload, adminPortalCustomerId);
      const failedAttachments = await uploadDraftPickingOrderAttachments(createdDocument.id, draftPickingOrderAttachments);
      setForm(emptyPickingOrderForm);
      setLineDrafts([]);
      setDraftPickingOrderAttachments([]);
      setPendingPickingOrderAttachments(failedAttachments);
      setSelectedPickingOrderId(createdDocument.id);
      const documentRows = await customerPortalApi.getPickingOrders(100, {
        search: "",
        status: "all",
        trackingStatus: "all"
      }, adminPortalCustomerId);
      setPickingOrders(documentRows);

      if (failedAttachments.length > 0) {
        const message = t("customerPortalAttachmentUploadPartial");
        requestPickingOrderDetailTab("documents");
        onSectionChange?.("picking-order-detail");
        setErrorMessage(message);
        showError(message);
      } else {
        requestPickingOrderDetailTab("details");
        onSectionChange?.("picking-order-detail");
        showSuccess(t("customerPortalPickingOrderCreated"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t("customerPortalCreateFailed");
      setErrorMessage(message);
      showError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function uploadDraftPickingOrderAttachments(documentId: number, attachments: PendingDocumentAttachment[]) {
    const failedAttachments: PendingDocumentAttachment[] = [];
    for (const attachment of attachments) {
      try {
        await customerPortalApi.uploadPickingOrderAttachment(
          documentId,
          attachment.file,
          attachment.displayName.trim() || attachment.file.name,
          adminPortalCustomerId
        );
      } catch {
        failedAttachments.push(attachment);
      }
    }
    return failedAttachments;
  }

  function requestPickingOrderDetailTab(tab: CustomerPortalDetailTabRequest["tab"]) {
    setPickingOrderDetailTabRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      tab
    }));
  }

  function showPortalError(message: string) {
    setErrorMessage(message);
    showError(message);
  }

  return (
    <main className="customer-portal-main">
      {showOverviewSection ? (
        <>
          <section className="customer-portal-overview">
            <div className="customer-portal-overview__copy">
              <span className="customer-portal-overview__eyebrow">{t("customerPortal")}</span>
              <h1>{activeCustomerName || t("customerPortal")}</h1>
              <p>{t("customerPortalDesc")}</p>
              {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
            </div>
            <div className="customer-portal-overview__actions">
              <button className="button button--primary" type="button" onClick={() => void loadPortalData()} disabled={isLoading}>
                {isLoading ? <InlineLoadingIndicator /> : <RefreshRoundedIcon fontSize="small" />}
                {t("refresh")}
              </button>
            </div>
          </section>

          <section className="customer-portal-metrics" aria-label={t("customerPortal")}>
            <article className="customer-portal-kpi">
              <span className="customer-portal-kpi__icon"><AttachFileOutlinedIcon fontSize="small" /></span>
              <div>
                <span>{t("customerPortalOverviewFilesTitle")}</span>
                <strong>{pickingOrderAttachmentCount}</strong>
                <small>{t("customerPortalFilesTracked")}</small>
                <button className="button button--ghost button--small customer-portal-kpi__action" type="button" onClick={() => onSectionChange?.("picking-orders")}>
                  {t("customerPortalOpenFilesAction")}
                </button>
              </div>
            </article>
            <article className="customer-portal-kpi">
              <span className="customer-portal-kpi__icon"><Inventory2OutlinedIcon fontSize="small" /></span>
              <div>
                <span>{t("customerPortalOverviewInventoryTitle")}</span>
                <strong>{visibleInventory.length}</strong>
                <small>{t("customerPortalAvailableLocations")}</small>
                <button className="button button--ghost button--small customer-portal-kpi__action" type="button" onClick={() => onSectionChange?.("inventory")}>
                  {t("customerPortalOpenInventoryAction")}
                </button>
              </div>
            </article>
            <article className="customer-portal-kpi">
              <span className="customer-portal-kpi__icon"><MoveToInboxOutlinedIcon fontSize="small" /></span>
              <div>
                <span>{t("customerPortalOverviewPackingTitle")}</span>
                <strong>{openPackingListCount}</strong>
                <small>{t("customerPortalInboundInProgress")}</small>
                <button className="button button--ghost button--small customer-portal-kpi__action" type="button" onClick={() => onSectionChange?.("packing-lists")}>
                  {t("customerPortalOpenInboundAction")}
                </button>
              </div>
            </article>
            <article className="customer-portal-kpi">
              <span className="customer-portal-kpi__icon"><LocalShippingOutlinedIcon fontSize="small" /></span>
              <div>
                <span>{t("customerPortalOverviewPickingTitle")}</span>
                <strong>{openPickingOrderCount}</strong>
                <small>{t("customerPortalOutboundInProgress")}</small>
                <button className="button button--ghost button--small customer-portal-kpi__action" type="button" onClick={() => onSectionChange?.("picking-orders")}>
                  {t("customerPortalOpenOutboundAction")}
                </button>
              </div>
            </article>
          </section>
        </>
      ) : null}

      {showInventorySection ? (
        <CustomerPortalInventoryPage
          inventory={inventory}
          isLoading={isLoading}
          search={inventorySearch}
          onSearchChange={setInventorySearch}
          onApplySearch={() => void loadPortalData()}
          onStartPickingOrder={startPickingOrderFromInventory}
        />
      ) : null}

      {showNewPickingOrderSection ? (
        <CustomerPortalNewPickingOrderPage
          form={form}
          lineDrafts={lineDrafts}
          pendingAttachments={draftPickingOrderAttachments}
          isSubmitting={isSubmitting}
          errorMessage={errorMessage}
          onFormChange={updatePickingOrderForm}
          onLineChange={updateLineDraft}
          onRemoveLine={removeLineDraft}
          onPendingAttachmentsChange={setDraftPickingOrderAttachments}
          onSubmit={handleSubmitPickingOrder}
          onCancel={cancelPickingOrderDraft}
          onBackToInventory={() => onSectionChange?.("inventory")}
        />
      ) : null}

      {showPackingListSection ? (
        <CustomerPortalPackingListsPage
          packingLists={packingLists}
          isLoading={isLoading}
          adminPortalCustomerId={adminPortalCustomerId}
          selectedPackingListId={selectedPackingListId}
          onPackingListsChange={setPackingLists}
          onOpenDetail={openPackingListDetail}
          onError={showPortalError}
        />
      ) : null}

      {showPackingListDetailSection ? (
        <CustomerPortalPackingListDetailPage
          packingLists={packingLists}
          selectedPackingListId={selectedPackingListId}
          adminPortalCustomerId={adminPortalCustomerId}
          onBack={() => onSectionChange?.("packing-lists")}
        />
      ) : null}

      {showPickingOrderSection ? (
        <CustomerPortalPickingOrdersPage
          pickingOrders={pickingOrders}
          isLoading={isLoading}
          adminPortalCustomerId={adminPortalCustomerId}
          selectedPickingOrderId={selectedPickingOrderId}
          onPickingOrdersChange={setPickingOrders}
          onOpenDetail={openPickingOrderDetail}
          onCreateNewOrder={openNewPickingOrder}
          onError={showPortalError}
        />
      ) : null}

      {showPickingOrderDetailSection ? (
        <CustomerPortalPickingOrderDetailPage
          pickingOrders={pickingOrders}
          selectedPickingOrderId={selectedPickingOrderId}
          pendingAttachments={pendingPickingOrderAttachments}
          detailTabRequest={pickingOrderDetailTabRequest}
          adminPortalCustomerId={adminPortalCustomerId}
          onPickingOrdersChange={setPickingOrders}
          onPendingAttachmentsChange={setPendingPickingOrderAttachments}
          onBack={() => onSectionChange?.("picking-orders")}
          onSuccess={showSuccess}
          onError={showPortalError}
        />
      ) : null}
      {feedbackToast}
    </main>
  );
}
