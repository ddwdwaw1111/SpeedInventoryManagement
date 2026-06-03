import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../lib/i18n";
import { SheetTable, SheetTableCell, type SheetTableColumn } from "../shared/SheetTable";
import { customerPortalApi } from "./api";
import {
  formatNullableDate,
  formatPickingOrderCompletionStatus,
  formatPickingOrderTrackingStatus,
  getPickingOrderPortalWorkflow,
  getPickingOrderTrackingStatusPillClass,
  isCompletedPickingOrder,
  PortalPanelHeader,
  type CustomerPortalDetailTab,
  type CustomerPortalDetailTabRequest
} from "./CustomerPortalTrackingShared";
import { DocumentAttachmentsPanel } from "./sharedUi";
import type { PendingDocumentAttachment } from "./sharedUi";
import type { DocumentAttachment, OutboundDocument } from "./types";

type CustomerPortalPickingOrderDetailPageProps = {
  pickingOrders: OutboundDocument[];
  selectedPickingOrderId: number | null;
  pendingAttachments: PendingDocumentAttachment[];
  detailTabRequest: CustomerPortalDetailTabRequest | null;
  adminPortalCustomerId?: number;
  onPickingOrdersChange: (documents: OutboundDocument[]) => void;
  onPendingAttachmentsChange: (attachments: PendingDocumentAttachment[]) => void;
  onBack: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

export function CustomerPortalPickingOrderDetailPage({
  pickingOrders,
  selectedPickingOrderId,
  pendingAttachments,
  detailTabRequest,
  adminPortalCustomerId,
  onPickingOrdersChange,
  onPendingAttachmentsChange,
  onBack,
  onSuccess,
  onError
}: CustomerPortalPickingOrderDetailPageProps) {
  const { t } = useI18n();
  const [activeDetailTab, setActiveDetailTab] = useState<CustomerPortalDetailTab>("details");
  const selectedDocument = useMemo(
    () => pickingOrders.find((document) => document.id === selectedPickingOrderId) ?? null,
    [pickingOrders, selectedPickingOrderId]
  );
  const selectedWorkflow = selectedDocument ? getPickingOrderPortalWorkflow(selectedDocument, t) : null;
  const selectedAttachmentCount = selectedDocument?.attachments?.length ?? 0;
  const lineColumns: SheetTableColumn[] = [
    { key: "itemNumber", header: t("itemNumber") },
    { key: "sku", header: t("sku") },
    { key: "description", header: t("description") },
    { key: "storageName", header: t("storageName") },
    { key: "quantity", header: t("quantity") },
    { key: "notes", header: t("notes") }
  ];

  useEffect(() => {
    if (detailTabRequest) {
      setActiveDetailTab(detailTabRequest.tab);
    }
  }, [detailTabRequest]);

  async function refreshPickingOrders() {
    try {
      const documentRows = await customerPortalApi.getPickingOrders(100, {
        search: "",
        status: "all",
        trackingStatus: "all"
      }, adminPortalCustomerId);
      onPickingOrdersChange(documentRows);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("customerPortalLoadFailed");
      onError(message);
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

  return (
    <section className="customer-portal-panel customer-portal-detail-page">
      <PortalPanelHeader
        title={selectedDocument ? `${t("customerPortalPickingOrderDetail")} ${selectedDocument.packingListNo || `#${selectedDocument.id}`}` : t("customerPortalPickingOrderDetail")}
        description={t("customerPortalPickingOrderDetailDesc")}
        icon={<AttachFileOutlinedIcon fontSize="small" />}
        actions={(
          <button className="button button--ghost" type="button" onClick={onBack}>
            <ArrowBackOutlinedIcon fontSize="small" />
            {t("backToPickingOrders")}
          </button>
        )}
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

              <SheetTable
                columns={lineColumns}
                ariaLabel={t("lineItemsView")}
                emptyState={selectedDocument.lines.length === 0 ? <div className="empty-state">{t("customerPortalNoPickingOrderLineItems")}</div> : null}
              >
                {selectedDocument.lines.map((line) => (
                  <tr key={line.id}>
                    <SheetTableCell label={t("itemNumber")}>{line.itemNumber || "-"}</SheetTableCell>
                    <SheetTableCell label={t("sku")}>{line.sku || "-"}</SheetTableCell>
                    <SheetTableCell label={t("description")}>{line.description || "-"}</SheetTableCell>
                    <SheetTableCell label={t("storageName")}>{[line.locationName, line.storageSection].filter(Boolean).join(" / ") || "-"}</SheetTableCell>
                    <SheetTableCell label={t("quantity")}>{line.quantity} {line.unitLabel || ""}</SheetTableCell>
                    <SheetTableCell label={t("notes")}>{line.lineNote || "-"}</SheetTableCell>
                  </tr>
                ))}
              </SheetTable>
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
  );
}
