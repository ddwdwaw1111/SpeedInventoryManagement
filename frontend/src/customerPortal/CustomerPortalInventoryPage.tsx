import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";

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

  return (
    <section className="customer-portal-panel customer-portal-panel--inventory">
      <div className="tab-strip">
        <PortalPanelHeader
          title={t("customerPortalInventory")}
          description={t("customerPortalInventoryDesc")}
          icon={<Inventory2OutlinedIcon fontSize="small" />}
        />
        <div className="filter-bar">
          <label>
            {t("search")}
            <span className="customer-portal-search-field">
              <SearchOutlinedIcon fontSize="small" />
              <input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={t("customerPortalInventorySearch")}
              />
            </span>
          </label>
          <button className="button button--ghost" type="button" onClick={onApplySearch} disabled={isLoading}>
            {isLoading ? <InlineLoadingIndicator /> : null}
            {t("apply")}
          </button>
        </div>
      </div>

      <div className="sheet-table-wrap">
        <table className="sheet-table">
          <thead>
            <tr>
              <th>{t("sku")}</th>
              <th>{t("description")}</th>
              <th>{t("storageName")}</th>
              <th>{t("availableQty")}</th>
              <th>{t("onHand")}</th>
              <th>{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleInventory.map((item) => (
              <tr key={item.id}>
                <td data-label={t("sku")}>{item.sku || item.itemNumber}</td>
                <td data-label={t("description")}>{item.description || item.name}</td>
                <td data-label={t("storageName")}>{item.locationName}</td>
                <td data-label={t("availableQty")}>{item.availableQty}</td>
                <td data-label={t("onHand")}>{item.quantity}</td>
                <td data-label={t("actions")}>
                  <button
                    className="button button--ghost button--small"
                    type="button"
                    onClick={() => onStartPickingOrder(item)}
                    disabled={item.availableQty <= 0}
                  >
                    <AddCircleOutlineOutlinedIcon fontSize="small" />
                    {t("startPickingOrder")}
                  </button>
                </td>
              </tr>
            ))}
            {visibleInventory.length === 0 ? (
              <tr><td colSpan={6}><div className="empty-state">{isLoading ? t("loadingRecords") : t("noInventoryAvailable")}</div></td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
