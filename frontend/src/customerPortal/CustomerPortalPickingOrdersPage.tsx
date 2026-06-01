import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { useState } from "react";

import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import {
  documentStatusOptions,
  formatPickingOrderCompletionStatus,
  formatPickingOrderTrackingStatus,
  formatPickingOrderTrackingStatusFilterLabel,
  getDocumentStatusPillClass,
  getPickingOrderTrackingStatusPillClass,
  isCompletedPickingOrder,
  pickingOrderTrackingStatusOptions,
  PortalPanelHeader
} from "./CustomerPortalTrackingShared";
import { InlineLoadingIndicator } from "./sharedUi";
import type { OutboundDocument } from "./types";

type CustomerPortalPickingOrdersPageProps = {
  pickingOrders: OutboundDocument[];
  isLoading: boolean;
  adminPortalCustomerId?: number;
  selectedPickingOrderId: number | null;
  onPickingOrdersChange: (documents: OutboundDocument[]) => void;
  onOpenDetail: (documentId: number) => void;
  onCreateNewOrder: () => void;
  onError: (message: string) => void;
};

export function CustomerPortalPickingOrdersPage({
  pickingOrders,
  isLoading,
  adminPortalCustomerId,
  selectedPickingOrderId,
  onPickingOrdersChange,
  onCreateNewOrder,
  onOpenDetail,
  onError
}: CustomerPortalPickingOrdersPageProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [trackingStatus, setTrackingStatus] = useState("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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

  const loading = isLoading || isRefreshing;

  return (
    <section className="customer-portal-panel customer-portal-tracking-page">
      <div className="customer-portal-tracking-list">
        <div className="tab-strip">
          <PortalPanelHeader
            title={t("customerPortalPickingOrders")}
            icon={<AssignmentTurnedInOutlinedIcon fontSize="small" />}
            errorMessage={errorMessage}
            actions={(
              <button className="button button--primary" type="button" onClick={onCreateNewOrder}>
                <AddCircleOutlineOutlinedIcon fontSize="small" />
                {t("newPickingOrder")}
              </button>
            )}
          />
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
                  className={selectedPickingOrderId === document.id ? "sheet-table__row--selected" : undefined}
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
                      onClick={() => onOpenDetail(document.id)}
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
      </div>
    </section>
  );
}
