import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { type FormEvent, useEffect, useState } from "react";

import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import { CustomerPortalPackingListsPage } from "./CustomerPortalPackingListsPage";
import { CustomerPortalPickingOrdersPage } from "./CustomerPortalPickingOrdersPage";
import {
  isCompletedPackingList,
  isCompletedPickingOrder,
  isOpenPackingList,
  isOpenPickingOrder,
  PortalPanelHeader,
  type CustomerPortalDetailTabRequest
} from "./CustomerPortalTrackingShared";
import type { CustomerPortalSection } from "./navigation";
import { DocumentAttachmentsPanel, InlineAlert, InlineLoadingIndicator, useFeedbackToast } from "./sharedUi";
import type { PendingDocumentAttachment } from "./sharedUi";
import type { InboundDocument, Item, OutboundDocument, OutboundDocumentPayload, User } from "./types";

type CustomerPortalPageProps = {
  activeSection?: CustomerPortalSection;
  currentUser: User;
  onSectionChange?: (section: CustomerPortalSection) => void;
  portalCustomerId?: number;
  portalCustomerName?: string;
};

type PickingOrderLineDraft = {
  id: string;
  skuMasterId: number;
  itemNumber: string;
  sku: string;
  description: string;
  locationId: number;
  locationName: string;
  unitLabel: string;
  availableQty: number;
  quantity: string;
  lineNote: string;
};

type PickingOrderFormState = {
  packingListNo: string;
  orderRef: string;
  expectedShipDate: string;
  shipToName: string;
  shipToAddress: string;
  shipToContact: string;
  carrierName: string;
  documentNote: string;
};

const emptyPickingOrderForm: PickingOrderFormState = {
  packingListNo: "",
  orderRef: "",
  expectedShipDate: "",
  shipToName: "",
  shipToAddress: "",
  shipToContact: "",
  carrierName: "",
  documentNote: ""
};

