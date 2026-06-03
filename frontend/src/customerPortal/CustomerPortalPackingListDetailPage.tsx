import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import { useMemo, useState } from "react";

import { useI18n } from "../lib/i18n";
import { SheetTable, SheetTableCell, type SheetTableColumn } from "../shared/SheetTable";
import { customerPortalApi } from "./api";
import {
  formatNullableDate,
  formatPackingListCompletionStatus,
  formatPackingListTrackingStatus,
  getPackingListPortalWorkflow,
  getPackingListTrackingStatusPillClass,
  isCompletedPackingList,
  PortalPanelHeader,
  type CustomerPortalDetailTab
} from "./CustomerPortalTrackingShared";
import { DocumentAttachmentsPanel } from "./sharedUi";
import type { DocumentAttachment, InboundDocument } from "./types";

type CustomerPortalPackingListDetailPageProps = {
  packingLists: InboundDocument[];
  selectedPackingListId: number | null;
  adminPortalCustomerId?: number;
  onBack: () => void;
};

export function CustomerPortalPackingListDetailPage({
  packingLists,
  selectedPackingListId,
  adminPortalCustomerId,
  onBack
}: CustomerPortalPackingListDetailPageProps) {
  const { t } = useI18n();
  const [activeDetailTab, setActiveDetailTab] = useState<CustomerPortalDetailTab>("details");
  const selectedDocument = useMemo(
    () => packingLists.find((document) => document.id === selectedPackingListId) ?? null,
    [packingLists, selectedPackingListId]
  );
  const selectedWorkflow = selectedDocument ? getPackingListPortalWorkflow(selectedDocument, t) : null;
  const selectedAttachmentCount = selectedDocument?.attachments?.length ?? 0;
  const lineColumns: SheetTableColumn[] = [
    { key: "sku", header: t("sku") },
    { key: "description", header: t("description") },
    { key: "storageName", header: t("storageName") },
    { key: "expectedQty", header: t("expectedQty") },
    { key: "received", header: t("received") },
    { key: "notes", header: t("notes") }
  ];

  async function getAttachmentDownloadUrl(attachment: DocumentAttachment) {
    const result = await customerPortalApi.getPackingListAttachmentDownloadUrl(attachment.documentId, attachment.id, adminPortalCustomerId);
    return result.url;
  }

  return (
    <section className="customer-portal-panel customer-portal-detail-page">
      <PortalPanelHeader
        title={selectedDocument ? `${t("customerPortalPackingListDetail")} ${selectedDocument.containerNo || `#${selectedDocument.id}`}` : t("customerPortalPackingListDetail")}
        description={t("customerPortalPackingListDetailDesc")}
        icon={<AttachFileOutlinedIcon fontSize="small" />}
        actions={(
          <button className="button button--ghost" type="button" onClick={onBack}>
            <ArrowBackOutlinedIcon fontSize="small" />
            {t("backToPackingLists")}
          </button>
        )}
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

              <SheetTable
                columns={lineColumns}
                ariaLabel={t("lineItemsView")}
                emptyState={selectedDocument.lines.length === 0 ? <div className="empty-state">{t("customerPortalNoPackingListLineItems")}</div> : null}
              >
                {selectedDocument.lines.map((line) => (
                  <tr key={line.id}>
                    <SheetTableCell label={t("sku")}>{line.sku || "-"}</SheetTableCell>
                    <SheetTableCell label={t("description")}>{line.description || "-"}</SheetTableCell>
                    <SheetTableCell label={t("storageName")}>{line.storageSection || "-"}</SheetTableCell>
                    <SheetTableCell label={t("expectedQty")}>{line.expectedQty} {line.unitLabel || ""}</SheetTableCell>
                    <SheetTableCell label={t("received")}>{line.receivedQty} {line.unitLabel || ""}</SheetTableCell>
                    <SheetTableCell label={t("notes")}>{line.lineNote || "-"}</SheetTableCell>
                  </tr>
                ))}
              </SheetTable>
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
  );
}
