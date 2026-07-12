import { FileText, Search, SendToBack } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input, NativeSelect } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import {
  pickingOrderDocumentStatusOptions,
  formatPickingOrderCompletionStatus,
  formatPickingOrderTrackingStatus,
  formatPickingOrderTrackingStatusFilterLabel,
  getDocumentStatusPillClass,
  getPickingOrderTrackingStatusPillClass,
  getStatusBadgeVariant,
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
  onError: (message: string) => void;
};

export function CustomerPortalPickingOrdersPage({
  pickingOrders,
  isLoading,
  adminPortalCustomerId,
  selectedPickingOrderId,
  onPickingOrdersChange,
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

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void refreshPickingOrders();
  }

  const loading = isLoading || isRefreshing;
  const openCount = pickingOrders.filter((document) => !isCompletedPickingOrder(document)).length;
  const completedCount = pickingOrders.length - openCount;

  return (
    <Card>
      <CardHeader>
        <PortalPanelHeader
          title={t("customerPortalPickingOrders")}
          description={t("customerPortalPickingOrdersDesc")}
          infoTooltip={t("customerPortalOutboundTooltip")}
          icon={<SendToBack className="h-4 w-4" />}
          errorMessage={errorMessage}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Badge variant="warning">{openCount} {t("open")}</Badge>
              <Badge variant="success">{completedCount} {t("completed")}</Badge>
            </div>
          )}
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[minmax(240px,1fr)_180px_220px_auto]">
          <label className="sr-only" htmlFor="customer-portal-outbound-search">{t("search")}</label>
          <Input
            id="customer-portal-outbound-search"
            type="search"
            placeholder={t("customerPortalPickingOrderSearch")}
            value={search}
            disabled={loading}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)} disabled={loading} aria-label={t("status")}>
            {pickingOrderDocumentStatusOptions.map((option) => (
              <option key={option} value={option}>{option === "all" ? t("all") : t(option.toLowerCase())}</option>
            ))}
          </NativeSelect>
          <NativeSelect value={trackingStatus} onChange={(event) => setTrackingStatus(event.target.value)} disabled={loading} aria-label={t("trackingStatus")}>
            {pickingOrderTrackingStatusOptions.map((option) => (
              <option key={option} value={option}>{formatPickingOrderTrackingStatusFilterLabel(option, t)}</option>
            ))}
          </NativeSelect>
          <Button type="button" onClick={() => void refreshPickingOrders()} disabled={loading} aria-busy={loading}>
            {loading ? <InlineLoadingIndicator /> : <Search className="h-4 w-4" />}
            {t("search")}
          </Button>
        </div>

        <Table aria-label={t("customerPortalPickingOrders")} aria-busy={loading}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("packingListNo")}</TableHead>
              <TableHead>{t("orderRef")}</TableHead>
              <TableHead>{t("trackingStatus")}</TableHead>
              <TableHead>{t("customerPortalCompletionStatus")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("totalQty")}</TableHead>
              <TableHead>{t("expectedShipDate")}</TableHead>
              <TableHead>{t("attachments")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-slate-500">
                  <span className="inline-flex items-center justify-center gap-2">
                    <InlineLoadingIndicator />
                    {t("loadingRecords")}
                  </span>
                </TableCell>
              </TableRow>
            ) : pickingOrders.map((document) => {
              const trackingClass = getPickingOrderTrackingStatusPillClass(document);
              const completionClass = isCompletedPickingOrder(document) ? "status-pill--ok" : "status-pill--alert";
              return (
                <TableRow key={document.id} className={selectedPickingOrderId === document.id ? "bg-slate-50" : undefined}>
                  <TableCell>
                    <span className="font-semibold text-slate-950">{document.packingListNo || `#${document.id}`}</span>
                    <span className="mt-1 block text-xs text-slate-500">Customer Picking Order</span>
                  </TableCell>
                  <TableCell>{document.orderRef || "-"}</TableCell>
                  <TableCell><Badge variant={getStatusBadgeVariant(trackingClass)}>{formatPickingOrderTrackingStatus(document.trackingStatus, document.status, t)}</Badge></TableCell>
                  <TableCell><Badge variant={getStatusBadgeVariant(completionClass)}>{formatPickingOrderCompletionStatus(document, t)}</Badge></TableCell>
                  <TableCell><Badge variant={getStatusBadgeVariant(getDocumentStatusPillClass(document.status))}>{t(document.status.toLowerCase())}</Badge></TableCell>
                  <TableCell>{document.totalQty}</TableCell>
                  <TableCell>{document.expectedShipDate || "-"}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-sm text-slate-600">
                      <FileText className="h-4 w-4" />
                      {document.attachments?.length ?? 0}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => onOpenDetail(document.id)}
                      aria-label={`${t("details")} ${document.packingListNo || `#${document.id}`}`}
                    >
                      {t("details")}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!loading && pickingOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-slate-500">
                  {t("noPickingOrders")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
