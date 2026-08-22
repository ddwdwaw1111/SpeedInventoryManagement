import { useEffect, useState } from "react";

import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import { CustomerPortalInventoryPage } from "./CustomerPortalInventoryPage";
import { InlineAlert, useFeedbackToast } from "./sharedUi";
import type { CustomerPortalInventoryItem } from "./types";

type CustomerPortalPageProps = {
  portalCustomerId?: number;
};

export function CustomerPortalPage({ portalCustomerId }: CustomerPortalPageProps) {
  const { t } = useI18n();
  const { showError, feedbackToast } = useFeedbackToast();
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventory, setInventory] = useState<CustomerPortalInventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    void loadInventory("");
  }, [portalCustomerId]);

  async function loadInventory(search = inventorySearch) {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const rows = await customerPortalApi.getInventory(search, portalCustomerId);
      setInventory(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("customerPortalLoadFailed");
      setErrorMessage(message);
      showError(message);
    } finally {
      setIsLoading(false);
    }
  }

  function resetInventorySearch() {
    setInventorySearch("");
    void loadInventory("");
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-4 p-4 lg:p-6">
      <section className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <strong className="block text-sm font-semibold text-emerald-950">{t("customerPortalReadOnly")}</strong>
          <span className="mt-0.5 block text-sm text-emerald-800">{t("customerPortalReadOnlyDesc")}</span>
        </div>
        <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800 shadow-sm">
          {t("customerPortalCurrentInventory")}
        </span>
      </section>

      {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}

      <CustomerPortalInventoryPage
        inventory={inventory}
        isLoading={isLoading}
        search={inventorySearch}
        onSearchChange={setInventorySearch}
        onApplySearch={() => void loadInventory()}
        onResetSearch={resetInventorySearch}
      />

      {feedbackToast}
    </main>
  );
}
