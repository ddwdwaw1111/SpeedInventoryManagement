import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import OutboxOutlinedIcon from "@mui/icons-material/OutboxOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { Chip } from "@mui/material";
import { type ReactNode, useMemo, useState } from "react";

import { setPendingAllActivityContext } from "../lib/allActivityContext";
import {
  buildAllContainerContentsRows,
  buildContainerSkuCards,
  formatContainerTimelineValue,
  normalizeContainerNumber
} from "../lib/containerInventory";
import { formatDateTimeValue } from "../lib/dates";
import { setPendingInventoryActionContext } from "../lib/inventoryActionContext";
import { buildInventoryActionSourceKey } from "../lib/inventoryActionSources";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { PageKey } from "../lib/routes";
import type { Item, Location, Movement, UserRole } from "../lib/types";
import { ContainerAdjustmentDialog } from "./ContainerAdjustmentDialog";
import { ContainerTransferDialog } from "./ContainerTransferDialog";
import { WorkspacePanelHeader } from "./WorkspacePanelChrome";

type ContainerDetailPageProps = {
  routeKey: string;
  customerId: number | null;
  containerNo: string | null;
  items: Item[];
  movements: Movement[];
  locations: Location[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageKey) => void;
  onOpenContainerLifecycle?: (customerId: number | null, containerNo: string) => void;
  onBackToList: () => void;
};

