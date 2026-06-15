import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node
} from "@xyflow/react";
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Container,
  GitBranch,
  PackageCheck,
  Route,
  Send
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { customerPortalApi } from "./api";
import { formatContainerStatus } from "./CustomerPortalContainersPage";
import { formatNullableDate, PortalPanelHeader } from "./CustomerPortalTrackingShared";
import { InlineAlert, InlineLoadingIndicator } from "./sharedUi";
import type {
  CustomerPortalContainerLifecycle,
  Movement,
  OutboundDocument,
  PalletLocationEvent
} from "./types";

type CustomerPortalContainerLifecyclePageProps = {
  containerNo: string | null;
  adminPortalCustomerId?: number;
  onBack: () => void;
  onError: (message: string) => void;
};

type LifecycleNode = Node<{ label: ReactNode }>;

type TimelineEntry =
  | { id: string; kind: "movement"; timestamp: number; movement: Movement }
  | { id: string; kind: "pallet-event"; timestamp: number; event: PalletLocationEvent };

export function CustomerPortalContainerLifecyclePage({
  containerNo,
  adminPortalCustomerId,
  onBack,
  onError
}: CustomerPortalContainerLifecyclePageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const [lifecycle, setLifecycle] = useState<CustomerPortalContainerLifecycle | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadLifecycle() {
      if (!containerNo) {
        setLifecycle(null);
        setErrorMessage("");
        return;
      }
      setIsLoading(true);
      setErrorMessage("");
      try {
        const nextLifecycle = await customerPortalApi.getContainerLifecycle(containerNo, adminPortalCustomerId);
        if (!active) return;
        setLifecycle(nextLifecycle);
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : t("customerPortalLoadFailed");
        setErrorMessage(message);
        onError(message);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadLifecycle();
    return () => {
      active = false;
    };
  }, [adminPortalCustomerId, containerNo, onError, t]);

  const flowModel = useMemo(() => lifecycle ? buildLifecycleFlow(lifecycle, t) : { nodes: [], edges: [] }, [lifecycle, t]);
  const timelineEntries = useMemo(() => lifecycle ? buildTimelineEntries(lifecycle) : [], [lifecycle]);
  const outboundMovementCount = lifecycle?.movements.filter((movement) => movement.movementType === "OUT").length ?? 0;
  const transferMovementCount = lifecycle?.summary.transferCount ?? 0;

  if (!containerNo) {
    return (
      <Card>
        <CardContent className="p-6">
          <InlineAlert>{t("containerDetailMissingDesc")}</InlineAlert>
          <Button type="button" variant="outline" onClick={onBack} className="mt-4">
            <ArrowLeft className="h-4 w-4" />
            {t("backToContainers")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <PortalPanelHeader
            title={`${t("customerPortalContainerLifecycle")} ${containerNo}`}
            description={t("customerPortalContainerLifecycleDesc")}
            icon={<Route className="h-4 w-4" />}
            errorMessage={errorMessage}
            actions={(
              <Button type="button" variant="outline" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
                {t("backToContainers")}
              </Button>
            )}
          />
        </CardHeader>
        <CardContent className="grid gap-4">
          {isLoading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
              <span className="inline-flex items-center justify-center gap-2">
                <InlineLoadingIndicator />
                {t("loadingRecords")}
              </span>
            </div>
          ) : lifecycle ? (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <LifecycleMetric label={t("status")} value={formatContainerStatus(lifecycle.summary.status, t)} />
                <LifecycleMetric label={t("received")} value={String(lifecycle.summary.totalReceivedQty)} />
                <LifecycleMetric label={t("customerPortalContainerCurrent")} value={String(lifecycle.summary.currentQty)} />
                <LifecycleMetric label={t("customerPortalOutboundEvents")} value={String(outboundMovementCount)} />
                <LifecycleMetric label={t("customerPortalContainerTransfers")} value={String(transferMovementCount)} />
              </div>

              <div className="min-h-[460px] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                <ReactFlow
                  nodes={flowModel.nodes}
                  edges={flowModel.edges}
                  fitView
                  fitViewOptions={{ padding: 0.18 }}
                  minZoom={0.35}
                  maxZoom={1.35}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                >
                  <Background color="#cbd5e1" gap={20} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </div>
            </>
          ) : (
            <InlineAlert>{t("containerDetailMissingDesc")}</InlineAlert>
          )}
        </CardContent>
      </Card>

      {lifecycle ? (
        <>
          <Card>
            <CardHeader>
              <PortalPanelHeader
                title={t("customerPortalContainerTimeline")}
                description={t("customerPortalContainerTimelineDesc")}
                icon={<GitBranch className="h-4 w-4" />}
                actions={<Badge variant="secondary">{timelineEntries.length} {t("customerPortalLifecycleEvents")}</Badge>}
              />
            </CardHeader>
            <CardContent className="grid gap-3">
              {timelineEntries.length > 0 ? timelineEntries.map((entry) => (
                <TimelineEntryCard key={entry.id} entry={entry} resolvedTimeZone={resolvedTimeZone} t={t} />
              )) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  {t("containerDetailNoHistory")}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <PortalPanelHeader
                title={t("customerPortalLifecycleDocuments")}
                description={t("customerPortalLifecycleDocumentsDesc")}
                icon={<ClipboardList className="h-4 w-4" />}
              />
            </CardHeader>
            <CardContent className="grid gap-5">
              <section className="grid gap-2">
                <h3 className="text-sm font-semibold text-slate-950">{t("customerPortalPackingLists")}</h3>
                <Table aria-label={t("customerPortalPackingLists")}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("containerNo")}</TableHead>
                      <TableHead>{t("status")}</TableHead>
                      <TableHead>{t("expectedQty")}</TableHead>
                      <TableHead>{t("received")}</TableHead>
                      <TableHead>{t("expectedArrivalDate")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lifecycle.packingLists.map((document) => (
                      <TableRow key={document.id}>
                        <TableCell className="font-semibold text-slate-950">{document.containerNo || `#${document.id}`}</TableCell>
                        <TableCell><Badge variant="secondary">{t(document.status.toLowerCase())}</Badge></TableCell>
                        <TableCell>{document.totalExpectedQty}</TableCell>
                        <TableCell>{document.totalReceivedQty}</TableCell>
                        <TableCell>{formatNullableDate(document.expectedArrivalDate)}</TableCell>
                      </TableRow>
                    ))}
                    {lifecycle.packingLists.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-slate-500">{t("noPackingLists")}</TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </section>

              <section className="grid gap-2">
                <h3 className="text-sm font-semibold text-slate-950">{t("customerPortalPickingOrders")}</h3>
                <Table aria-label={t("customerPortalPickingOrders")}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("customerPortalPickingOrders")}</TableHead>
                      <TableHead>{t("orderRef")}</TableHead>
                      <TableHead>{t("status")}</TableHead>
                      <TableHead>{t("quantity")}</TableHead>
                      <TableHead>{t("expectedShipDate")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lifecycle.pickingOrders.map((document) => (
                      <TableRow key={document.id}>
                        <TableCell className="font-semibold text-slate-950">{document.packingListNo || `#${document.id}`}</TableCell>
                        <TableCell>{document.orderRef || "-"}</TableCell>
                        <TableCell><Badge variant="secondary">{t(document.status.toLowerCase())}</Badge></TableCell>
                        <TableCell>{getOutboundContainerQuantity(document, containerNo)}</TableCell>
                        <TableCell>{formatNullableDate(document.expectedShipDate)}</TableCell>
                      </TableRow>
                    ))}
                    {lifecycle.pickingOrders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-slate-500">{t("noPickingOrders")}</TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </section>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function LifecycleMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{value}</div>
    </article>
  );
}

function buildLifecycleFlow(lifecycle: CustomerPortalContainerLifecycle, t: (key: string) => string): { nodes: LifecycleNode[]; edges: Edge[] } {
  const nodes: LifecycleNode[] = [];
  const edges: Edge[] = [];
  const addNode = (
    id: string,
    x: number,
    y: number,
    label: ReactNode,
    variant: "default" | "success" | "warning" | "done" = "default"
  ) => {
    nodes.push({
      id,
      position: { x, y },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { label },
      style: getFlowNodeStyle(variant)
    });
  };
  const addEdge = (source: string, target: string, label?: string) => {
    edges.push({
      id: `${source}-${target}`,
      source,
      target,
      label,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#64748b", strokeWidth: 2 },
      labelStyle: { fill: "#475569", fontSize: 11, fontWeight: 600 }
    });
  };

  const firstPackingList = lifecycle.packingLists[0];
  addNode("packing-list", 0, 110, (
    <FlowNodeContent
      icon={<ClipboardList className="h-4 w-4" />}
      eyebrow={t("customerPortalPackingListSource")}
      title={firstPackingList?.containerNo || lifecycle.summary.containerNo}
      lines={[
        `${lifecycle.summary.packingListCount} ${t("customerPortalPackingLists")}`,
        `${t("expectedQty")} ${lifecycle.summary.totalExpectedQty}`
      ]}
    />
  ));

  addNode("received", 260, 110, (
    <FlowNodeContent
      icon={<PackageCheck className="h-4 w-4" />}
      eyebrow={t("received")}
      title={`${lifecycle.summary.totalReceivedQty}`}
      lines={[formatNullableDate(lifecycle.summary.firstReceivedAt)]}
    />
  ), "success");
  addEdge("packing-list", "received");

  addNode("inventory", 540, 70, (
    <FlowNodeContent
      icon={<Boxes className="h-4 w-4" />}
      eyebrow={t("customerPortalContainerCurrent")}
      title={`${lifecycle.summary.currentQty}`}
      lines={[
        `${t("availableQty")} ${lifecycle.summary.availableQty}`,
        lifecycle.summary.warehouses.join(", ") || "-"
      ]}
    />
  ), lifecycle.summary.currentQty > 0 ? "success" : "default");
  addEdge("received", "inventory");

  let outboundSource = "inventory";
  if (lifecycle.summary.transferCount > 0) {
    addNode("transfers", 540, 230, (
      <FlowNodeContent
        icon={<GitBranch className="h-4 w-4" />}
        eyebrow={t("customerPortalContainerTransfers")}
        title={`${lifecycle.summary.transferCount}`}
        lines={[t("customerPortalTransferLifecycleNode")]}
      />
    ), "warning");
    addEdge("inventory", "transfers", t("customerPortalMoved"));
    outboundSource = "transfers";
  }

  const pickingOrderRefs = lifecycle.pickingOrders.length > 0
    ? lifecycle.pickingOrders.map((document) => document.packingListNo || document.orderRef || `#${document.id}`)
    : lifecycle.summary.pickingOrderRefs;
  const visibleOrderRefs = pickingOrderRefs.length > 0 ? pickingOrderRefs.slice(0, 5) : [t("customerPortalNoPickingOrderNode")];
  visibleOrderRefs.forEach((ref, index) => {
    const nodeID = `picking-${index}`;
    addNode(nodeID, 820, Math.max(20, 80 + index * 120), (
      <FlowNodeContent
        icon={<Send className="h-4 w-4" />}
        eyebrow={t("customerPortalPickingOrders")}
        title={ref}
        lines={index === 0 ? [`${t("customerPortalContainerShippedQty")} ${lifecycle.summary.shippedQty}`] : []}
      />
    ), pickingOrderRefs.length > 0 ? "warning" : "default");
    addEdge(outboundSource, nodeID);
    addEdge(nodeID, "complete");
  });

  addNode("complete", 1100, 110, (
    <FlowNodeContent
      icon={<CheckCircle2 className="h-4 w-4" />}
      eyebrow={t("containerStatus")}
      title={formatContainerStatus(lifecycle.summary.status, t)}
      lines={[`${t("lastActivity")} ${formatNullableDate(lifecycle.summary.lastActivityAt)}`]}
    />
  ), lifecycle.summary.currentQty > 0 ? "success" : "done");

  return { nodes, edges };
}

function FlowNodeContent({
  icon,
  eyebrow,
  title,
  lines
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  lines: string[];
}) {
  return (
    <div className="grid min-w-44 gap-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-700">{icon}</span>
        <span>{eyebrow}</span>
      </div>
      <div className="text-base font-semibold text-slate-950">{title}</div>
      {lines.length > 0 ? (
        <div className="grid gap-0.5 text-xs leading-5 text-slate-500">
          {lines.filter(Boolean).map((line) => <span key={line}>{line}</span>)}
        </div>
      ) : null}
    </div>
  );
}

function getFlowNodeStyle(variant: "default" | "success" | "warning" | "done") {
  const shared = {
    borderRadius: 12,
    padding: 14,
    width: 210,
    border: "1px solid #e2e8f0",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)"
  };
  switch (variant) {
    case "success":
      return { ...shared, background: "#f0fdf4", border: "1px solid #bbf7d0" };
    case "warning":
      return { ...shared, background: "#fffbeb", border: "1px solid #fde68a" };
    case "done":
      return { ...shared, background: "#f8fafc", border: "1px solid #cbd5e1" };
    default:
      return { ...shared, background: "#ffffff" };
  }
}

function buildTimelineEntries(lifecycle: CustomerPortalContainerLifecycle): TimelineEntry[] {
  return [
    ...lifecycle.movements.map((movement) => ({
      id: `movement-${movement.id}`,
      kind: "movement" as const,
      timestamp: getMovementTimestamp(movement),
      movement
    })),
    ...lifecycle.palletEvents.map((event) => ({
      id: `pallet-event-${event.id}`,
      kind: "pallet-event" as const,
      timestamp: getTimestamp(event.eventTime),
      event
    }))
  ].sort((left, right) => right.timestamp - left.timestamp);
}

function TimelineEntryCard({
  entry,
  resolvedTimeZone,
  t
}: {
  entry: TimelineEntry;
  resolvedTimeZone: string;
  t: (key: string) => string;
}) {
  if (entry.kind === "pallet-event") {
    const event = entry.event;
    return (
      <article className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Badge variant="secondary">{formatPalletEventType(event.eventType, t)}</Badge>
            <h3 className="mt-2 text-sm font-semibold text-slate-950">{event.palletCode}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {event.locationName} / {event.storageSection || "-"} · {event.quantityDelta >= 0 ? `+${event.quantityDelta}` : event.quantityDelta} {t("quantity")}
            </p>
          </div>
          <time className="text-xs font-semibold text-slate-500">{formatDateTimeValue(event.eventTime, resolvedTimeZone)}</time>
        </div>
      </article>
    );
  }

  const movement = entry.movement;
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Badge variant={getMovementBadgeVariant(movement.movementType)}>{formatMovementType(movement.movementType, t)}</Badge>
          <h3 className="mt-2 text-sm font-semibold text-slate-950">{movement.itemNumber || movement.sku || movement.description || "-"}</h3>
          <p className="mt-1 text-sm text-slate-500">
            {movement.locationName} / {movement.storageSection || "-"} · {movement.quantityChange >= 0 ? `+${movement.quantityChange}` : movement.quantityChange}
          </p>
          {movement.movementType === "OUT" ? (
            <p className="mt-1 text-xs text-slate-500">
              {t("customerPortalPickingOrders")}: {movement.packingListNo || movement.orderRef || `#${movement.outboundDocumentId || "-"}`}
            </p>
          ) : null}
          {movement.reason || movement.referenceCode ? (
            <p className="mt-1 text-xs text-slate-500">{movement.reason || movement.referenceCode}</p>
          ) : null}
        </div>
        <time className="text-xs font-semibold text-slate-500">{formatDateTimeValue(getMovementDateValue(movement), resolvedTimeZone)}</time>
      </div>
    </article>
  );
}

function getMovementBadgeVariant(movementType: Movement["movementType"]): "success" | "warning" | "destructive" | "secondary" | "info" {
  switch (movementType) {
    case "IN":
      return "success";
    case "OUT":
      return "destructive";
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      return "warning";
    case "COUNT":
      return "info";
    default:
      return "secondary";
  }
}

function formatMovementType(movementType: Movement["movementType"], t: (key: string) => string) {
  switch (movementType) {
    case "IN":
      return t("inbound");
    case "OUT":
      return t("outbound");
    case "TRANSFER_IN":
      return t("transferIn");
    case "TRANSFER_OUT":
      return t("transferOut");
    case "COUNT":
      return t("cycleCount");
    case "REVERSAL":
      return t("reversal");
    default:
      return t("adjustment");
  }
}

function formatPalletEventType(eventType: string, t: (key: string) => string) {
  switch (eventType) {
    case "RECEIVED":
      return t("containerDetailHistoryPalletReceived");
    case "CANCELLED":
      return t("containerDetailHistoryPalletCancelled");
    default:
      return eventType || t("palletTrace");
  }
}

function getMovementDateValue(movement: Movement) {
  if ((movement.movementType === "OUT" || movement.movementType === "REVERSAL") && movement.outDate) {
    return movement.outDate;
  }
  if (movement.movementType === "IN" && movement.deliveryDate) {
    return movement.deliveryDate;
  }
  return movement.createdAt;
}

function getMovementTimestamp(movement: Movement) {
  return getTimestamp(getMovementDateValue(movement));
}

function getTimestamp(value: string | null) {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getOutboundContainerQuantity(document: OutboundDocument, containerNo: string) {
  const normalizedContainerNo = containerNo.trim().toUpperCase();
  return document.lines.reduce((total, line) => (
    total + line.pickAllocations
      .filter((allocation) => allocation.containerNo.trim().toUpperCase() === normalizedContainerNo)
      .reduce((lineTotal, allocation) => lineTotal + allocation.allocatedQty, 0)
  ), 0);
}
