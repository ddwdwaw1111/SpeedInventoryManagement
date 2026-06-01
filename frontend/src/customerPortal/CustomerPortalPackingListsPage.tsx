import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { useState } from "react";

import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import {
  documentStatusOptions,
  formatPackingListCompletionStatus,
  formatPackingListTrackingStatus,
  formatPackingListTrackingStatusFilterLabel,
  getDocumentStatusPillClass,
  getPackingListTrackingStatusPillClass,
  isCompletedPackingList,
  packingListTrackingStatusOptions,
  PortalPanelHeader
} from "./CustomerPortalTrackingShared";
import { InlineLoadingIndicator } from "./sharedUi";
import type { InboundDocument } from "./types";

type CustomerPortalPackingListsPageProps = {
  packingLists: InboundDocument[];
  isLoading: boolean;
  adminPortalCustomerId?: number;
  selectedPackingListId: number | null;
  onPackingListsChange: (documents: InboundDocument[]) => void;
  onOpenDetail: (documentId: number) => void;
  onError: (message: string) => void;
};

export function CustomerPortalPackingListsPage({
  packingLists,
  isLoading,
  adminPortalCustomerId,
  selectedPackingListId,
  onPackingListsChange,
  onOpenDetail,
  onError
}: CustomerPortalPackingListsPageProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [trackingStatus, setTrackingStatus] = useState("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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

  const loading = isLoading || isRefreshing;

  return (
    <section className="customer-portal-panel customer-portal-tracking-page">
      <div className="customer-portal-tracking-list">
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
                  className={selectedPackingListId === document.id ? "sheet-table__row--selected" : undefined}
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
                      onClick={() => onOpenDetail(document.id)}
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
      </div>
    </section>
  );
}
