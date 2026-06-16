import { ChevronLeft, ChevronRight, Container, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input, NativeSelect } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { formatContainerStatus, getContainerStatusBadgeVariant } from "../lib/containerLifecycleStatus";
import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { PortalPanelHeader } from "./CustomerPortalTrackingShared";
import { InlineLoadingIndicator } from "./sharedUi";
import type { CustomerPortalContainerSummary } from "./types";

type CustomerPortalContainersPageProps = {
  containers: CustomerPortalContainerSummary[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onApplySearch: () => void;
  onResetSearch: () => void;
  onOpenContainer: (containerNo: string) => void;
};

type ContainerStatusFilter = "all" | "active" | "partial" | "shipped" | "pending";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

export function CustomerPortalContainersPage({
  containers,
  isLoading,
  search,
  onSearchChange,
  onApplySearch,
  onResetSearch,
  onOpenContainer
}: CustomerPortalContainersPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const [statusFilter, setStatusFilter] = useState<ContainerStatusFilter>("all");
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [page, setPage] = useState(1);

  const filteredContainers = useMemo(() => containers.filter((containerSummary) => {
    switch (statusFilter) {
      case "active":
        return containerSummary.currentQty > 0;
      case "partial":
        return containerSummary.status === "PARTIAL";
      case "shipped":
        return containerSummary.status === "SHIPPED";
      case "pending":
        return containerSummary.status === "PENDING";
      default:
        return true;
    }
  }), [containers, statusFilter]);

  const activeCount = containers.filter((containerSummary) => containerSummary.currentQty > 0).length;
  const shippedCount = containers.filter((containerSummary) => containerSummary.status === "SHIPPED").length;
  const pageCount = Math.max(1, Math.ceil(filteredContainers.length / pageSize));
  const activePage = Math.min(page, pageCount);
  const pageStart = filteredContainers.length === 0 ? 0 : (activePage - 1) * pageSize + 1;
  const pageEnd = Math.min(activePage * pageSize, filteredContainers.length);
  const pagedContainers = filteredContainers.slice((activePage - 1) * pageSize, activePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [containers, pageSize, search, statusFilter]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    onApplySearch();
  }

  function handleSearchChange(value: string) {
    onSearchChange(value);
    if (value.trim() === "" && search.trim() !== "") {
      onResetSearch();
    }
  }

  function handleReset() {
    setStatusFilter("all");
    setPage(1);
    onResetSearch();
  }

  return (
    <Card>
      <CardHeader>
        <PortalPanelHeader
          title={t("customerPortalContainers")}
          description={t("customerPortalContainersDesc")}
          icon={<Container className="h-4 w-4" />}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{containers.length} {t("containers")}</Badge>
              <Badge variant="success">{activeCount} {t("customerPortalContainerActive")}</Badge>
              <Badge variant="outline">{shippedCount} {t("customerPortalContainerShipped")}</Badge>
            </div>
          )}
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[minmax(240px,1fr)_220px_auto_auto]">
          <label className="sr-only" htmlFor="customer-portal-container-search">{t("search")}</label>
          <Input
            id="customer-portal-container-search"
            type="search"
            value={search}
            disabled={isLoading}
            onChange={(event) => handleSearchChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("customerPortalContainerSearch")}
            className="bg-white"
          />
          <NativeSelect
            value={statusFilter}
            disabled={isLoading}
            onChange={(event) => setStatusFilter(event.target.value as ContainerStatusFilter)}
            aria-label={t("status")}
          >
            <option value="all">{t("allStatuses")}</option>
            <option value="active">{t("customerPortalContainerActive")}</option>
            <option value="partial">{t("customerPortalContainerPartial")}</option>
            <option value="shipped">{t("customerPortalContainerShipped")}</option>
            <option value="pending">{t("customerPortalContainerPending")}</option>
          </NativeSelect>
          <Button type="button" onClick={onApplySearch} disabled={isLoading} aria-busy={isLoading}>
            {isLoading ? <InlineLoadingIndicator /> : <Search className="h-4 w-4" />}
            {t("search")}
          </Button>
          <Button type="button" variant="outline" onClick={handleReset} disabled={isLoading}>
            <RotateCcw className="h-4 w-4" />
            {t("clear")}
          </Button>
        </div>

        <Table aria-label={t("customerPortalContainers")} aria-busy={isLoading}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("containerNo")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("warehouses")}</TableHead>
              <TableHead>{t("received")}</TableHead>
              <TableHead>{t("customerPortalContainerCurrent")}</TableHead>
              <TableHead>{t("customerPortalContainerShippedQty")}</TableHead>
              <TableHead>{t("customerPortalContainerPickingOrders")}</TableHead>
              <TableHead>{t("customerPortalContainerTransfers")}</TableHead>
              <TableHead>{t("lastActivity")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-slate-500">
                  <span className="inline-flex items-center justify-center gap-2">
                    <InlineLoadingIndicator />
                    {t("loadingRecords")}
                  </span>
                </TableCell>
              </TableRow>
            ) : pagedContainers.map((containerSummary) => (
              <TableRow key={containerSummary.containerNo}>
                <TableCell>
                  <span className="font-semibold text-slate-950">{containerSummary.containerNo}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {containerSummary.packingListCount} {t("customerPortalPackingListSource")}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={getContainerStatusBadgeVariant(containerSummary.status)}>
                    {formatContainerStatus(containerSummary.status, t)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-48">
                  <span className="line-clamp-2 text-sm text-slate-600">
                    {containerSummary.warehouses.length > 0 ? containerSummary.warehouses.join(", ") : "-"}
                  </span>
                </TableCell>
                <TableCell>{containerSummary.totalReceivedQty}</TableCell>
                <TableCell><Badge variant={containerSummary.currentQty > 0 ? "success" : "secondary"}>{containerSummary.currentQty}</Badge></TableCell>
                <TableCell>{containerSummary.shippedQty}</TableCell>
                <TableCell>
                  <div className="grid gap-1">
                    <span>{containerSummary.outboundOrderCount}</span>
                    {containerSummary.pickingOrderRefs.length > 0 ? (
                      <span className="line-clamp-1 text-xs text-slate-500">{containerSummary.pickingOrderRefs.slice(0, 2).join(", ")}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{containerSummary.transferCount}</TableCell>
                <TableCell>{formatDateTimeValue(containerSummary.lastActivityAt, resolvedTimeZone)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => onOpenContainer(containerSummary.containerNo)}
                    aria-label={`${t("customerPortalOpenContainerLifecycle")} ${containerSummary.containerNo}`}
                  >
                    {t("details")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && filteredContainers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-slate-500">
                  {containers.length === 0 ? t("customerPortalNoContainers") : t("customerPortalContainersNoFilteredRows")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {!isLoading && filteredContainers.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-slate-200 pt-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {t("customerPortalInventoryPageSummary", {
                start: pageStart,
                end: pageEnd,
                total: filteredContainers.length
              })}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500" htmlFor="customer-portal-containers-page-size">
                {t("customerPortalInventoryRowsPerPage")}
              </label>
              <NativeSelect
                id="customer-portal-containers-page-size"
                value={String(pageSize)}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="h-9 w-24"
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </NativeSelect>
              <span className="min-w-20 text-center text-xs font-semibold text-slate-500">
                {t("customerPortalInventoryPageStatus", { page: activePage, pages: pageCount })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={activePage <= 1}
                aria-label={t("previousPage")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={activePage >= pageCount}
                aria-label={t("nextPage")}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
