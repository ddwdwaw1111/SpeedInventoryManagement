import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";

import { useI18n } from "../lib/i18n";
import { SearchSubmitField } from "../shared/SearchSubmitField";
import { SheetTable, SheetTableCell, type SheetTableColumn } from "../shared/SheetTable";
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
  const inventoryColumns: SheetTableColumn[] = [
    { key: "sku", header: t("sku") },
    { key: "description", header: t("description") },
    { key: "storageName", header: t("storageName") },
    { key: "availableQty", header: t("availableQty") },
    { key: "onHand", header: t("onHand") },
    { key: "actions", header: t("actions") }
  ];

  return (
    <section className="customer-portal-panel customer-portal-panel--inventory">
      <div className="tab-strip">
        <PortalPanelHeader
          title={t("customerPortalInventory")}
          description={t("customerPortalInventoryDesc")}
          icon={<Inventory2OutlinedIcon fontSize="small" />}
        />
        <div className="filter-bar">
          <SearchSubmitField
            label={t("search")}
            placeholder={t("customerPortalInventorySearch")}
            value={search}
            disabled={isLoading}
            submitTitle={t("apply")}
            onChange={onSearchChange}
            onSubmit={onApplySearch}
          />
        </div>
      </div>

      <SheetTable
        columns={inventoryColumns}
        emptyState={visibleInventory.length === 0 ? <div className="empty-state">{isLoading ? t("loadingRecords") : t("noInventoryAvailable")}</div> : null}
      >
        {visibleInventory.map((item) => (
          <tr key={item.id}>
            <SheetTableCell label={t("sku")}>{item.sku || item.itemNumber}</SheetTableCell>
            <SheetTableCell label={t("description")}>{item.description || item.name}</SheetTableCell>
            <SheetTableCell label={t("storageName")}>{item.locationName}</SheetTableCell>
            <SheetTableCell label={t("availableQty")}>{item.availableQty}</SheetTableCell>
            <SheetTableCell label={t("onHand")}>{item.quantity}</SheetTableCell>
            <SheetTableCell label={t("actions")}>
              <button
                className="button button--ghost button--small"
                type="button"
                onClick={() => onStartPickingOrder(item)}
                disabled={item.availableQty <= 0}
              >
                <AddCircleOutlineOutlinedIcon fontSize="small" />
                {t("startPickingOrder")}
              </button>
            </SheetTableCell>
          </tr>
        ))}
      </SheetTable>
    </section>
  );
}
