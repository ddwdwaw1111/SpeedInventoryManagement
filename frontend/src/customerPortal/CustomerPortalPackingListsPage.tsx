import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import {
  documentStatusOptions,
  formatNullableDate,
  formatPackingListCompletionStatus,
  formatPackingListTrackingStatus,
  formatPackingListTrackingStatusFilterLabel,
  getDocumentStatusPillClass,
  getPackingListPortalWorkflow,
  getPackingListTrackingStatusPillClass,
  isCompletedPackingList,
  packingListTrackingStatusOptions,
  PortalPanelHeader,
  type CustomerPortalDetailTab
} from "./CustomerPortalTrackingShared";
import { DocumentAttachmentsPanel, InlineLoadingIndicator } from "./sharedUi";
import type { DocumentAttachment, InboundDocument } from "./types";

type CustomerPortalPackingListsPageProps = {
  packingLists: InboundDocument[];
  isLoading: boolean;
  adminPortalCustomerId?: number;
  onPackingListsChange: (documents: InboundDocument[]) => void;
  onError: (message: string) => void;
};

export function CustomerPortalPackingListsPage({
  packingLists,
  isLoading,
  adminPortalCustomerId,
  onPackingListsChange,
  onError
}: CustomerPortalPackingListsPageProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [trackingStatus, setTrackingStatus] = useState("all");
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<CustomerPortalDetailTab>("details");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const selectedDocument = useMemo(
    () => packingLists.find((document) => document.id === selectedDocumentId) ?? packingLists[0] ?? null,
    [packingLists, selectedDocumentId]
  );
  const selectedWorkflow = selectedDocument ? getPackingListPortalWorkflow(selectedDocument, t) : null;
  const selectedAttachmentCount = selectedDocument?.attachments?.length ?? 0;

  useEffect(() => {
    if (packingLists.length === 0) {
      setSelectedDocumentId(null);
      return;
    }
    if (!selectedDocumentId || !packingLists.some((document) => document.id === selectedDocumentId)) {
      setSelectedDocumentId(packingLists[0].id);
    }
  }, [packingLists, selectedDocumentId]);

  async function refreshPackingLists() {
    setIsRefreshing(true);
    setErrorMessage("");
    try {
      const documentRows = await customerPortalApi.getPackingLists(100, {
        search,
        status,
        trackingStatus
      }, adminPortalCustomerId);
      onPackingListsChange(documentRows);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("customerPortalLoadFailed");
      setErrorMessage(message);
      onError(message);
    } finally {
      setIsRefreshing(false);
    }
  }

  async function getAttachmentDownloadUrl(attachment: DocumentAttachment) {
    const result = await customerPortalApi.getPackingListAttachmentDownloadUrl(attachment.documentId, attachment.id, adminPortalCustomerId);
    return result.url;
  }

  function selectDocument(document: InboundDocument) {
    setSelectedDocumentId(document.id);
    setActiveDetailTab("details");
  }

  const loading = isLoading || isRefreshing;

  return (
    <div className="customer-portal-record-grid">
      <section className="customer-portal-panel customer-portal-panel--list">
        <div className="tab-strip">
          <PortalPanelHeader title={t("customerPortalPackingLists")} icon={<MoveToInboxOutlinedIcon fontSize="small" />} errorMessage={errorMessage} />
          <div className="filter-bar">
            <label>{t("search")}<span className="customer-portal-search-field"><SearchOutlinedIcon fontSize="small" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("customerPortalPackingListSearch")} /></span></label>
            <label>{t("status")}<select value={status} onChange={(event) => setStatus(event.target.value)}>{documentStatusOptions.map((option) => <option key={option} value={option}>{option === "all" ? t("all") : t(option.toLowerCase())}</option>)}</select></label>
            <label>{t("trackingStatus")}<select value={trackingStatus} onChange={(event) => setTrackingStatus(event.target.value)}>{packingListTrackingStatusOptions.map((option) => <option key={option} value={option}>{formatPackingListTrackingStatusFilterLabel(option, t)}</option>)}</select></label>
            <button className="button button--ghost" type="button" onClick={() => void refreshPackingLists()} disabled={loading}>{loading ? <InlineLoadingIndicator /> : null}{t("apply")}</button>
          </div>
        </div>
        <div className="sheet-table-wrap">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>{t("containerNo")}</th>
                <th>{t("trackingStatus")}</th>
                <th>{t("customerPortalCompletionStatus")}</th>
                <th>{t("status")}</th>
                <th>{t("expectedQty")}</th>
                <th>{t("received")}</th>
                <th>{t("expectedArrivalDate")}</th>
                <th>{t("attachments")}</th>
                <th>{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {packingLists.map((document) => (
                <tr
                  key={document.id}
                  className={selectedDocument?.id === document.id ? "sheet-table__row--selected" : undefined}
                >
                  <td data-label={t("containerNo")}>{document.containerNo || `#${document.id}`}</td>
                  <td data-label={t("trackingStatus")}><span className={`status-pill ${getPackingListTrackingStatusPillClass(document)}`}>{formatPackingListTrackingStatus(document.trackingStatus, document.status, t)}</span></td>
                  <td data-label={t("customerPortalCompletionStatus")}><span className={`status-pill ${isCompletedPackingList(document) ? "status-pill--ok" : "status-pill--alert"}`}>{formatPackingListCompletionStatus(document, t)}</span></td>
                  <td data-label={t("status")}><span className={`status-pill ${getDocumentStatusPillClass(document.status)}`}>{t(document.status.toLowerCase())}</span></td>
                  <td data-label={t("expectedQty")}>{document.totalExpectedQty}</td>
                  <td data-label={t("received")}>{document.totalReceivedQty}</td>
                  <td data-label={t("expectedArrivalDate")}>{document.expectedArrivalDate || "-"}</td>
                  <td data-label={t("attachments")}><span className="customer-portal-attachment-count"><AttachFileOutlinedIcon fontSize="small" />{document.attachments?.length ?? 0}</span></td>
                  <td data-label={t("actions")}>
                    <button
                      className="button button--ghost button--small customer-portal-row-action"
                      type="button"
                      onClick={() => selectDocument(document)}
                      aria-label={`${t("details")} ${document.containerNo || `#${document.id}`}`}
                    >
                      {t("details")}
                    </button>
                  </td>
                </tr>
              ))}
              {packingLists.length === 0 ? (
                <tr><td colSpan={9}><div className="empty-state">{loading ? t("loadingRecords") : t("noPackingLists")}</div></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="customer-portal-panel customer-portal-panel--detail">
        <PortalPanelHeader
          title={selectedDocument ? `${t("customerPortalPackingListDetail")} ${selectedDocument.containerNo || `#${selectedDocument.id}`}` : t("customerPortalPackingListDetail")}
          description={t("customerPortalPackingListDetailDesc")}
          icon={<AttachFileOutlinedIcon fontSize="small" />}
        />
        {selectedDocument && selectedWorkflow ? (
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
                    <strong><span className={`status-pill ${getPackingListTrackingStatusPillClass(selectedDocument)}`}>{formatPackingListTrackingStatus(selectedDocument.trackingStatus, selectedDocument.status, t)}</span></strong>
                  </article>
                  <article className="metric-card">
                    <span>{t("customerPortalCompletionStatus")}</span>
                    <strong><span className={`status-pill ${isCompletedPackingList(selectedDocument) ? "status-pill--ok" : "status-pill--alert"}`}>{formatPackingListCompletionStatus(selectedDocument, t)}</span></strong>
                  </article>
                  <article className="metric-card">
                    <span>{t("expectedQty")}</span>
                    <strong>{selectedDocument.totalExpectedQty}</strong>
                  </article>
                  <article className="metric-card">
                    <span>{t("received")}</span>
                    <strong>{selectedDocument.totalReceivedQty}</strong>
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
                  <div className="sheet-note sheet-note--readonly"><strong>{t("containerNo")}</strong><br />{selectedDocument.containerNo || "-"}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("expectedArrivalDate")}</strong><br />{formatNullableDate(selectedDocument.expectedArrivalDate)}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("actualArrivalDate")}</strong><br />{formatNullableDate(selectedDocument.actualArrivalDate)}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("storageName")}</strong><br />{selectedDocument.locationName || "-"}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("currentStorage")}</strong><br />{selectedDocument.storageSection || "-"}</div>
                  <div className="sheet-note sheet-note--readonly"><strong>{t("unit")}</strong><br />{selectedDocument.unitLabel || "-"}</div>
                  <div className="sheet-note sheet-note--readonly customer-portal-detail-grid__wide"><strong>{t("documentNotes")}</strong><br />{selectedDocument.documentNote || "-"}</div>
                </div>

                <div className="sheet-table-wrap">
                  <table className="sheet-table" aria-label={t("lineItemsView")}>
                    <thead>
                      <tr>
                        <th>{t("sku")}</th>
                        <th>{t("description")}</th>
                        <th>{t("storageName")}</th>
                        <th>{t("expectedQty")}</th>
                        <th>{t("received")}</th>
                        <th>{t("notes")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDocument.lines.map((line) => (
                        <tr key={line.id}>
                          <td data-label={t("sku")}>{line.sku || "-"}</td>
                          <td data-label={t("description")}>{line.description || "-"}</td>
                          <td data-label={t("storageName")}>{line.storageSection || "-"}</td>
                          <td data-label={t("expectedQty")}>{line.expectedQty} {line.unitLabel || ""}</td>
                          <td data-label={t("received")}>{line.receivedQty} {line.unitLabel || ""}</td>
                          <td data-label={t("notes")}>{line.lineNote || "-"}</td>
                        </tr>
                      ))}
                      {selectedDocument.lines.length === 0 ? (
                        <tr><td colSpan={6}><div className="empty-state">{t("customerPortalNoPackingListLineItems")}</div></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <DocumentAttachmentsPanel
                attachments={selectedDocument.attachments ?? []}
                onGetDownloadUrl={getAttachmentDownloadUrl}
              />
            )}
          </div>
        ) : (
          <div className="empty-state">{t("customerPortalSelectPackingList")}</div>
        )}
      </section>
    </div>
  );
}
