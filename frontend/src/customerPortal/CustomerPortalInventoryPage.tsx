import { Plus, Search } from "lucide-react";
import type { KeyboardEvent } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useI18n } from "../lib/i18n";
import { PortalPanelHeader } from "./CustomerPortalTrackingShared";
import type { Item } from "./types";

type CustomerPortalInventoryPageProps = {
  inventory: Item[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onApplySearch: () => void;
  onStartPickingOrder: (item: Item) => void;
};

export function CustomerPortalInventoryPage({
  inventory,
  isLoading,
  search,
  onSearchChange,
  onApplySearch,
  onStartPickingOrder
}: CustomerPortalInventoryPageProps) {
  const { t } = useI18n();
  const visibleInventory = inventory.filter((item) => item.availableQty > 0 || item.quantity > 0);
  const totalAvailable = visibleInventory.reduce((total, item) => total + Math.max(0, item.availableQty), 0);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    onApplySearch();
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
          <div className="flex flex-col gap-2 md:flex-row">
            <label className="sr-only" htmlFor="customer-portal-inventory-search">{t("search")}</label>
            <Input
              id="customer-portal-inventory-search"
              type="search"
              value={search}
              disabled={isLoading}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("customerPortalInventorySearch")}
              className="bg-white"
            />
            <Button type="button" onClick={onApplySearch} disabled={isLoading}>
              <Search className="h-4 w-4" />
              {t("apply")}
            </Button>
          </div>
        </div>

        <Table aria-label={t("customerPortalInventory")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("sku")}</TableHead>
              <TableHead>{t("description")}</TableHead>
              <TableHead>{t("storageName")}</TableHead>
              <TableHead>{t("availableQty")}</TableHead>
              <TableHead>{t("onHand")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleInventory.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <span className="font-semibold text-slate-950">{item.sku || item.itemNumber}</span>
                  {item.itemNumber && item.itemNumber !== item.sku ? <span className="mt-1 block text-xs text-slate-500">{item.itemNumber}</span> : null}
                </TableCell>
                <TableCell className="max-w-sm">{item.description || item.name}</TableCell>
                <TableCell>{item.locationName}</TableCell>
                <TableCell><Badge variant={item.availableQty > 0 ? "success" : "warning"}>{item.availableQty}</Badge></TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => onStartPickingOrder(item)}
                    disabled={item.availableQty <= 0}
                  >
                    <Plus className="h-4 w-4" />
                    {t("startPickingOrder")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {visibleInventory.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-slate-500">
                  {isLoading ? t("loadingRecords") : t("noInventoryAvailable")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
