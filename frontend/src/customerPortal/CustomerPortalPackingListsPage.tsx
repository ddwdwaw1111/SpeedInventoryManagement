import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import { useState } from "react";

import { useI18n } from "../lib/i18n";
import { SearchSubmitField } from "../shared/SearchSubmitField";
import { SheetTable, SheetTableCell, type SheetTableColumn } from "../shared/SheetTable";
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
  const packingListColumns: SheetTableColumn[] = [
    { key: "containerNo", header: t("containerNo") },
    { key: "trackingStatus", header: t("trackingStatus") },
    { key: "completionStatus", header: t("customerPortalCompletionStatus") },
    { key: "status", header: t("status") },
    { key: "expectedQty", header: t("expectedQty") },
    { key: "received", header: t("received") },
    { key: "expectedArrivalDate", header: t("expectedArrivalDate") },
    { key: "attachments", header: t("attachments") },
    { key: "actions", header: t("actions") }
  ];

  return (
    <section className="customer-portal-panel customer-portal-tracking-page">
      <div className="customer-portal-tracking-list">
        <div className="tab-strip">
          <PortalPanelHeader title={t("customerPortalPackingLists")} icon={<MoveToInboxOutlinedIcon fontSize="small" />} errorMessage={errorMessage} />
          <div className="filter-bar">
            <SearchSubmitField
              label={t("search")}
              placeholder={t("customerPortalPackingListSearch")}
              value={search}
              disabled={loading}
              submitTitle={t("apply")}
              onChange={setSearch}
              onSubmit={() => void refreshPackingLists()}
            />
            <label>{t("status")}<select value={status} onChange={(event) => setStatus(event.target.value)}>{documentStatusOptions.map((option) => <option key={option} value={option}>{option === "all" ? t("all") : t(option.toLowerCase())}</option>)}</select></label>
            <label>{t("trackingStatus")}<select value={trackingStatus} onChange={(event) => setTrackingStatus(event.target.value)}>{packingListTrackingStatusOptions.map((option) => <option key={option} value={option}>{formatPackingListTrackingStatusFilterLabel(option, t)}</option>)}</select></label>
            <button className="button button--ghost" type="button" onClick={() => void refreshPackingLists()} disabled={loading}>{loading ? <InlineLoadingIndicator /> : null}{t("apply")}</button>
          </div>
        </div>
        <SheetTable
          columns={packingListColumns}
          emptyState={packingLists.length === 0 ? <div className="empty-state">{loading ? t("loadingRecords") : t("noPackingLists")}</div> : null}
        >
          {packingLists.map((document) => (
            <tr
              key={document.id}
              className={selectedPackingListId === document.id ? "sheet-table__row--selected" : undefined}
            >
              <SheetTableCell label={t("containerNo")}>{document.containerNo || `#${document.id}`}</SheetTableCell>
              <SheetTableCell label={t("trackingStatus")}><span className={`status-pill ${getPackingListTrackingStatusPillClass(document)}`}>{formatPackingListTrackingStatus(document.trackingStatus, document.status, t)}</span></SheetTableCell>
              <SheetTableCell label={t("customerPortalCompletionStatus")}><span className={`status-pill ${isCompletedPackingList(document) ? "status-pill--ok" : "status-pill--alert"}`}>{formatPackingListCompletionStatus(document, t)}</span></SheetTableCell>
              <SheetTableCell label={t("status")}><span className={`status-pill ${getDocumentStatusPillClass(document.status)}`}>{t(document.status.toLowerCase())}</span></SheetTableCell>
              <SheetTableCell label={t("expectedQty")}>{document.totalExpectedQty}</SheetTableCell>
              <SheetTableCell label={t("received")}>{document.totalReceivedQty}</SheetTableCell>
              <SheetTableCell label={t("expectedArrivalDate")}>{document.expectedArrivalDate || "-"}</SheetTableCell>
              <SheetTableCell label={t("attachments")}><span className="customer-portal-attachment-count"><AttachFileOutlinedIcon fontSize="small" />{document.attachments?.length ?? 0}</span></SheetTableCell>
              <SheetTableCell label={t("actions")}>
                <button
                  className="button button--ghost button--small customer-portal-row-action"
                  type="button"
                  onClick={() => onOpenDetail(document.id)}
                  aria-label={`${t("details")} ${document.containerNo || `#${document.id}`}`}
                >
                  {t("details")}
                </button>
              </SheetTableCell>
            </tr>
          ))}
        </SheetTable>
      </div>
    </section>
  );
}
