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
import type { CustomerPortalDetailTabRequest } from "./CustomerPortalTrackingShared";
import type { CustomerPortalSection } from "./navigation";
import { InlineAlert, useFeedbackToast } from "./sharedUi";
import type { PendingDocumentAttachment } from "./sharedUi";
import type { InboundDocument, Item, OutboundDocument, OutboundDocumentPayload, User } from "./types";

type CustomerPortalPageProps = {
  activeSection?: CustomerPortalSection;
  currentUser: User;
  onSectionChange?: (section: CustomerPortalSection) => void;
  portalCustomerId?: number;
  portalCustomerName?: string;
};

export function CustomerPortalPage({ activeSection, currentUser, onSectionChange, portalCustomerId }: CustomerPortalPageProps) {
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
  const currentSection = activeSection ?? "inventory";

  const showInventorySection = currentSection === "inventory";
  const showNewPickingOrderSection = currentSection === "new-outbound-order";
  const showPackingListSection = currentSection === "inbound-shipments";
  const showPackingListDetailSection = currentSection === "inbound-shipment-detail";
  const showPickingOrderSection = currentSection === "outbound-orders";
  const showPickingOrderDetailSection = currentSection === "outbound-order-detail";

  useEffect(() => {
    void loadPortalData();
  }, [adminPortalCustomerId]);

  async function loadPortalData(nextInventorySearch = inventorySearch) {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const [inventoryRows, packingListRows, pickingOrderRows] = await Promise.all([
        customerPortalApi.getInventory(nextInventorySearch, adminPortalCustomerId),
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

  function updateLineDraft(id: string, updates: Partial<PickingOrderLineDraft>) {
    setLineDrafts((current) => current.map((line) => line.id === id ? { ...line, ...updates } : line));
  }

  function removeLineDraft(id: string) {
    setLineDrafts((current) => current.filter((line) => line.id !== id));
  }

  function updatePickingOrderForm(updates: Partial<PickingOrderFormState>) {
    setForm((current) => ({ ...current, ...updates }));
  }

  function openPackingListDetail(documentId: number) {
    setSelectedPackingListId(documentId);
    setErrorMessage("");
    onSectionChange?.("inbound-shipment-detail");
  }

  function openPickingOrderDetail(documentId: number, tab: CustomerPortalDetailTabRequest["tab"] = "details") {
    setSelectedPickingOrderId(documentId);
    setPendingPickingOrderAttachments(tab === "details" ? [] : pendingPickingOrderAttachments);
    requestPickingOrderDetailTab(tab);
    setErrorMessage("");
    onSectionChange?.("outbound-order-detail");
  }

  function cancelPickingOrderDraft() {
    setForm(emptyPickingOrderForm);
    setLineDrafts([]);
    setDraftPickingOrderAttachments([]);
    setErrorMessage("");
    onSectionChange?.("outbound-orders");
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
        onSectionChange?.("outbound-order-detail");
        setErrorMessage(message);
        showError(message);
      } else {
        requestPickingOrderDetailTab("details");
        onSectionChange?.("outbound-order-detail");
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

  function resetInventorySearch() {
    setInventorySearch("");
    void loadPortalData("");
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-4 p-4 lg:p-6">
      {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}

      {showInventorySection ? (
        <CustomerPortalInventoryPage
          inventory={inventory}
          isLoading={isLoading}
          search={inventorySearch}
          onSearchChange={setInventorySearch}
          onApplySearch={() => void loadPortalData(inventorySearch)}
          onResetSearch={resetInventorySearch}
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
          onBack={() => onSectionChange?.("inbound-shipments")}
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
          onBack={() => onSectionChange?.("outbound-orders")}
          onSuccess={showSuccess}
          onError={showPortalError}
        />
      ) : null}
      {feedbackToast}
    </main>
  );
}
