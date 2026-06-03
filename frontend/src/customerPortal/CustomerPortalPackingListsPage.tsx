import { Building2, FileText, Search } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input, NativeSelect } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import {
  documentStatusOptions,
  formatPackingListCompletionStatus,
  formatPackingListTrackingStatus,
  formatPackingListTrackingStatusFilterLabel,
  getDocumentStatusPillClass,
  getPackingListTrackingStatusPillClass,
  getStatusBadgeVariant,
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

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void refreshPackingLists();
  }

  const loading = isLoading || isRefreshing;
  const openCount = packingLists.filter((document) => !isCompletedPackingList(document)).length;
  const receivedCount = packingLists.length - openCount;

  return (
    <Card>
      <CardHeader>
        <PortalPanelHeader
          title={t("customerPortalPackingLists")}
          description={t("customerPortalPackingListsDesc")}
          infoTooltip={t("customerPortalInboundTooltip")}
          icon={<Building2 className="h-4 w-4" />}
          errorMessage={errorMessage}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Badge variant="warning">{openCount} {t("open")}</Badge>
              <Badge variant="success">{receivedCount} {t("received")}</Badge>
            </div>
          )}
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[minmax(240px,1fr)_180px_220px_auto]">
          <label className="sr-only" htmlFor="customer-portal-inbound-search">{t("search")}</label>
          <Input
            id="customer-portal-inbound-search"
            type="search"
            placeholder={t("customerPortalPackingListSearch")}
            value={search}
            disabled={loading}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)} disabled={loading} aria-label={t("status")}>
            {documentStatusOptions.map((option) => (
              <option key={option} value={option}>{option === "all" ? t("all") : t(option.toLowerCase())}</option>
            ))}
          </NativeSelect>
          <NativeSelect value={trackingStatus} onChange={(event) => setTrackingStatus(event.target.value)} disabled={loading} aria-label={t("trackingStatus")}>
            {packingListTrackingStatusOptions.map((option) => (
              <option key={option} value={option}>{formatPackingListTrackingStatusFilterLabel(option, t)}</option>
            ))}
          </NativeSelect>
          <Button type="button" onClick={() => void refreshPackingLists()} disabled={loading}>
            {loading ? <InlineLoadingIndicator /> : <Search className="h-4 w-4" />}
            {t("apply")}
          </Button>
        </div>

        <Table aria-label={t("customerPortalPackingLists")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("containerNo")}</TableHead>
              <TableHead>{t("trackingStatus")}</TableHead>
              <TableHead>{t("customerPortalCompletionStatus")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("expectedQty")}</TableHead>
              <TableHead>{t("received")}</TableHead>
              <TableHead>{t("expectedArrivalDate")}</TableHead>
              <TableHead>{t("attachments")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packingLists.map((document) => {
              const trackingClass = getPackingListTrackingStatusPillClass(document);
              const completionClass = isCompletedPackingList(document) ? "status-pill--ok" : "status-pill--alert";
              return (
                <TableRow key={document.id} className={selectedPackingListId === document.id ? "bg-slate-50" : undefined}>
                  <TableCell>
                    <span className="font-semibold text-slate-950">{document.containerNo || `#${document.id}`}</span>
                    <span className="mt-1 block text-xs text-slate-500">Customer Packing List</span>
                  </TableCell>
                  <TableCell><Badge variant={getStatusBadgeVariant(trackingClass)}>{formatPackingListTrackingStatus(document.trackingStatus, document.status, t)}</Badge></TableCell>
                  <TableCell><Badge variant={getStatusBadgeVariant(completionClass)}>{formatPackingListCompletionStatus(document, t)}</Badge></TableCell>
                  <TableCell><Badge variant={getStatusBadgeVariant(getDocumentStatusPillClass(document.status))}>{t(document.status.toLowerCase())}</Badge></TableCell>
                  <TableCell>{document.totalExpectedQty}</TableCell>
                  <TableCell>{document.totalReceivedQty}</TableCell>
                  <TableCell>{document.expectedArrivalDate || "-"}</TableCell>
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
                      aria-label={`${t("details")} ${document.containerNo || `#${document.id}`}`}
                    >
                      {t("details")}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {packingLists.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-slate-500">
                  {loading ? t("loadingRecords") : t("noPackingLists")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