export function ContainerDetailPage({
  customerId,
  containerNo,
  items,
  movements,
  locations,
  currentUserRole,
  isLoading,
  onRefresh,
  onNavigate,
  onOpenContainerLifecycle,
  onBackToList
}: ContainerDetailPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const normalizedContainerNo = normalizeContainerNumber(containerNo);
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const [isQuickAdjustmentOpen, setIsQuickAdjustmentOpen] = useState(false);
  const [isQuickTransferOpen, setIsQuickTransferOpen] = useState(false);
  const containers = useMemo(() => buildAllContainerContentsRows(items, movements, locations), [items, locations, movements]);
  const container = useMemo(
    () => {
      const matches = containers.filter((candidate) => candidate.containerNo === normalizedContainerNo);
      if (customerId && customerId > 0) {
        return matches.find((candidate) => candidate.customerId === customerId) ?? null;
      }
      return matches.length === 1 ? matches[0] : null;
    },
    [containers, customerId, normalizedContainerNo]
  );
  const skuCards = useMemo(() => buildContainerSkuCards(container?.items ?? []), [container?.items]);
  const history = useMemo(
    () => container
      ? movements
          .filter((movement) => movement.customerId === container.customerId && normalizeContainerNumber(movement.containerNo) === normalizedContainerNo)
          .sort((left, right) => movementTime(right) - movementTime(left))
      : [],
    [container, movements, normalizedContainerNo]
  );
  const customerID = container?.customerId;
  const sourceKey = container?.items[0]
    ? buildInventoryActionSourceKey(container.items[0].customerId, container.items[0].sku)
    : undefined;

  function openOperation(page: "cycle-counts") {
    setPendingInventoryActionContext(page, {
      sourceKey,
      containerNo: normalizedContainerNo
    });
    onNavigate(page);
  }

  function openActivity() {
    setPendingAllActivityContext({
      searchTerm: normalizedContainerNo,
      customerId: customerID,
      locationId: container?.locationIds.length === 1 ? container.locationIds[0] : undefined
    });
    onNavigate("all-activity");
  }

  return (
    <main className="workspace-main">
      <div className="space-y-4 pb-4">
        <section className="rounded-[24px] bg-[radial-gradient(ellipse_at_top_right,rgba(96,165,250,0.12),transparent_55%),linear-gradient(135deg,#09193a_0%,#0f2d63_55%,#173a7a_100%)] px-5 py-5 shadow-[0_20px_60px_rgba(8,20,50,0.28)]">
          <WorkspacePanelHeader
            title={normalizedContainerNo || t("containerDetail")}
            notices={[container ? container.customerSummary : ""]}
            actions={(
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onBackToList} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25">{t("back")}</button>
                <button type="button" onClick={openActivity} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25"><HistoryOutlinedIcon sx={{ fontSize: 15 }} /> {t("allActivity")}</button>
                {onOpenContainerLifecycle ? <button type="button" onClick={() => onOpenContainerLifecycle(customerID ?? null, normalizedContainerNo)} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25">{t("containerLifecycle")}</button> : null}
              </div>
            )}
          />

          {container ? (
            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <OverviewCard icon={<FactCheckOutlinedIcon sx={{ fontSize: 16 }} />} label={t("skuCount")} value={skuCards.length} meta={t("containerItems")} />
              <OverviewCard icon={<MoveToInboxOutlinedIcon sx={{ fontSize: 16 }} />} label={t("onHand")} value={container.onHand} meta={`${t("availableQty")}: ${container.availableQty}`} />
              <OverviewCard icon={<WarehouseOutlinedIcon sx={{ fontSize: 16 }} />} label={t("pallets")} value={container.palletCount} meta={t("billing")}/>
              <OverviewCard icon={<TuneOutlinedIcon sx={{ fontSize: 16 }} />} label={t("currentInventoryRows")} value={container.rowCount} meta={container.warehouseSummary || "-"} />
            </div>
          ) : (
            <div className="mt-4 rounded-xl bg-white/10 px-4 py-4 text-sm text-white/70 ring-1 ring-white/15">
              {isLoading ? t("loadingRecords") : t("containerDetailMissingDesc")}
            </div>
          )}

          {canManage && container?.rowCount ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <ActionButton icon={<TuneOutlinedIcon sx={{ fontSize: 15 }} />} label={t("quickAdjustment")} onClick={() => setIsQuickAdjustmentOpen(true)} />
              <ActionButton icon={<OutboxOutlinedIcon sx={{ fontSize: 15 }} />} label={t("quickTransfer")} onClick={() => setIsQuickTransferOpen(true)} />
              <ActionButton icon={<FactCheckOutlinedIcon sx={{ fontSize: 15 }} />} label={t("addCycleCount")} onClick={() => openOperation("cycle-counts")} />
            </div>
          ) : null}
        </section>

        <section className="workbook-panel workbook-panel--full" id="section-sku">
          <div className="tab-strip"><WorkspacePanelHeader title={t("containerItems")} notices={[container ? `${container.warehouseSummary} · ${normalizedContainerNo}` : ""]} /></div>
          <div className="grid gap-3 p-4 lg:grid-cols-2 xl:grid-cols-3">
            {container?.items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div><div className="font-mono text-sm font-bold text-[#12356c]">{item.itemNumber || item.sku}</div><h3 className="mt-1 text-base font-bold text-slate-900">{item.description || item.name}</h3></div>
                  <Chip size="small" label={`${item.pallets} ${t("pallets")}`} color="primary" variant="outlined" />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <Metric label={t("onHand")} value={item.quantity} />
                  <Metric label={t("availableQty")} value={item.availableQty} />
                  <Metric label={t("allocatedQty")} value={item.allocatedQty} />
                </div>
                <div className="mt-3 text-xs font-semibold text-slate-500">{item.locationName} / {item.storageSection}</div>
              </article>
            ))}
            {container && container.items.length === 0 ? <div className="sheet-note sheet-note--readonly">{t("noResults")}</div> : null}
          </div>
        </section>

        <section className="workbook-panel workbook-panel--full" id="section-history">
          <div className="tab-strip"><WorkspacePanelHeader title={t("containerNavHistory")} notices={[`${history.length} ${t("allRows")}`]} /></div>
          <div className="divide-y divide-slate-100">
            {history.map((movement) => (
              <article key={movement.id} className="grid gap-2 px-4 py-3 md:grid-cols-[150px_1fr_auto] md:items-center">
                <div><Chip size="small" label={movement.movementType} color={movement.quantityChange < 0 ? "warning" : "success"} variant="outlined" /></div>
                <div><div className="font-semibold text-slate-900">{movement.itemNumber || movement.sku} · {movement.description}</div><div className="mt-1 text-xs text-slate-500">{movement.locationName} / {movement.storageSection} · {movement.referenceCode || movement.packingListNo || movement.orderRef || "-"}</div></div>
                <div className="text-right"><div className="font-mono font-bold text-slate-900">{signed(movement.quantityChange)} Qty</div><div className="text-xs text-slate-500">{movement.pallets} {t("pallets")} · {formatDateTimeValue(movement.createdAt, resolvedTimeZone)}</div></div>
              </article>
            ))}
            {history.length === 0 ? <div className="p-4"><div className="sheet-note sheet-note--readonly">{t("containerDetailNoHistory")}</div></div> : null}
          </div>
          {container ? <div className="grid gap-2 border-t border-slate-100 p-4 text-xs text-slate-500 md:grid-cols-2"><span>{t("containerReceivedAt")}: {formatContainerTimelineValue(container.receivedAt, resolvedTimeZone)}</span><span>{t("containerShippedAt")}: {formatContainerTimelineValue(container.shippedAt, resolvedTimeZone, t("containerNotShipped"))}</span></div> : null}
        </section>
      </div>

      <ContainerAdjustmentDialog
        open={isQuickAdjustmentOpen}
        items={items}
        preferredContainerNo={normalizedContainerNo}
        containerFilter={normalizedContainerNo}
        customerIdFilter={customerID}
        quickMode
        onClose={() => setIsQuickAdjustmentOpen(false)}
        onSaved={onRefresh}
      />

      <ContainerTransferDialog
        open={isQuickTransferOpen}
        items={items}
        locations={locations}
        preferredContainerNo={normalizedContainerNo}
        containerFilter={normalizedContainerNo}
        customerIdFilter={customerID}
        quickMode
        onClose={() => setIsQuickTransferOpen(false)}
        onSaved={onRefresh}
      />
    </main>
  );
}

function OverviewCard({ icon, label, value, meta }: { icon: ReactNode; label: string; value: number; meta: string }) {
  return <article className="rounded-[14px] bg-white/10 p-3 text-white ring-1 ring-white/15"><div className="flex items-center gap-2 text-xs font-semibold text-white/70">{icon}{label}</div><strong className="mt-2 block text-2xl font-extrabold">{value}</strong><span className="mt-1 block text-xs text-white/60">{meta}</span></article>;
}

function ActionButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/25">{icon}{label}</button>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-lg font-extrabold text-slate-900">{value}</div></div>;
}

function movementTime(movement: Movement) {
  return new Date(movement.createdAt).getTime();
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value}`;
}
