import { ArrowLeft, SendToBack } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { TabsList, TabsTrigger } from "../components/ui/tabs";
import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import {
  formatNullableDate,
  formatPickingOrderCompletionStatus,
  formatPickingOrderTrackingStatus,
  getPickingOrderPortalWorkflow,
  getPickingOrderTrackingStatusPillClass,
  getStatusBadgeVariant,
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
    <Card>
      <CardHeader>
        <PortalPanelHeader
          title={selectedDocument ? `${t("customerPortalPickingOrderDetail")} ${selectedDocument.packingListNo || `#${selectedDocument.id}`}` : t("customerPortalPickingOrderDetail")}
          description={t("customerPortalPickingOrderDetailDesc")}
          infoTooltip={t("customerPortalOutboundTooltip")}
          icon={<SendToBack className="h-4 w-4" />}
          actions={(
            <Button variant="outline" type="button" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
              {t("backToPickingOrders")}
            </Button>
          )}
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        {selectedDocument && selectedWorkflow ? (
          <>
            <TabsList aria-label={t("customerPortalPickingOrderDetail")}>
              {([
                ["details", t("details")],
                ["documents", `${t("attachments")}${selectedAttachmentCount > 0 ? ` (${selectedAttachmentCount})` : ""}`]
              ] as const).map(([tabKey, label]) => (
                <TabsTrigger
                  key={tabKey}
                  active={activeDetailTab === tabKey}
                  onClick={() => setActiveDetailTab(tabKey)}
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            {activeDetailTab === "details" ? (
              <div className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <Metric label={t("trackingStatus")} value={<Badge variant={getStatusBadgeVariant(getPickingOrderTrackingStatusPillClass(selectedDocument))}>{formatPickingOrderTrackingStatus(selectedDocument.trackingStatus, selectedDocument.status, t)}</Badge>} />
                  <Metric label={t("customerPortalCompletionStatus")} value={<Badge variant={isCompletedPickingOrder(selectedDocument) ? "success" : "warning"}>{formatPickingOrderCompletionStatus(selectedDocument, t)}</Badge>} />
                  <Metric label={t("totalQty")} value={selectedDocument.totalQty} />
                  <Metric label={t("totalLines")} value={selectedDocument.totalLines} />
                </div>

                <WorkflowProgress steps={selectedWorkflow.steps} activeIndex={selectedWorkflow.activeIndex} progress={selectedWorkflow.progress} label={t("customerPortalWorkflowProgress")} />

                <div className="grid gap-3 md:grid-cols-3">
                  <InfoBlock label={t("orderRef")} value={selectedDocument.orderRef || "-"} />
                  <InfoBlock label={t("expectedShipDate")} value={formatNullableDate(selectedDocument.expectedShipDate)} />
                  <InfoBlock label={t("actualShipDate")} value={formatNullableDate(selectedDocument.actualShipDate)} />
                  <InfoBlock label={t("carrierName")} value={selectedDocument.carrierName || "-"} />
                  <InfoBlock label={t("shipToName")} value={selectedDocument.shipToName || "-"} />
                  <InfoBlock label={t("shipToContact")} value={selectedDocument.shipToContact || "-"} />
                  <InfoBlock className="md:col-span-3" label={t("shipToAddress")} value={selectedDocument.shipToAddress || "-"} />
                  <InfoBlock className="md:col-span-3" label={t("documentNotes")} value={selectedDocument.documentNote || "-"} />
                </div>

                <Table aria-label={t("lineItemsView")}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("itemNumber")}</TableHead>
                      <TableHead>{t("sku")}</TableHead>
                      <TableHead>{t("description")}</TableHead>
                      <TableHead>{t("storageName")}</TableHead>
                      <TableHead>{t("quantity")}</TableHead>
                      <TableHead>{t("notes")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedDocument.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>{line.itemNumber || "-"}</TableCell>
                        <TableCell className="font-semibold text-slate-950">{line.sku || "-"}</TableCell>
                        <TableCell>{line.description || "-"}</TableCell>
                        <TableCell>{[line.locationName, line.storageSection].filter(Boolean).join(" / ") || "-"}</TableCell>
                        <TableCell>{line.quantity} {line.unitLabel || ""}</TableCell>
                        <TableCell>{line.lineNote || "-"}</TableCell>
                      </TableRow>
                    ))}
                    {selectedDocument.lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center text-slate-500">{t("customerPortalNoPickingOrderLineItems")}</TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
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
          </>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">{t("customerPortalSelectPickingOrder")}</div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-2 text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function InfoBlock({ label, value, className = "" }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`.trim()}>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-2 text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

function WorkflowProgress({ steps, activeIndex, progress, label }: { steps: string[]; activeIndex: number; progress: number; label: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4" aria-label={label}>
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm font-semibold text-slate-950">{label}</strong>
        <span className="text-sm font-semibold text-slate-600">{progress}%</span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-5">
        {steps.map((step, index) => {
          const active = index <= activeIndex;
          return (
            <div key={step} className={`rounded-md border p-3 text-center ${active ? "border-slate-900 bg-white text-slate-950" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
              <span className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${active ? "bg-slate-950 text-white" : "bg-white text-slate-500"}`}>{index + 1}</span>
              <strong className="mt-2 block text-xs">{step}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}
