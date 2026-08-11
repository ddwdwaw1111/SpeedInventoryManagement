import { ArrowLeft, ClipboardList, PackageSearch, SendToBack, Trash2, Truck } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input, Textarea } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useI18n } from "../lib/i18n";
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
  pickingOrderNo: string;
  orderRef: string;
  expectedShipDate: string;
  shipToName: string;
  shipToAddress: string;
  shipToContact: string;
  carrierName: string;
  documentNote: string;
};

export const emptyPickingOrderForm: PickingOrderFormState = {
  pickingOrderNo: "",
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

  return (
    <section className="grid gap-4">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <PortalPanelHeader
          title={t("newPickingOrder")}
          description={t("customerPortalNewPickingOrderDesc")}
          infoTooltip={t("customerPortalOutboundTooltip")}
          icon={<SendToBack className="h-4 w-4" />}
          actions={(
            <Button variant="ghost" type="button" onClick={onCancel} disabled={isSubmitting}>
              {t("cancelPickingOrder")}
            </Button>
          )}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {createSteps.map((step, index) => (
          <div
            className={`rounded-lg border p-4 ${step.isComplete ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}
            key={step.label}
          >
            <div className="flex items-center justify-between gap-3">
              <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold ${step.isComplete ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600"}`}>
                {index + 1}
              </span>
              <span className={`text-xs font-semibold uppercase ${step.isComplete ? "text-emerald-700" : "text-slate-500"}`}>
                {step.isComplete ? t("completed") : t("open")}
              </span>
            </div>
            <strong className="mt-3 block text-sm font-semibold text-slate-950">{step.label}</strong>
            <span className="mt-1 block text-sm text-slate-500">{step.detail}</span>
          </div>
        ))}
      </div>

      {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}

      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        <Card>
          <CardHeader>
            <PortalPanelHeader
              title={t("selectedInventory")}
              description={t("customerPortalSelectedInventoryDesc")}
              icon={<PackageSearch className="h-4 w-4" />}
            />
          </CardHeader>
          <CardContent>
            {lineDrafts.length === 0 ? (
              <div className="grid place-items-center gap-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <div>
                  <strong className="block text-sm font-semibold text-slate-950">{t("chooseInventoryForPickingOrder")}</strong>
                  <span className="mt-1 block text-sm text-slate-500">{t("customerPortalAddInventoryHint")}</span>
                </div>
                <Button variant="outline" type="button" onClick={onBackToInventory}>
                  <ArrowLeft className="h-4 w-4" />
                  {t("backToInventory")}
                </Button>
              </div>
            ) : (
              <Table aria-label={t("selectedInventory")}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("sku")}</TableHead>
                    <TableHead>{t("storageName")}</TableHead>
                    <TableHead>{t("availableQty")}</TableHead>
                    <TableHead>{t("quantity")}</TableHead>
                    <TableHead>{t("notes")}</TableHead>
                    <TableHead>{t("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineDrafts.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <span className="font-semibold text-slate-950">{line.sku || line.itemNumber}</span>
                        <span className="mt-1 block text-xs text-slate-500">{line.description}</span>
                      </TableCell>
                      <TableCell>{line.locationName}</TableCell>
                      <TableCell>{line.availableQty} {line.unitLabel}</TableCell>
                      <TableCell className="min-w-28">
                        <Input
                          type="number"
                          min="1"
                          max={line.availableQty}
                          value={line.quantity}
                          onChange={(event) => onLineChange(line.id, { quantity: event.target.value })}
                          disabled={isSubmitting}
                        />
                      </TableCell>
                      <TableCell className="min-w-44">
                        <Input
                          value={line.lineNote}
                          onChange={(event) => onLineChange(line.id, { lineNote: event.target.value })}
                          disabled={isSubmitting}
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" type="button" onClick={() => onRemoveLine(line.id)} disabled={isSubmitting}>
                          <Trash2 className="h-4 w-4" />
                          {t("remove")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <PortalPanelHeader
              title={t("shippingDetails")}
              description={t("customerPortalShippingDetailsDesc")}
              icon={<Truck className="h-4 w-4" />}
            />
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t("pickingOrderNo")}>
                <Input value={form.pickingOrderNo} onChange={(event) => onFormChange({ pickingOrderNo: event.target.value })} placeholder={t("autoIfBlank")} disabled={isSubmitting} />
              </Field>
              <Field label={t("orderRef")}>
                <Input value={form.orderRef} onChange={(event) => onFormChange({ orderRef: event.target.value })} disabled={isSubmitting} />
              </Field>
              <Field label={t("expectedShipDate")}>
                <Input type="date" value={form.expectedShipDate} onChange={(event) => onFormChange({ expectedShipDate: event.target.value })} disabled={isSubmitting} />
              </Field>
              <Field label={t("shipToName")}>
                <Input value={form.shipToName} onChange={(event) => onFormChange({ shipToName: event.target.value })} disabled={isSubmitting} />
              </Field>
              <Field label={t("shipToAddress")}>
                <Input value={form.shipToAddress} onChange={(event) => onFormChange({ shipToAddress: event.target.value })} disabled={isSubmitting} />
              </Field>
              <Field label={t("shipToContact")}>
                <Input value={form.shipToContact} onChange={(event) => onFormChange({ shipToContact: event.target.value })} disabled={isSubmitting} />
              </Field>
              <Field label={t("carrierName")}>
                <Input value={form.carrierName} onChange={(event) => onFormChange({ carrierName: event.target.value })} disabled={isSubmitting} />
              </Field>
              <Field className="md:col-span-2" label={t("documentNotes")}>
                <Textarea value={form.documentNote} onChange={(event) => onFormChange({ documentNote: event.target.value })} rows={3} disabled={isSubmitting} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <PortalPanelHeader
              title={t("pickingOrderDocuments")}
              description={t("customerPortalAuthDocumentDesc")}
              icon={<ClipboardList className="h-4 w-4" />}
            />
          </CardHeader>
          <CardContent>
            <DocumentAttachmentsPanel
              attachments={[]}
              pendingAttachments={pendingAttachments}
              disabled={isSubmitting}
              showUploadButton={false}
              onPendingAttachmentsChange={onPendingAttachmentsChange}
              onGetDownloadUrl={async () => ""}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="ghost" type="button" onClick={onCancel} disabled={isSubmitting}>
            {t("cancelPickingOrder")}
          </Button>
          <Button type="submit" disabled={isSubmitting || lineDrafts.length === 0}>
            {isSubmitting ? <InlineLoadingIndicator /> : null}
            {t("submitPickingOrder")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  className = "",
  children
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium text-slate-700 ${className}`.trim()}>
      {label}
      {children}
    </label>
  );
}
