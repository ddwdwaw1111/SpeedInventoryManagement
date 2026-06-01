import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import {
  documentStatusOptions,
  formatNullableDate,
  formatPickingOrderCompletionStatus,
  formatPickingOrderTrackingStatus,
  formatPickingOrderTrackingStatusFilterLabel,
  getDocumentStatusPillClass,
  getPickingOrderPortalWorkflow,
  getPickingOrderTrackingStatusPillClass,
  isCompletedPickingOrder,
  pickingOrderTrackingStatusOptions,
  PortalPanelHeader,
  type CustomerPortalDetailTab,
  type CustomerPortalDetailTabRequest
} from "./CustomerPortalTrackingShared";
import { DocumentAttachmentsPanel, InlineLoadingIndicator } from "./sharedUi";
import type { PendingDocumentAttachment } from "./sharedUi";
import type { DocumentAttachment, OutboundDocument } from "./types";

type CustomerPortalPickingOrdersPageProps = {
  pickingOrders: OutboundDocument[];
  isLoading: boolean;
  adminPortalCustomerId?: number;
  selectedPickingOrderId: number | null;
  pendingAttachments: PendingDocumentAttachment[];
  detailTabRequest: CustomerPortalDetailTabRequest | null;
  onPickingOrdersChange: (documents: OutboundDocument[]) => void;
  onSelectedPickingOrderIdChange: (documentId: number | null) => void;
  onPendingAttachmentsChange: (attachments: PendingDocumentAttachment[]) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

export function CustomerPortalPickingOrdersPage({
  pickingOrders,
  isLoading,
  adminPortalCustomerId,
  selectedPickingOrderId,
  pendingAttachments,
  detailTabRequest,
  onPickingOrdersChange,
  onSelectedPickingOrderIdChange,
  onPendingAttachmentsChange,
  onSuccess,
  onError
}: CustomerPortalPickingOrdersPageProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [trackingStatus, setTrackingStatus] = useState("all");
  const [activeDetailTab, setActiveDetailTab] = useState<CustomerPortalDetailTab>("details");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const selectedDocument = useMemo(
    () => pickingOrders.find((document) => document.id === selectedPickingOrderId) ?? pickingOrders[0] ?? null,
    [pickingOrders, selectedPickingOrderId]
  );
  const selectedWorkflow = selectedDocument ? getPickingOrderPortalWorkflow(selectedDocument, t) : null;
  const selectedAttachmentCount = selectedDocument?.attachments?.length ?? 0;

  useEffect(() => {
    if (pickingOrders.length === 0) {
      onSelectedPickingOrderIdChange(null);
      return;
    }
    if (!selectedPickingOrderId || !pickingOrders.some((document) => document.id === selectedPickingOrderId)) {
      onSelectedPickingOrderIdChange(pickingOrders[0].id);
    }
  }, [onSelectedPickingOrderIdChange, pickingOrders, selectedPickingOrderId]);

  useEffect(() => {
    if (detailTabRequest) {
      setActiveDetailTab(detailTabRequest.tab);
    }
  }, [detailTabRequest]);

  async function refreshPickingOrders() {
    setIsRefreshing(true);
    setErrorMessage("");
    try {
      const documentRows = await customerPortalApi.getPickingOrders(100, {
        search,
        status,
        trackingStatus
      }, adminPortalCustomerId);
      onPickingOrdersChange(documentRows);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("customerPortalLoadFailed");
      setErrorMessage(message);
      onError(message);
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleUploadAttachment(file: File, displayName: string) {
    if (!selectedDocument) {
      throw new Error(t("customerPortalSelectPickingOrder"));
    }
    await customerPortalApi.uploadPickingOrderAttachment(selectedDocument.id, file, displayName, adminPortalCustomerId);
    await refreshPickingOrders();
  }

  async function getAttachmentDownloadUrl(attachment: DocumentAttachment) {
    const result = await customerPortalApi.getPickingOrderAttachmentDownloadUrl(attachment.documentId, attachment.id, adminPortalCustomerId);
    return result.url;
  }

  async function handleDeleteAttachment(attachment: DocumentAttachment) {
    await customerPortalApi.deletePickingOrderAttachment(attachment.documentId, attachment.id, adminPortalCustomerId);
    await refreshPickingOrders();
    onSuccess(t("attachmentDeletedSuccess"));
  }

  function selectDocument(document: OutboundDocument) {
    onSelectedPickingOrderIdChange(document.id);
    onPendingAttachmentsChange([]);
    setActiveDetailTab("details");
  }

  const loading = isLoading || isRefreshing;

  return (
    <div className="customer-portal-record-grid">
      <section className="customer-portal-panel customer-portal-panel--list">
        <div className="tab-strip">
          <PortalPanelHeader title={t("customerPortalPickingOrders")} icon={<AssignmentTurnedInOutlinedIcon fontSize="small" />} errorMessage={errorMessage} />
          <div className="filter-bar">
            <label>{t("search")}<span className="customer-portal-search-field"><SearchOutlinedIcon fontSize="small" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("customerPortalPickingOrderSearch")} /></span></label>
            <label>{t("status")}<select value={status} onChange={(event) => setStatus(event.target.value)}>{documentStatusOptions.map((option) => <option key={option} value={option}>{option === "all" ? t("all") : t(option.toLowerCase())}</option>)}</select></label>
            <label>{t("trackingStatus")}<select value={trackingStatus} onChange={(event) => setTrackingStatus(event.target.value)}>{pickingOrderTrackingStatusOptions.map((option) => <option key={option} value={option}>{formatPickingOrderTrackingStatusFilterLabel(option, t)}</option>)}</select></label>
            <button className="button button--ghost" type="button" onClick={() => void refreshPickingOrders()} disabled={loading}>{loading ? <InlineLoadingIndicator /> : null}{t("apply")}</button>
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
                <th>{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {pickingOrders.map((document) => (
                <tr
                  key={document.id}
                  className={selectedDocument?.id === document.id ? "sheet-table__row--selected" : undefined}
                >
                  <td data-label={t("packingListNo")}>{document.packingListNo || `#${document.id}`}</td>
                  <td data-label={t("orderRef")}>{document.orderRef || "-"}</td>
                  <td data-label={t("trackingStatus")}><span className={`status-pill ${getPickingOrderTrackingStatusPillClass(document)}`}>{formatPickingOrderTrackingStatus(document.trackingStatus, document.status, t)}</span></td>
                  <td data-label={t("customerPortalCompletionStatus")}><span className={`status-pill ${isCompletedPickingOrder(document) ? "status-pill--ok" : "status-pill--alert"}`}>{formatPickingOrderCompletionStatus(document, t)}</span></td>
                  <td data-label={t("status")}><span className={`status-pill ${getDocumentStatusPillClass(document.status)}`}>{t(document.status.toLowerCase())}</span></td>
                  <td data-label={t("totalQty")}>{document.totalQty}</td>
                  <td data-label={t("expectedShipDate")}>{document.expectedShipDate || "-"}</td>
                  <td data-label={t("attachments")}><span className="customer-portal-attachment-count"><AttachFileOutlinedIcon fontSize="small" />{document.attachments?.length ?? 0}</span></td>
                  <td data-label={t("actions")}>
                    <button
                      className="button button--ghost button--small customer-portal-row-action"
                      type="button"
                      onClick={() => selectDocument(document)}
                      aria-label={`${t("details")} ${document.packingListNo || `#${document.id}`}`}
                    >
                      {t("details")}
                    </button>
                  </td>
                </tr>
              ))}
              {pickingOrders.length === 0 ? (
                <tr><td colSpan={9}><div className="empty-state">{loading ? t("loadingRecords") : t("noPickingOrders")}</div></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="customer-portal-panel customer-portal-panel--detail">
        <PortalPanelHeader
          title={selectedDocument ? `${t("customerPortalPickingOrderDetail")} ${selectedDocument.packingListNo || `#${selectedDocument.id}`}` : t("customerPortalPickingOrderDetail")}
          description={t("customerPortalPickingOrderDetailDesc")}
          icon={<AttachFileOutlinedIcon fontSize="small" />}
        />
        {selectedDocument && selectedWorkflow ? (
          <div className="customer-portal-detail">
            <div className="reports-tab-nav customer-portal-detail-tabs" role="tablist" aria-label={t("customerPortalPickingOrderDetail")}>
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
                  {tabKey === "documents" && selectedAttachmentCount > 0 ? (
                    <small className="customer-portal-detail-tabs__count">{selectedAttachmentCount}</small>
                  ) : null}
                </button>
              ))}
            </div>

            {activeDetailTab === "details" ? (
              <>
                <div className="metric-ribbon">
                  <article className="metric-card">
                    <span>{t("trackingStatus")}</span>
                    <strong><span className={`status-pill ${getPickingOrderTrackingStatusPillClass(selectedDocument)}`}>{formatPickingOrderTrackingStatus(selectedDocument.trackingStatus, selectedDocument.status, t)}</span></strong>
                  </article>
                  <article className="metric-card">
                    <span>{t("customerPortalCompletionStatus")}</span>
                    <strong><span className={`status-pill ${isCompletedPickingOrder(selectedDocument) ? "status-pill--ok" : "status-pill--alert"}`}>{formatPickingOrderCompletionStatus(selectedDocument, t)}</span></strong>
                  </article>
                  <article className="metric-card">
                    <span>{t("totalQty")}</span>
                    <strong>{selectedDocument.totalQty}</strong>
                  </article>
                  <article className="metric-card">
                    <span>{t("totalLines")}</span>
                    <strong>{selectedDocument.totalLines}</strong>
                  </article>
                </div>

                <div className="customer-portal-workflow" aria-label={t("customerPortalWorkflowProgress")}>
                  <div className="customer-portal-workflow__summary">
                    <strong>{t("customerPortalWorkflowProgress")}</strong>
                    <span>{selectedWorkflow.progress}%</span>
                  </div>
                  <div className="customer-portal-workflow__track">
                    {selectedWorkflow.steps.map((step, index) => (
                      <div
                        className={[
                          "customer-portal-workflow__step",
                          index < selectedWorkflow.activeIndex ? "customer-portal-workflow__step--complete" : "",
                          index === selectedWorkflow.activeIndex ? "customer-portal-workflow__step--active" : ""
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
                  <div className="sheet-note sheet-note--readonly"><strong>{t("orderRef")}</strong><br />{selectedDocument.orderRef || "-"}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("expectedShipDate")}</strong><br />{formatNullableDate(selectedDocument.expectedShipDate)}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("actualShipDate")}</strong><br />{formatNullableDate(selectedDocument.actualShipDate)}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("carrierName")}</strong><br />{selectedDocument.carrierName || "-"}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("shipToName")}</strong><br />{selectedDocument.shipToName || "-"}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("shipToContact")}</strong><br />{selectedDocument.shipToContact || "-"}</div>
                  <div className="sheet-note sheet-note--readonly customer-portal-detail-grid__wide"><strong>{t("shipToAddress")}</strong><br />{selectedDocument.shipToAddress || "-"}</div>
                  <div className="sheet-note sheet-note--readonly customer-portal-detail-grid__wide"><strong>{t("documentNotes")}</strong><br />{selectedDocument.documentNote || "-"}</div>
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
                        <th>{t("notes")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDocument.lines.map((line) => (
                        <tr key={line.id}>
                          <td data-label={t("itemNumber")}>{line.itemNumber || "-"}</td>
                          <td data-label={t("sku")}>{line.sku || "-"}</td>
                          <td data-label={t("description")}>{line.description || "-"}</td>
                          <td data-label={t("storageName")}>{[line.locationName, line.storageSection].filter(Boolean).join(" / ") || "-"}</td>
                          <td data-label={t("quantity")}>{line.quantity} {line.unitLabel || ""}</td>
                          <td data-label={t("notes")}>{line.lineNote || "-"}</td>
                        </tr>
                      ))}
                      {selectedDocument.lines.length === 0 ? (
                        <tr><td colSpan={6}><div className="empty-state">{t("customerPortalNoPickingOrderLineItems")}</div></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <DocumentAttachmentsPanel
                attachments={selectedDocument.attachments ?? []}
                pendingAttachments={pendingAttachments}
                onPendingAttachmentsChange={onPendingAttachmentsChange}
                onUpload={handleUploadAttachment}
                onGetDownloadUrl={getAttachmentDownloadUrl}
                onDelete={handleDeleteAttachment}
              />
            )}
          </div>
        ) : (
          <div className="empty-state">{t("customerPortalSelectPickingOrder")}</div>
        )}
      </section>
    </div>
  );
}
