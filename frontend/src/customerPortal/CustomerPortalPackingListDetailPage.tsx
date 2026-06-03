import { ArrowLeft, Building2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { TabsList, TabsTrigger } from "../components/ui/tabs";
import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import {
  formatNullableDate,
  formatPackingListCompletionStatus,
  formatPackingListTrackingStatus,
  getPackingListPortalWorkflow,
  getPackingListTrackingStatusPillClass,
  getStatusBadgeVariant,
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

  async function getAttachmentDownloadUrl(attachment: DocumentAttachment) {
    const result = await customerPortalApi.getPackingListAttachmentDownloadUrl(attachment.documentId, attachment.id, adminPortalCustomerId);
    return result.url;
  }

  return (
    <Card>
      <CardHeader>
        <PortalPanelHeader
          title={selectedDocument ? `${t("customerPortalPackingListDetail")} ${selectedDocument.containerNo || `#${selectedDocument.id}`}` : t("customerPortalPackingListDetail")}
          description={t("customerPortalPackingListDetailDesc")}
          infoTooltip={t("customerPortalInboundTooltip")}
          icon={<Building2 className="h-4 w-4" />}
          actions={(
            <Button variant="outline" type="button" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
              {t("backToPackingLists")}
            </Button>
          )}
        />
      </CardHeader>

      <CardContent className="grid gap-4">
        {selectedDocument && selectedWorkflow ? (
          <>
            <TabsList aria-label={t("customerPortalPackingListDetail")}>
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
                  <Metric label={t("trackingStatus")} value={<Badge variant={getStatusBadgeVariant(getPackingListTrackingStatusPillClass(selectedDocument))}>{formatPackingListTrackingStatus(selectedDocument.trackingStatus, selectedDocument.status, t)}</Badge>} />
                  <Metric label={t("customerPortalCompletionStatus")} value={<Badge variant={isCompletedPackingList(selectedDocument) ? "success" : "warning"}>{formatPackingListCompletionStatus(selectedDocument, t)}</Badge>} />
                  <Metric label={t("expectedQty")} value={selectedDocument.totalExpectedQty} />
                  <Metric label={t("received")} value={selectedDocument.totalReceivedQty} />
                </div>

                <WorkflowProgress steps={selectedWorkflow.steps} activeIndex={selectedWorkflow.activeIndex} progress={selectedWorkflow.progress} label={t("customerPortalWorkflowProgress")} />

                <div className="grid gap-3 md:grid-cols-3">
                  <InfoBlock label={t("containerNo")} value={selectedDocument.containerNo || "-"} />
                  <InfoBlock label={t("expectedArrivalDate")} value={formatNullableDate(selectedDocument.expectedArrivalDate)} />
                  <InfoBlock label={t("actualArrivalDate")} value={formatNullableDate(selectedDocument.actualArrivalDate)} />
                  <InfoBlock label={t("storageName")} value={selectedDocument.locationName || "-"} />
                  <InfoBlock label={t("currentStorage")} value={selectedDocument.storageSection || "-"} />
                  <InfoBlock label={t("unit")} value={selectedDocument.unitLabel || "-"} />
                  <InfoBlock className="md:col-span-3" label={t("documentNotes")} value={selectedDocument.documentNote || "-"} />
                </div>

                <Table aria-label={t("lineItemsView")}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("sku")}</TableHead>
                      <TableHead>{t("description")}</TableHead>
                      <TableHead>{t("storageName")}</TableHead>
                      <TableHead>{t("expectedQty")}</TableHead>
                      <TableHead>{t("received")}</TableHead>
                      <TableHead>{t("notes")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedDocument.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="font-semibold text-slate-950">{line.sku || "-"}</TableCell>
                        <TableCell>{line.description || "-"}</TableCell>
                        <TableCell>{line.storageSection || "-"}</TableCell>
                        <TableCell>{line.expectedQty} {line.unitLabel || ""}</TableCell>
                        <TableCell>{line.receivedQty} {line.unitLabel || ""}</TableCell>
                        <TableCell>{line.lineNote || "-"}</TableCell>
                      </TableRow>
                    ))}
                    {selectedDocument.lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center text-slate-500">{t("customerPortalNoPackingListLineItems")}</TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <DocumentAttachmentsPanel
                attachments={selectedDocument.attachments ?? []}
                onGetDownloadUrl={getAttachmentDownloadUrl}
              />
            )}
          </>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">{t("customerPortalSelectPackingList")}</div>
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
      <div className="mt-4 grid gap-2 md:grid-cols-3">
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
