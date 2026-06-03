import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import { useState } from "react";

import { useI18n } from "../lib/i18n";
import { SearchSubmitField } from "../shared/SearchSubmitField";
import { SheetTable, SheetTableCell, type SheetTableColumn } from "../shared/SheetTable";
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
  const pickingOrderColumns: SheetTableColumn[] = [
    { key: "packingListNo", header: t("packingListNo") },
    { key: "orderRef", header: t("orderRef") },
    { key: "trackingStatus", header: t("trackingStatus") },
    { key: "completionStatus", header: t("customerPortalCompletionStatus") },
    { key: "status", header: t("status") },
    { key: "totalQty", header: t("totalQty") },
    { key: "expectedShipDate", header: t("expectedShipDate") },
    { key: "attachments", header: t("attachments") },
    { key: "actions", header: t("actions") }
  ];

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
            <SearchSubmitField
              label={t("search")}
              placeholder={t("customerPortalPickingOrderSearch")}
              value={search}
              disabled={loading}
              submitTitle={t("apply")}
              onChange={setSearch}
              onSubmit={() => void refreshPickingOrders()}
            />
            <label>{t("status")}<select value={status} onChange={(event) => setStatus(event.target.value)}>{documentStatusOptions.map((option) => <option key={option} value={option}>{option === "all" ? t("all") : t(option.toLowerCase())}</option>)}</select></label>
            <label>{t("trackingStatus")}<select value={trackingStatus} onChange={(event) => setTrackingStatus(event.target.value)}>{pickingOrderTrackingStatusOptions.map((option) => <option key={option} value={option}>{formatPickingOrderTrackingStatusFilterLabel(option, t)}</option>)}</select></label>
            <button className="button button--ghost" type="button" onClick={() => void refreshPickingOrders()} disabled={loading}>{loading ? <InlineLoadingIndicator /> : null}{t("apply")}</button>
          </div>
        </div>
        <SheetTable
          columns={pickingOrderColumns}
          emptyState={pickingOrders.length === 0 ? <div className="empty-state">{loading ? t("loadingRecords") : t("noPickingOrders")}</div> : null}
        >
          {pickingOrders.map((document) => (
            <tr
              key={document.id}
              className={selectedPickingOrderId === document.id ? "sheet-table__row--selected" : undefined}
            >
              <SheetTableCell label={t("packingListNo")}>{document.packingListNo || `#${document.id}`}</SheetTableCell>
              <SheetTableCell label={t("orderRef")}>{document.orderRef || "-"}</SheetTableCell>
              <SheetTableCell label={t("trackingStatus")}><span className={`status-pill ${getPickingOrderTrackingStatusPillClass(document)}`}>{formatPickingOrderTrackingStatus(document.trackingStatus, document.status, t)}</span></SheetTableCell>
              <SheetTableCell label={t("customerPortalCompletionStatus")}><span className={`status-pill ${isCompletedPickingOrder(document) ? "status-pill--ok" : "status-pill--alert"}`}>{formatPickingOrderCompletionStatus(document, t)}</span></SheetTableCell>
              <SheetTableCell label={t("status")}><span className={`status-pill ${getDocumentStatusPillClass(document.status)}`}>{t(document.status.toLowerCase())}</span></SheetTableCell>
              <SheetTableCell label={t("totalQty")}>{document.totalQty}</SheetTableCell>
              <SheetTableCell label={t("expectedShipDate")}>{document.expectedShipDate || "-"}</SheetTableCell>
              <SheetTableCell label={t("attachments")}><span className="customer-portal-attachment-count"><AttachFileOutlinedIcon fontSize="small" />{document.attachments?.length ?? 0}</span></SheetTableCell>
              <SheetTableCell label={t("actions")}>
                <button
                  className="button button--ghost button--small customer-portal-row-action"
                  type="button"
                  onClick={() => onOpenDetail(document.id)}
                  aria-label={`${t("details")} ${document.packingListNo || `#${document.id}`}`}
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
