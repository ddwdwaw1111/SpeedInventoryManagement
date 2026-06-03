import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import type { FormEvent } from "react";

import { useI18n } from "../lib/i18n";
import { SheetTable, SheetTableCell, type SheetTableColumn } from "../shared/SheetTable";
import { PortalPanelHeader } from "./CustomerPortalTrackingShared";
import { DocumentAttachmentsPanel, InlineAlert, InlineLoadingIndicator } from "./sharedUi";
import type { PendingDocumentAttachment } from "./sharedUi";

export type PickingOrderLineDraft = {
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

export type PickingOrderFormState = {
  packingListNo: string;
  orderRef: string;
  expectedShipDate: string;
  shipToName: string;
  shipToAddress: string;
  shipToContact: string;
  carrierName: string;
  documentNote: string;
};

export const emptyPickingOrderForm: PickingOrderFormState = {
  packingListNo: "",
  orderRef: "",
  expectedShipDate: "",
  shipToName: "",
  shipToAddress: "",
  shipToContact: "",
  carrierName: "",
  documentNote: ""
};

type CustomerPortalNewPickingOrderPageProps = {
  form: PickingOrderFormState;
  lineDrafts: PickingOrderLineDraft[];
  pendingAttachments: PendingDocumentAttachment[];
  isSubmitting: boolean;
  errorMessage: string;
  onFormChange: (updates: Partial<PickingOrderFormState>) => void;
  onLineChange: (id: string, updates: Partial<PickingOrderLineDraft>) => void;
  onRemoveLine: (id: string) => void;
  onPendingAttachmentsChange: (attachments: PendingDocumentAttachment[]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onBackToInventory: () => void;
};

export function CustomerPortalNewPickingOrderPage({
  form,
  lineDrafts,
  pendingAttachments,
  isSubmitting,
  errorMessage,
  onFormChange,
  onLineChange,
  onRemoveLine,
  onPendingAttachmentsChange,
  onSubmit,
  onCancel,
  onBackToInventory
}: CustomerPortalNewPickingOrderPageProps) {
  const { t } = useI18n();
  const draftLineCount = lineDrafts.length;
  const draftTotalQty = lineDrafts.reduce((total, line) => total + Math.max(0, Number(line.quantity) || 0), 0);
  const hasValidQuantities = lineDrafts.length > 0 && lineDrafts.every((line) => {
    const quantity = Number(line.quantity);
    return Number.isFinite(quantity) && quantity > 0 && quantity <= line.availableQty;
  });
  const hasShippingInfo = Boolean(form.shipToName.trim() || form.shipToAddress.trim() || form.shipToContact.trim());
  const createSteps = [
    {
      label: t("customerPortalStepSelectSkus"),
      detail: `${draftLineCount} ${t("totalLines")}`,
      isComplete: lineDrafts.length > 0
    },
    {
      label: t("customerPortalStepQuantities"),
      detail: `${draftTotalQty} ${t("totalQty")}`,
      isComplete: hasValidQuantities
    },
    {
      label: t("customerPortalStepDelivery"),
      detail: hasShippingInfo ? t("ready") : t("customerPortalStepMissing"),
      isComplete: hasShippingInfo
    },
    {
      label: t("customerPortalStepFiles"),
      detail: pendingAttachments.length > 0 ? `${pendingAttachments.length} ${t("files")}` : t("customerPortalStepOptional"),
      isComplete: pendingAttachments.length > 0
    }
  ];
  const selectedInventoryColumns: SheetTableColumn[] = [
    { key: "sku", header: t("sku") },
    { key: "storageName", header: t("storageName") },
    { key: "availableQty", header: t("availableQty") },
    { key: "quantity", header: t("quantity") },
    { key: "notes", header: t("notes") },
    { key: "actions", header: t("actions") }
  ];

  return (
    <section className="customer-portal-panel customer-portal-create-flow">
      <PortalPanelHeader
        title={t("newPickingOrder")}
        description={t("customerPortalNewPickingOrderDesc")}
        icon={<LocalShippingOutlinedIcon fontSize="small" />}
        actions={(
          <button className="button button--ghost" type="button" onClick={onCancel} disabled={isSubmitting}>
            {t("cancelPickingOrder")}
          </button>
        )}
      />

      <div className="customer-portal-composer-summary" aria-label={t("newPickingOrder")}>
        <span>{draftLineCount} {t("totalLines")}</span>
        <span>{draftTotalQty} {t("totalQty")}</span>
      </div>

      <ol className="customer-portal-create-steps" aria-label={t("customerPortalCreateProgress")}>
        {createSteps.map((step, index) => (
          <li className={step.isComplete ? "customer-portal-create-steps__item customer-portal-create-steps__item--complete" : "customer-portal-create-steps__item"} key={step.label}>
            <span>{index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
          </li>
        ))}
      </ol>

      {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}

      <form className="customer-portal-create-form" onSubmit={onSubmit} noValidate>
        <div className="customer-portal-create-section">
          <PortalPanelHeader
            title={t("selectedInventory")}
            description={t("customerPortalSelectedInventoryDesc")}
            icon={<Inventory2OutlinedIcon fontSize="small" />}
          />
          <SheetTable
            columns={selectedInventoryColumns}
            emptyState={lineDrafts.length === 0 ? (
              <div className="empty-state customer-portal-create-empty">
                <span>{t("chooseInventoryForPickingOrder")}</span>
                <button className="button button--ghost button--small" type="button" onClick={onBackToInventory}>
                  <ArrowBackOutlinedIcon fontSize="small" />
                  {t("backToInventory")}
                </button>
              </div>
            ) : null}
          >
            {lineDrafts.map((line) => (
              <tr key={line.id}>
                <SheetTableCell label={t("sku")}>{line.sku || line.itemNumber}<br /><span className="sheet-note">{line.description}</span></SheetTableCell>
                <SheetTableCell label={t("storageName")}>{line.locationName}</SheetTableCell>
                <SheetTableCell label={t("availableQty")}>{line.availableQty}</SheetTableCell>
                <SheetTableCell label={t("quantity")}><input type="number" min="1" max={line.availableQty} value={line.quantity} onChange={(event) => onLineChange(line.id, { quantity: event.target.value })} /></SheetTableCell>
                <SheetTableCell label={t("notes")}><input value={line.lineNote} onChange={(event) => onLineChange(line.id, { lineNote: event.target.value })} /></SheetTableCell>
                <SheetTableCell label={t("actions")}><button className="button button--ghost button--small" type="button" onClick={() => onRemoveLine(line.id)} disabled={isSubmitting}>{t("remove")}</button></SheetTableCell>
              </tr>
            ))}
          </SheetTable>
        </div>

        <div className="customer-portal-create-section">
          <PortalPanelHeader
            title={t("shippingDetails")}
            description={t("customerPortalShippingDetailsDesc")}
            icon={<LocalShippingOutlinedIcon fontSize="small" />}
          />
          <div className="sheet-form">
            <label>{t("packingListNo")}<input value={form.packingListNo} onChange={(event) => onFormChange({ packingListNo: event.target.value })} placeholder={t("autoIfBlank")} disabled={isSubmitting} /></label>
            <label>{t("orderRef")}<input value={form.orderRef} onChange={(event) => onFormChange({ orderRef: event.target.value })} disabled={isSubmitting} /></label>
            <label>{t("expectedShipDate")}<input type="date" value={form.expectedShipDate} onChange={(event) => onFormChange({ expectedShipDate: event.target.value })} disabled={isSubmitting} /></label>
            <label>{t("shipToName")}<input value={form.shipToName} onChange={(event) => onFormChange({ shipToName: event.target.value })} disabled={isSubmitting} /></label>
            <label>{t("shipToAddress")}<input value={form.shipToAddress} onChange={(event) => onFormChange({ shipToAddress: event.target.value })} disabled={isSubmitting} /></label>
            <label>{t("shipToContact")}<input value={form.shipToContact} onChange={(event) => onFormChange({ shipToContact: event.target.value })} disabled={isSubmitting} /></label>
            <label>{t("carrierName")}<input value={form.carrierName} onChange={(event) => onFormChange({ carrierName: event.target.value })} disabled={isSubmitting} /></label>
            <label className="sheet-form__wide">{t("documentNotes")}<textarea value={form.documentNote} onChange={(event) => onFormChange({ documentNote: event.target.value })} rows={3} disabled={isSubmitting} /></label>
          </div>
        </div>

        <div className="customer-portal-create-section">
          <DocumentAttachmentsPanel
            attachments={[]}
            pendingAttachments={pendingAttachments}
            disabled={isSubmitting}
            showUploadButton={false}
            onPendingAttachmentsChange={onPendingAttachmentsChange}
            onGetDownloadUrl={async () => ""}
          />
        </div>

        <div className="customer-portal-create-actions">
          <button className="button button--ghost" type="button" onClick={onCancel} disabled={isSubmitting}>
            {t("cancelPickingOrder")}
          </button>
          <button className="button button--primary" type="submit" disabled={isSubmitting || lineDrafts.length === 0}>
            {isSubmitting ? <InlineLoadingIndicator /> : null}
            {t("submitPickingOrder")}
          </button>
        </div>
      </form>
    </section>
  );
}