export function CustomerPortalPage({ activeSection, currentUser, onSectionChange, portalCustomerId, portalCustomerName = "" }: CustomerPortalPageProps) {
  const { t } = useI18n();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventory, setInventory] = useState<Item[]>([]);
  const [packingLists, setPackingLists] = useState<InboundDocument[]>([]);
  const [pickingOrders, setPickingOrders] = useState<OutboundDocument[]>([]);
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
  const completedPackingListCount = packingLists.filter(isCompletedPackingList).length;
  const openPickingOrderCount = pickingOrders.filter(isOpenPickingOrder).length;
  const completedPickingOrderCount = pickingOrders.filter(isCompletedPickingOrder).length;
  const attachmentCount = [...packingLists, ...pickingOrders].reduce((total, document) => total + (document.attachments?.length ?? 0), 0);
  const draftLineCount = lineDrafts.length;
  const draftTotalQty = lineDrafts.reduce((total, line) => total + Math.max(0, Number(line.quantity) || 0), 0);
  const visibleInventory = inventory.filter((item) => item.availableQty > 0 || item.quantity > 0);
  const showAllSections = !activeSection;
  const showOverviewSection = showAllSections || activeSection === "overview";
  const showInventorySection = showAllSections || activeSection === "inventory";
  const showComposerSection = showAllSections || activeSection === "inventory";
  const showPackingListSection = showAllSections || activeSection === "packing-lists";
  const showPickingOrderSection = showAllSections || activeSection === "picking-orders";

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

  function addInventoryLine(item: Item) {
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
    onSectionChange?.("inventory");
  }

  function updateLineDraft(id: string, updates: Partial<PickingOrderLineDraft>) {
    setLineDrafts((current) => current.map((line) => line.id === id ? { ...line, ...updates } : line));
  }

  function removeLineDraft(id: string) {
    setLineDrafts((current) => current.filter((line) => line.id !== id));
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
        onSectionChange?.("picking-orders");
        setErrorMessage(message);
        showError(message);
      } else {
        requestPickingOrderDetailTab("details");
        onSectionChange?.("picking-orders");
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
                <span>{t("attachments")}</span>
                <strong>{attachmentCount}</strong>
              </div>
            </article>
            <article className="customer-portal-kpi">
              <span className="customer-portal-kpi__icon"><Inventory2OutlinedIcon fontSize="small" /></span>
              <div>
                <span>{t("inventory")}</span>
                <strong>{visibleInventory.length}</strong>
              </div>
            </article>
            <article className="customer-portal-kpi">
              <span className="customer-portal-kpi__icon"><MoveToInboxOutlinedIcon fontSize="small" /></span>
              <div>
                <span>{t("customerPortalOpenPackingLists")}</span>
                <strong>{openPackingListCount}</strong>
              </div>
            </article>
            <article className="customer-portal-kpi">
              <span className="customer-portal-kpi__icon"><AssignmentTurnedInOutlinedIcon fontSize="small" /></span>
              <div>
                <span>{t("customerPortalCompletedPackingLists")}</span>
                <strong>{completedPackingListCount}</strong>
              </div>
            </article>
            <article className="customer-portal-kpi">
              <span className="customer-portal-kpi__icon"><LocalShippingOutlinedIcon fontSize="small" /></span>
              <div>
                <span>{t("customerPortalOpenPickingOrders")}</span>
                <strong>{openPickingOrderCount}</strong>
              </div>
            </article>
            <article className="customer-portal-kpi">
              <span className="customer-portal-kpi__icon"><AssignmentTurnedInOutlinedIcon fontSize="small" /></span>
              <div>
                <span>{t("customerPortalCompletedPickingOrders")}</span>
                <strong>{completedPickingOrderCount}</strong>
              </div>
            </article>
          </section>
        </>
      ) : null}

      {showInventorySection || showComposerSection ? (
        <div className={`customer-portal-operations-grid ${!showInventorySection || !showComposerSection ? "customer-portal-operations-grid--single" : ""}`}>
          {showInventorySection ? (
            <section className="customer-portal-panel customer-portal-panel--inventory">
              <div className="tab-strip">
                <PortalPanelHeader title={t("customerPortalInventory")} icon={<Inventory2OutlinedIcon fontSize="small" />} />
                <div className="filter-bar">
                  <label>{t("search")}<span className="customer-portal-search-field"><SearchOutlinedIcon fontSize="small" /><input value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder={t("customerPortalInventorySearch")} /></span></label>
                  <button className="button button--ghost" type="button" onClick={() => void loadPortalData()} disabled={isLoading}>{t("apply")}</button>
                </div>
              </div>
              <div className="sheet-table-wrap">
                <table className="sheet-table">
                  <thead>
                    <tr>
                      <th>{t("sku")}</th>
                      <th>{t("description")}</th>
                      <th>{t("storageName")}</th>
                      <th>{t("availableQty")}</th>
                      <th>{t("onHand")}</th>
                      <th>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInventory.map((item) => (
                      <tr key={item.id}>
                        <td data-label={t("sku")}>{item.sku || item.itemNumber}</td>
                        <td data-label={t("description")}>{item.description || item.name}</td>
                        <td data-label={t("storageName")}>{item.locationName}</td>
                        <td data-label={t("availableQty")}>{item.availableQty}</td>
                        <td data-label={t("onHand")}>{item.quantity}</td>
                        <td data-label={t("actions")}>
                          <button className="button button--ghost button--small" type="button" onClick={() => addInventoryLine(item)} disabled={item.availableQty <= 0}>
                            <AddCircleOutlineOutlinedIcon fontSize="small" />
                            {t("addToPackingList")}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {visibleInventory.length === 0 ? (
                      <tr><td colSpan={6}><div className="empty-state">{isLoading ? t("loadingRecords") : t("noInventoryAvailable")}</div></td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {showComposerSection ? (
            <section className="customer-portal-panel customer-portal-panel--composer">
              <div className="tab-strip">
                <PortalPanelHeader title={t("newPickingOrder")} icon={<LocalShippingOutlinedIcon fontSize="small" />} />
                <div className="customer-portal-composer-summary">
                  <span>{draftLineCount} {t("totalLines")}</span>
                  <span>{draftTotalQty} {t("totalQty")}</span>
                </div>
              </div>
              {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
              <form className="sheet-form" onSubmit={handleSubmitPickingOrder} noValidate>
                <label>{t("packingListNo")}<input value={form.packingListNo} onChange={(event) => setForm((current) => ({ ...current, packingListNo: event.target.value }))} placeholder={t("autoIfBlank")} /></label>
                <label>{t("orderRef")}<input value={form.orderRef} onChange={(event) => setForm((current) => ({ ...current, orderRef: event.target.value }))} /></label>
                <label>{t("expectedShipDate")}<input type="date" value={form.expectedShipDate} onChange={(event) => setForm((current) => ({ ...current, expectedShipDate: event.target.value }))} /></label>
                <label>{t("shipToName")}<input value={form.shipToName} onChange={(event) => setForm((current) => ({ ...current, shipToName: event.target.value }))} /></label>
                <label>{t("shipToAddress")}<input value={form.shipToAddress} onChange={(event) => setForm((current) => ({ ...current, shipToAddress: event.target.value }))} /></label>
                <label>{t("shipToContact")}<input value={form.shipToContact} onChange={(event) => setForm((current) => ({ ...current, shipToContact: event.target.value }))} /></label>
                <label>{t("carrierName")}<input value={form.carrierName} onChange={(event) => setForm((current) => ({ ...current, carrierName: event.target.value }))} /></label>
                <label className="sheet-form__wide">{t("documentNotes")}<textarea value={form.documentNote} onChange={(event) => setForm((current) => ({ ...current, documentNote: event.target.value }))} rows={3} /></label>

                <div className="sheet-form__wide sheet-table-wrap">
                  <table className="sheet-table">
                    <thead>
                      <tr>
                        <th>{t("sku")}</th>
                        <th>{t("storageName")}</th>
                        <th>{t("availableQty")}</th>
                        <th>{t("quantity")}</th>
                        <th>{t("notes")}</th>
                        <th>{t("actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineDrafts.map((line) => (
                        <tr key={line.id}>
                          <td data-label={t("sku")}>{line.sku || line.itemNumber}<br /><span className="sheet-note">{line.description}</span></td>
                          <td data-label={t("storageName")}>{line.locationName}</td>
                          <td data-label={t("availableQty")}>{line.availableQty}</td>
                          <td data-label={t("quantity")}><input type="number" min="1" max={line.availableQty} value={line.quantity} onChange={(event) => updateLineDraft(line.id, { quantity: event.target.value })} /></td>
                          <td data-label={t("notes")}><input value={line.lineNote} onChange={(event) => updateLineDraft(line.id, { lineNote: event.target.value })} /></td>
                          <td data-label={t("actions")}><button className="button button--ghost button--small" type="button" onClick={() => removeLineDraft(line.id)}>{t("remove")}</button></td>
                        </tr>
                      ))}
                      {lineDrafts.length === 0 ? (
                        <tr><td colSpan={6}><div className="empty-state">{t("customerPortalAddInventoryHint")}</div></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <div className="sheet-form__wide">
                  <DocumentAttachmentsPanel
                    attachments={[]}
                    pendingAttachments={draftPickingOrderAttachments}
                    disabled={isSubmitting}
                    showUploadButton={false}
                    onPendingAttachmentsChange={setDraftPickingOrderAttachments}
                    onGetDownloadUrl={async () => ""}
                  />
                </div>

                <div className="sheet-form__actions sheet-form__wide">
                  <button className="button button--primary" type="submit" disabled={isSubmitting || lineDrafts.length === 0}>
                    {isSubmitting ? <InlineLoadingIndicator /> : null}
                    {t("submitPickingOrder")}
                  </button>
                </div>
              </form>
            </section>
          ) : null}
        </div>
      ) : null}

      {showPackingListSection ? (
        <CustomerPortalPackingListsPage
          packingLists={packingLists}
          isLoading={isLoading}
          adminPortalCustomerId={adminPortalCustomerId}
          onPackingListsChange={setPackingLists}
          onError={showPortalError}
        />
      ) : null}

      {showPickingOrderSection ? (
        <CustomerPortalPickingOrdersPage
          pickingOrders={pickingOrders}
          isLoading={isLoading}
          adminPortalCustomerId={adminPortalCustomerId}
          selectedPickingOrderId={selectedPickingOrderId}
          pendingAttachments={pendingPickingOrderAttachments}
          detailTabRequest={pickingOrderDetailTabRequest}
          onPickingOrdersChange={setPickingOrders}
          onSelectedPickingOrderIdChange={setSelectedPickingOrderId}
          onPendingAttachmentsChange={setPendingPickingOrderAttachments}
          onSuccess={showSuccess}
          onError={showPortalError}
        />
      ) : null}
      {feedbackToast}
    </main>
  );
}
