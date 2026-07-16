import { ChevronLeft, ChevronRight, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input, NativeSelect } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useI18n } from "../lib/i18n";
import { PortalPanelHeader } from "./CustomerPortalTrackingShared";
import { InlineLoadingIndicator } from "./sharedUi";
import type { Item } from "./types";

type CustomerPortalInventoryPageProps = {
  inventory: Item[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onApplySearch: () => void;
  onResetSearch: () => void;
};

type InventoryAvailabilityFilter = "all" | "available" | "on-hand" | "not-available";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

export function CustomerPortalInventoryPage({
  inventory,
  isLoading,
  search,
  onSearchChange,
  onApplySearch,
  onResetSearch
}: CustomerPortalInventoryPageProps) {
  const { t } = useI18n();
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<InventoryAvailabilityFilter>("all");
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [page, setPage] = useState(1);
  const visibleInventory = useMemo(
    () => inventory.filter((item) => item.availableQty > 0 || item.quantity > 0 || item.availablePallets > 0 || item.pallets > 0),
    [inventory]
  );
  const warehouseOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const item of visibleInventory) {
      const key = String(item.locationId);
      if (!options.has(key)) {
        options.set(key, item.locationName || "-");
      }
    }
    return [...options.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [visibleInventory]);
  const filteredInventory = useMemo(() => visibleInventory.filter((item) => {
    if (warehouseFilter !== "all" && String(item.locationId) !== warehouseFilter) {
      return false;
    }
    switch (availabilityFilter) {
      case "available":
        return item.availableQty > 0 || item.availablePallets > 0;
      case "on-hand":
        return item.quantity > 0 || item.pallets > 0;
      case "not-available":
        return (item.quantity > 0 || item.pallets > 0) && item.availableQty <= 0 && item.availablePallets <= 0;
      default:
        return true;
    }
  }), [availabilityFilter, visibleInventory, warehouseFilter]);
  const totalAvailable = filteredInventory.reduce((total, item) => total + Math.max(0, item.availableQty), 0);
  const pageCount = Math.max(1, Math.ceil(filteredInventory.length / pageSize));
  const activePage = Math.min(page, pageCount);
  const pageStart = filteredInventory.length === 0 ? 0 : (activePage - 1) * pageSize + 1;
  const pageEnd = Math.min(activePage * pageSize, filteredInventory.length);
  const pagedInventory = filteredInventory.slice((activePage - 1) * pageSize, activePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [availabilityFilter, inventory, pageSize, search, warehouseFilter]);

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
    setWarehouseFilter("all");
    setAvailabilityFilter("all");
    setPage(1);
    onResetSearch();
  }

  return (
    <Card>
      <CardHeader>
        <PortalPanelHeader
          title={t("customerPortalInventory")}
          description={t("customerPortalInventoryDesc")}
          icon={<Search className="h-4 w-4" />}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{visibleInventory.length} {t("customerPortalAvailableLocations")}</Badge>
              <Badge variant="success">{totalAvailable} {t("availableQty")}</Badge>
            </div>
          )}
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_180px_180px_auto_auto]">
            <label className="sr-only" htmlFor="customer-portal-inventory-search">{t("search")}</label>
            <Input
              id="customer-portal-inventory-search"
              type="search"
              value={search}
              disabled={isLoading}
              onChange={(event) => handleSearchChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("customerPortalInventorySearch")}
              className="bg-white"
            />
            <NativeSelect
              value={warehouseFilter}
              disabled={isLoading}
              onChange={(event) => setWarehouseFilter(event.target.value)}
              aria-label={t("customerPortalInventoryWarehouseFilter")}
            >
              <option value="all">{t("customerPortalInventoryAllWarehouses")}</option>
              {warehouseOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={availabilityFilter}
              disabled={isLoading}
              onChange={(event) => setAvailabilityFilter(event.target.value as InventoryAvailabilityFilter)}
              aria-label={t("customerPortalInventoryAvailabilityFilter")}
            >
              <option value="all">{t("customerPortalInventoryAllStock")}</option>
              <option value="available">{t("customerPortalInventoryAvailableOnly")}</option>
              <option value="on-hand">{t("customerPortalInventoryOnHandOnly")}</option>
              <option value="not-available">{t("customerPortalInventoryNotAvailable")}</option>
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
        </div>

        <Table aria-label={t("customerPortalInventory")} aria-busy={isLoading}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("sku")}</TableHead>
              <TableHead>{t("description")}</TableHead>
              <TableHead>{t("storageName")}</TableHead>
              <TableHead>{t("availableQty")}</TableHead>
              <TableHead>{t("onHand")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-slate-500">
                  <span className="inline-flex items-center justify-center gap-2">
                    <InlineLoadingIndicator />
                    {t("loadingRecords")}
                  </span>
                </TableCell>
              </TableRow>
            ) : pagedInventory.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <span className="font-semibold text-slate-950">{item.sku || item.itemNumber}</span>
                  {item.itemNumber && item.itemNumber !== item.sku ? <span className="mt-1 block text-xs text-slate-500">{item.itemNumber}</span> : null}
                </TableCell>
                <TableCell className="max-w-sm">{item.description || item.name}</TableCell>
                <TableCell>{item.locationName}</TableCell>
                <TableCell><Badge variant={item.availableQty > 0 ? "success" : "warning"}>{item.availableQty}</Badge></TableCell>
                <TableCell>{item.quantity}</TableCell>
              </TableRow>
            ))}
            {!isLoading && filteredInventory.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-slate-500">
                  {visibleInventory.length === 0 ? t("noInventoryAvailable") : t("customerPortalInventoryNoFilteredRows")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {!isLoading && filteredInventory.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-slate-200 pt-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {t("customerPortalInventoryPageSummary", {
                start: pageStart,
                end: pageEnd,
                total: filteredInventory.length
              })}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500" htmlFor="customer-portal-inventory-page-size">
                {t("customerPortalInventoryRowsPerPage")}
              </label>
              <NativeSelect
                id="customer-portal-inventory-page-size"
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
