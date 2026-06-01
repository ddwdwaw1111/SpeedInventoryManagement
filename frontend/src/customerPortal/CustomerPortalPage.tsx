import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import type { CustomerPortalSection } from "./navigation";
import { DocumentAttachmentsPanel, InlineAlert, InlineLoadingIndicator, useFeedbackToast } from "./sharedUi";
import type { PendingDocumentAttachment } from "./sharedUi";
import type { DocumentAttachment, Item, OutboundDocument, OutboundDocumentPayload, User } from "./types";

type CustomerPortalPageProps = {
  activeSection?: CustomerPortalSection;
  currentUser: User;
  onSectionChange?: (section: CustomerPortalSection) => void;
  portalCustomerId?: number;
  portalCustomerName?: string;
};

type PackingListLineDraft = {
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

type PackingListFormState = {
  packingListNo: string;
  orderRef: string;
  expectedShipDate: string;
  shipToName: string;
  shipToAddress: string;
  shipToContact: string;
  carrierName: string;
  documentNote: string;
};

type CustomerPortalDetailTab = "details" | "documents";

const emptyPackingListForm: PackingListFormState = {
  packingListNo: "",
  orderRef: "",
  expectedShipDate: "",
  shipToName: "",
  shipToAddress: "",
  shipToContact: "",
  carrierName: "",
  documentNote: ""
};

const packingListStatusOptions = ["all", "DRAFT", "CONFIRMED", "DELETED"];
const packingListTrackingStatusOptions = ["all", "SCHEDULED", "PICKING", "PACKED", "SHIPPED", "BO_RECEIVED"];

export function CustomerPortalPage({ activeSection, currentUser, onSectionChange, portalCustomerId, portalCustomerName = "" }: CustomerPortalPageProps) {
  const { t } = useI18n();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const [inventorySearch, setInventorySearch] = useState("");
  const [packingListSearch, setPackingListSearch] = useState("");
  const [packingListStatus, setPackingListStatus] = useState("all");
  const [packingListTrackingStatus, setPackingListTrackingStatus] = useState("all");
  const [inventory, setInventory] = useState<Item[]>([]);
  const [packingLists, setPackingLists] = useState<OutboundDocument[]>([]);
  const [selectedPackingListId, setSelectedPackingListId] = useState<number | null>(null);
  const [form, setForm] = useState<PackingListFormState>(emptyPackingListForm);
  const [lineDrafts, setLineDrafts] = useState<PackingListLineDraft[]>([]);
  const [draftAttachments, setDraftAttachments] = useState<PendingDocumentAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingDocumentAttachment[]>([]);
  const [activeDetailTab, setActiveDetailTab] = useState<CustomerPortalDetailTab>("details");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const adminPortalCustomerId = currentUser.role === "admin" && portalCustomerId ? portalCustomerId : undefined;
  const activeCustomerId = adminPortalCustomerId ?? currentUser.customerId;
  const activeCustomerName = currentUser.role === "admin" ? portalCustomerName : currentUser.customerName;

  const selectedPackingList = useMemo(
    () => packingLists.find((document) => document.id === selectedPackingListId) ?? packingLists[0] ?? null,
    [packingLists, selectedPackingListId]
  );
  const selectedPackingListWorkflow = selectedPackingList
    ? getOutboundWorkflowState(selectedPackingList.trackingStatus, selectedPackingList.status, t)
    : null;
  const selectedPackingListAttachmentCount = selectedPackingList?.attachments?.length ?? 0;
  const openPackingListCount = packingLists.filter(isOpenPackingList).length;
  const completedPackingListCount = packingLists.filter(isCompletedPackingList).length;
  const attachmentCount = packingLists.reduce((total, document) => total + (document.attachments?.length ?? 0), 0);
  const draftLineCount = lineDrafts.length;
  const draftTotalQty = lineDrafts.reduce((total, line) => total + Math.max(0, Number(line.quantity) || 0), 0);

  useEffect(() => {
    void loadPortalData();
  }, [adminPortalCustomerId]);

  useEffect(() => {
    if (!selectedPackingListId && packingLists[0]) {
      setSelectedPackingListId(packingLists[0].id);
    }
  }, [packingLists, selectedPackingListId]);

  useEffect(() => {
    if (activeSection === "attachments") {
      setActiveDetailTab("documents");
    }
    if (activeSection === "packing-lists") {
      setActiveDetailTab("details");
    }
  }, [activeSection]);

  async function loadPortalData() {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const [inventoryRows, documentRows] = await Promise.all([
        customerPortalApi.getInventory(inventorySearch, adminPortalCustomerId),
        customerPortalApi.getPackingLists(100, { search: packingListSearch, status: packingListStatus, trackingStatus: packingListTrackingStatus }, adminPortalCustomerId)
      ]);
      setInventory(inventoryRows);
      setPackingLists(documentRows);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("customerPortalLoadFailed");
      setErrorMessage(message);
      showError(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshPackingLists() {
    const documentRows = await customerPortalApi.getPackingLists(100, {
      search: packingListSearch,
      status: packingListStatus,
      trackingStatus: packingListTrackingStatus
    }, adminPortalCustomerId);
    setPackingLists(documentRows);
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
    onSectionChange?.("new-packing-list");
  }

  function updateLineDraft(id: string, updates: Partial<PackingListLineDraft>) {
    setLineDrafts((current) => current.map((line) => line.id === id ? { ...line, ...updates } : line));
  }

  function removeLineDraft(id: string) {
    setLineDrafts((current) => current.filter((line) => line.id !== id));
  }

  async function handleSubmitPackingList(event: FormEvent<HTMLFormElement>) {
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

      const createdDocument = await customerPortalApi.createPackingList(payload, adminPortalCustomerId);
      const failedAttachments = await uploadDraftPackingListAttachments(createdDocument.id, draftAttachments);
      setForm(emptyPackingListForm);
      setLineDrafts([]);
      setDraftAttachments([]);
      setPendingAttachments(failedAttachments);
      setPackingListSearch("");
      setPackingListStatus("all");
      setPackingListTrackingStatus("all");
      setSelectedPackingListId(createdDocument.id);
      onSectionChange?.("packing-lists");
      const documentRows = await customerPortalApi.getPackingLists(100, {
        search: "",
        status: "all",
        trackingStatus: "all"
      }, adminPortalCustomerId);
      setPackingLists(documentRows);
      if (failedAttachments.length > 0) {
        const message = t("customerPortalAttachmentUploadPartial");
        setErrorMessage(message);
        showError(message);
      } else {
        showSuccess(t("customerPortalPackingListCreated"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t("customerPortalCreateFailed");
      setErrorMessage(message);
      showError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function uploadDraftPackingListAttachments(documentId: number, attachments: PendingDocumentAttachment[]) {
    const failedAttachments: PendingDocumentAttachment[] = [];
    for (const attachment of attachments) {
      try {
        await customerPortalApi.uploadPackingListAttachment(
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

  async function handleUploadAttachment(file: File, displayName: string) {
    if (!selectedPackingList) {
      throw new Error(t("customerPortalSelectPackingList"));
    }
    await customerPortalApi.uploadPackingListAttachment(selectedPackingList.id, file, displayName, adminPortalCustomerId);
    await refreshPackingLists();
  }

  async function getAttachmentDownloadUrl(attachment: DocumentAttachment) {
    const result = await customerPortalApi.getPackingListAttachmentDownloadUrl(attachment.documentId, attachment.id, adminPortalCustomerId);
    return result.url;
  }

  async function handleDeleteAttachment(attachment: DocumentAttachment) {
    await customerPortalApi.deletePackingListAttachment(attachment.documentId, attachment.id, adminPortalCustomerId);
    await refreshPackingLists();
    showSuccess(t("attachmentDeletedSuccess"));
  }

  const visibleInventory = inventory.filter((item) => item.availableQty > 0 || item.quantity > 0);
  const showAllSections = !activeSection;
  const showOverviewSection = showAllSections || activeSection === "overview";
  const showInventorySection = showAllSections || activeSection === "inventory";
  const showComposerSection = showAllSections || activeSection === "new-packing-list";
  const showPackingListSection = showAllSections || activeSection === "packing-lists" || activeSection === "attachments";

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
              <span className="customer-portal-kpi__icon"><LocalShippingOutlinedIcon fontSize="small" /></span>
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
                  <td>{item.sku || item.itemNumber}</td>
                  <td>{item.description || item.name}</td>
                  <td>{item.locationName}</td>
                  <td>{item.availableQty}</td>
                  <td>{item.quantity}</td>
                  <td>
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
          <PortalPanelHeader title={t("newPackingList")} icon={<LocalShippingOutlinedIcon fontSize="small" />} />
          <div className="customer-portal-composer-summary">
            <span>{draftLineCount} {t("totalLines")}</span>
            <span>{draftTotalQty} {t("totalQty")}</span>
          </div>
        </div>
        {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
        <form className="sheet-form" onSubmit={handleSubmitPackingList} noValidate>
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
                    <td>{line.sku || line.itemNumber}<br /><span className="sheet-note">{line.description}</span></td>
                    <td>{line.locationName}</td>
                    <td>{line.availableQty}</td>
                    <td><input type="number" min="1" max={line.availableQty} value={line.quantity} onChange={(event) => updateLineDraft(line.id, { quantity: event.target.value })} /></td>
                    <td><input value={line.lineNote} onChange={(event) => updateLineDraft(line.id, { lineNote: event.target.value })} /></td>
                    <td><button className="button button--ghost button--small" type="button" onClick={() => removeLineDraft(line.id)}>{t("remove")}</button></td>
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
              pendingAttachments={draftAttachments}
              disabled={isSubmitting}
              showUploadButton={false}
              onPendingAttachmentsChange={setDraftAttachments}
              onGetDownloadUrl={async () => ""}
            />
          </div>

          <div className="sheet-form__actions sheet-form__wide">
            <button className="button button--primary" type="submit" disabled={isSubmitting || lineDrafts.length === 0}>
              {isSubmitting ? <InlineLoadingIndicator /> : null}
              {t("submitPackingList")}
            </button>
          </div>
        </form>
      </section>
      ) : null}
      </div>
      ) : null}

      {showPackingListSection ? (
      <div className="customer-portal-record-grid">
      <section className="customer-portal-panel customer-portal-panel--list">
        <div className="tab-strip">
          <PortalPanelHeader title={t("customerPortalPackingLists")} icon={<AssignmentTurnedInOutlinedIcon fontSize="small" />} />
          <div className="filter-bar">
            <label>{t("search")}<span className="customer-portal-search-field"><SearchOutlinedIcon fontSize="small" /><input value={packingListSearch} onChange={(event) => setPackingListSearch(event.target.value)} placeholder={t("customerPortalPackingListSearch")} /></span></label>
            <label>{t("status")}<select value={packingListStatus} onChange={(event) => setPackingListStatus(event.target.value)}>{packingListStatusOptions.map((status) => <option key={status} value={status}>{status === "all" ? t("all") : t(status.toLowerCase())}</option>)}</select></label>
            <label>{t("trackingStatus")}<select value={packingListTrackingStatus} onChange={(event) => setPackingListTrackingStatus(event.target.value)}>{packingListTrackingStatusOptions.map((status) => <option key={status} value={status}>{formatOutboundTrackingStatusFilterLabel(status, t)}</option>)}</select></label>
            <button className="button button--ghost" type="button" onClick={() => void loadPortalData()} disabled={isLoading}>{t("apply")}</button>
          </div>
        </div>
        <div className="sheet-table-wrap">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>{t("packingListNo")}</th>
                <th>{t("orderRef")}</th>
                <th>{t("trackingStatus")}</th>
                <th>{t("customerPortalCompletionStatus")}</th>
                <th>{t("status")}</th>
                <th>{t("totalQty")}</th>
                <th>{t("expectedShipDate")}</th>
                <th>{t("attachments")}</th>
              </tr>
            </thead>
            <tbody>
              {packingLists.map((document) => (
                <tr
                  key={document.id}
                  className={selectedPackingList?.id === document.id ? "sheet-table__row--selected" : undefined}
                  onClick={() => {
                    setSelectedPackingListId(document.id);
                    setPendingAttachments([]);
                    setActiveDetailTab(activeSection === "attachments" ? "documents" : "details");
                  }}
                >
                  <td>{document.packingListNo || `#${document.id}`}</td>
                  <td>{document.orderRef || "-"}</td>
                  <td><span className={`status-pill ${getTrackingStatusPillClass(document)}`}>{formatOutboundTrackingStatus(document.trackingStatus, document.status, t)}</span></td>
                  <td><span className={`status-pill ${isCompletedPackingList(document) ? "status-pill--ok" : "status-pill--alert"}`}>{formatPackingListCompletionStatus(document, t)}</span></td>
                  <td><span className={`status-pill ${getDocumentStatusPillClass(document.status)}`}>{t(document.status.toLowerCase())}</span></td>
                  <td>{document.totalQty}</td>
                  <td>{document.expectedShipDate || "-"}</td>
                  <td><span className="customer-portal-attachment-count"><AttachFileOutlinedIcon fontSize="small" />{document.attachments?.length ?? 0}</span></td>
                </tr>
              ))}
              {packingLists.length === 0 ? (
                <tr><td colSpan={8}><div className="empty-state">{isLoading ? t("loadingRecords") : t("noPackingLists")}</div></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="customer-portal-panel customer-portal-panel--detail">
        <PortalPanelHeader
          title={selectedPackingList ? `${t("customerPortalPackingListDetail")} ${selectedPackingList.packingListNo || `#${selectedPackingList.id}`}` : t("customerPortalPackingListDetail")}
          description={t("customerPortalPackingListDetailDesc")}
          icon={<AttachFileOutlinedIcon fontSize="small" />}
        />
        {selectedPackingList && selectedPackingListWorkflow ? (
          <div className="customer-portal-detail">
            <div className="reports-tab-nav customer-portal-detail-tabs" role="tablist" aria-label={t("customerPortalPackingListDetail")}>
              {([
                ["details", t("details")],
                ["documents", t("attachments")]
              ] as const).map(([tabKey, label]) => (
                <button
                  key={tabKey}
                  type="button"
                  role="tab"
                  aria-selected={activeDetailTab === tabKey}
                  className={`reports-tab-nav__item ${activeDetailTab === tabKey ? "reports-tab-nav__item--active" : ""}`}
                  onClick={() => setActiveDetailTab(tabKey)}
                >
                  <span>{label}</span>
                  {tabKey === "documents" && selectedPackingListAttachmentCount > 0 ? (
                    <small className="customer-portal-detail-tabs__count">{selectedPackingListAttachmentCount}</small>
                  ) : null}
                </button>
              ))}
            </div>

            {activeDetailTab === "details" ? (
              <>
                <div className="metric-ribbon">
                  <article className="metric-card">
                    <span>{t("trackingStatus")}</span>
                    <strong><span className={`status-pill ${getTrackingStatusPillClass(selectedPackingList)}`}>{formatOutboundTrackingStatus(selectedPackingList.trackingStatus, selectedPackingList.status, t)}</span></strong>
                  </article>
                  <article className="metric-card">
                    <span>{t("customerPortalCompletionStatus")}</span>
                    <strong><span className={`status-pill ${isCompletedPackingList(selectedPackingList) ? "status-pill--ok" : "status-pill--alert"}`}>{formatPackingListCompletionStatus(selectedPackingList, t)}</span></strong>
                  </article>
                  <article className="metric-card">
                    <span>{t("totalQty")}</span>
                    <strong>{selectedPackingList.totalQty}</strong>
                  </article>
                  <article className="metric-card">
                    <span>{t("totalLines")}</span>
                    <strong>{selectedPackingList.totalLines}</strong>
                  </article>
                </div>

                <div className="customer-portal-workflow" aria-label={t("customerPortalWorkflowProgress")}>
                  <div className="customer-portal-workflow__summary">
                    <strong>{t("customerPortalWorkflowProgress")}</strong>
                    <span>{selectedPackingListWorkflow.progress}%</span>
                  </div>
                  <div className="customer-portal-workflow__track">
                    {selectedPackingListWorkflow.steps.map((step, index) => (
                      <div
                        className={[
                          "customer-portal-workflow__step",
                          index < selectedPackingListWorkflow.activeIndex ? "customer-portal-workflow__step--complete" : "",
                          index === selectedPackingListWorkflow.activeIndex ? "customer-portal-workflow__step--active" : ""
                        ].filter(Boolean).join(" ")}
                        key={step}
                      >
                        <span>{index + 1}</span>
                        <strong>{step}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="customer-portal-detail-grid">
                  <div className="sheet-note sheet-note--readonly"><strong>{t("orderRef")}</strong><br />{selectedPackingList.orderRef || "-"}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("expectedShipDate")}</strong><br />{formatNullableDate(selectedPackingList.expectedShipDate)}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("actualShipDate")}</strong><br />{formatNullableDate(selectedPackingList.actualShipDate)}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("carrierName")}</strong><br />{selectedPackingList.carrierName || "-"}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("shipToName")}</strong><br />{selectedPackingList.shipToName || "-"}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("shipToContact")}</strong><br />{selectedPackingList.shipToContact || "-"}</div>
                  <div className="sheet-note sheet-note--readonly customer-portal-detail-grid__wide"><strong>{t("shipToAddress")}</strong><br />{selectedPackingList.shipToAddress || "-"}</div>
                  <div className="sheet-note sheet-note--readonly customer-portal-detail-grid__wide"><strong>{t("documentNotes")}</strong><br />{selectedPackingList.documentNote || "-"}</div>
                </div>

                <div className="sheet-table-wrap">
                  <table className="sheet-table" aria-label={t("lineItemsView")}>
                    <thead>
                      <tr>
                        <th>{t("itemNumber")}</th>
                        <th>{t("sku")}</th>
                        <th>{t("description")}</th>
                        <th>{t("storageName")}</th>
                        <th>{t("quantity")}</th>
                        <th>{t("pallets")}</th>
                        <th>{t("notes")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPackingList.lines.map((line) => (
                        <tr key={line.id}>
                          <td>{line.itemNumber || "-"}</td>
                          <td>{line.sku || "-"}</td>
                          <td>{line.description || "-"}</td>
                          <td>{[line.locationName, line.storageSection].filter(Boolean).join(" / ") || "-"}</td>
                          <td>{line.quantity} {line.unitLabel || ""}</td>
                          <td>{line.pallets || "-"}</td>
                          <td>{line.lineNote || "-"}</td>
                        </tr>
                      ))}
                      {selectedPackingList.lines.length === 0 ? (
                        <tr><td colSpan={7}><div className="empty-state">{t("customerPortalNoLineItems")}</div></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <DocumentAttachmentsPanel
                attachments={selectedPackingList.attachments ?? []}
                pendingAttachments={pendingAttachments}
                onPendingAttachmentsChange={setPendingAttachments}
                onUpload={handleUploadAttachment}
                onGetDownloadUrl={getAttachmentDownloadUrl}
                onDelete={handleDeleteAttachment}
              />
            )}
          </div>
        ) : (
          <div className="empty-state">{t("customerPortalSelectPackingList")}</div>
        )}
      </section>
      </div>
      ) : null}
      {feedbackToast}
    </main>
  );
}

function PortalPanelHeader({
  title,
  description,
  icon,
  actions,
  errorMessage
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  errorMessage?: string;
}) {
  return (
    <div className="customer-portal-panel-header">
      <div>
        <h2>{icon ? <span className="customer-portal-panel-header__icon">{icon}</span> : null}{title}</h2>
        {description ? <p>{description}</p> : null}
        {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
      </div>
      {actions ? <div className="customer-portal-panel-header__actions">{actions}</div> : null}
    </div>
  );
}

function getOutboundWorkflowState(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  const steps = [t("scheduledTracking"), t("pickingTracking"), t("packedTracking"), t("shippedTracking"), t("boReceivedTracking")];
  const normalizedStatus = documentStatus.trim().toUpperCase();
  if (normalizedStatus === "DELETED" || normalizedStatus === "CANCELLED") {
    return { steps, activeIndex: -1, progress: 0 };
  }
  const normalizedTrackingStatus = trackingStatus.trim().toUpperCase();
  const activeIndex = normalizedTrackingStatus === "PICKING"
    ? 1
    : normalizedTrackingStatus === "PACKED"
      ? 2
      : normalizedTrackingStatus === "SHIPPED"
        ? 3
        : normalizedTrackingStatus === "BO_RECEIVED"
          ? 4
          : 0;
  return {
    steps,
    activeIndex,
    progress: Math.round(((activeIndex + 1) / steps.length) * 100)
  };
}

function formatNullableDate(value: string | null) {
  if (!value) {
    return "-";
  }
  const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return dateMatch?.[1] ?? value;
}

function formatOutboundTrackingStatusFilterLabel(status: string, t: (key: string) => string) {
  if (status === "all") {
    return t("all");
  }
  return formatOutboundTrackingStatus(status, "DRAFT", t);
}

function formatOutboundTrackingStatus(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  const normalizedStatus = documentStatus.trim().toUpperCase();
  if (normalizedStatus === "DELETED" || normalizedStatus === "CANCELLED") {
    return t("cancelled");
  }
  switch (trackingStatus.trim().toUpperCase()) {
    case "BO_RECEIVED":
      return t("boReceivedTracking");
    case "SHIPPED":
      return t("shippedTracking");
    case "PACKED":
      return t("packedTracking");
    case "PICKING":
      return t("pickingTracking");
    default:
      return t("scheduledTracking");
  }
}

function getTrackingStatusPillClass(document: Pick<OutboundDocument, "status" | "trackingStatus">) {
  if (normalizeDocumentStatusForPortal(document.status) === "DELETED") {
    return "status-pill--danger";
  }
  const normalizedTrackingStatus = document.trackingStatus.trim().toUpperCase();
  if (normalizedTrackingStatus === "BO_RECEIVED" || normalizedTrackingStatus === "SHIPPED") {
    return "status-pill--ok";
  }
  if (normalizedTrackingStatus === "PICKING" || normalizedTrackingStatus === "PACKED") {
    return "status-pill--alert";
  }
  return "";
}

function getDocumentStatusPillClass(status: string) {
  const normalizedStatus = normalizeDocumentStatusForPortal(status);
  if (normalizedStatus === "DELETED") {
    return "status-pill--danger";
  }
  if (normalizedStatus === "CONFIRMED") {
    return "status-pill--ok";
  }
  return "status-pill--alert";
}

function isCompletedPackingList(document: Pick<OutboundDocument, "status" | "trackingStatus">) {
  return normalizeDocumentStatusForPortal(document.status) !== "DELETED"
    && document.trackingStatus.trim().toUpperCase() === "BO_RECEIVED";
}

function isOpenPackingList(document: Pick<OutboundDocument, "status" | "trackingStatus">) {
  return normalizeDocumentStatusForPortal(document.status) !== "DELETED"
    && !isCompletedPackingList(document);
}

function formatPackingListCompletionStatus(document: Pick<OutboundDocument, "status" | "trackingStatus">, t: (key: string) => string) {
  if (normalizeDocumentStatusForPortal(document.status) === "DELETED") {
    return t("cancelled");
  }
  return isCompletedPackingList(document) ? t("completed") : t("customerPortalAwaitingBO");
}

function normalizeDocumentStatusForPortal(status: string) {
  const normalized = status.trim().toUpperCase();
  return normalized === "CANCELLED" ? "DELETED" : normalized;
}
