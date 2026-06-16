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
  Container as ContainerIcon,
  GitBranch,
  MapPinned,
  PackageCheck,
  Route,
  Send,
  Truck,
  Wrench
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type {
  ContainerLifecycle,
  CustomerPortalContainerLifecycle,
  InboundDocument,
  LifecycleDisplayFields,
  Movement,
  OutboundDocument,
  PalletLocationEvent
} from "../lib/types";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type ContainerLifecycleNodeKind =
  | "container"
  | "tracking"
  | "pickup"
  | "documents"
  | "packing-list"
  | "receiving"
  | "inventory"
  | "transfer"
  | "rework"
  | "picking-order"
  | "delivery"
  | "complete";

export type ContainerLifecycleNodeAction = {
  id: string;
  kind: ContainerLifecycleNodeKind;
  title: string;
  documentId?: number;
  outboundDocumentId?: number;
  deliveryEventId?: number;
  palletIds?: number[];
};

export type LifecycleVisibilityMode = "customer" | "admin";

type ContainerLifecycleViewProps = {
  containerNo: string | null;
  lifecycle: CustomerPortalContainerLifecycle | ContainerLifecycle | null;
  visibilityMode?: LifecycleVisibilityMode;
  isLoading?: boolean;
  errorMessage?: string;
  title?: string;
  description?: string;
  backLabel?: string;
  onBack?: () => void;
  actions?: ReactNode;
  sidePanel?: ReactNode;
  selectedNodeId?: string | null;
  onNodeSelect?: (action: ContainerLifecycleNodeAction) => void;
  documentActions?: {
    onOpenPackingList?: (document: InboundDocument) => void;
    onEditPackingList?: (document: InboundDocument) => void;
    onOpenPickingOrder?: (document: OutboundDocument) => void;
    onEditPickingOrder?: (document: OutboundDocument) => void;
  };
};

type LifecycleNodeData = {
  label: ReactNode;
  action: ContainerLifecycleNodeAction;
};

type LifecycleNode = Node<LifecycleNodeData>;

type LifecycleFlowStep = {
  id: string;
  action: ContainerLifecycleNodeAction;
  label: ReactNode;
  variant?: "default" | "success" | "warning" | "done";
};

type TimelineEntry =
  | { id: string; kind: "movement"; timestamp: number; movement: Movement }
  | { id: string; kind: "pallet-event"; timestamp: number; event: PalletLocationEvent }
  | { id: string; kind: "tracking-event"; timestamp: number; event: NonNullable<CustomerPortalContainerLifecycle["trackingEvents"]>[number] }
  | { id: string; kind: "pickup-assignment"; timestamp: number; event: NonNullable<CustomerPortalContainerLifecycle["pickupAssignments"]>[number] }
  | { id: string; kind: "rework-event"; timestamp: number; event: NonNullable<CustomerPortalContainerLifecycle["reworkEvents"]>[number] }
  | { id: string; kind: "delivery-event"; timestamp: number; event: NonNullable<CustomerPortalContainerLifecycle["deliveryEvents"]>[number] };

type NormalizedContainerLifecycle = CustomerPortalContainerLifecycle & {
  packingLists: InboundDocument[];
  pickingOrders: OutboundDocument[];
  movements: Movement[];
  lifecycleEvents: CustomerPortalContainerLifecycle["lifecycleEvents"];
  pallets: CustomerPortalContainerLifecycle["pallets"];
  palletEvents: CustomerPortalContainerLifecycle["palletEvents"];
  trackingEvents: NonNullable<CustomerPortalContainerLifecycle["trackingEvents"]>;
  pickupAssignments: NonNullable<CustomerPortalContainerLifecycle["pickupAssignments"]>;
  reworkEvents: NonNullable<CustomerPortalContainerLifecycle["reworkEvents"]>;
  deliveryEvents: NonNullable<CustomerPortalContainerLifecycle["deliveryEvents"]>;
};

export function ContainerLifecycleView({
  containerNo,
  lifecycle: rawLifecycle,
  visibilityMode = "customer",
  isLoading = false,
  errorMessage = "",
  title,
  description,
  backLabel,
  onBack,
  actions,
  sidePanel,
  selectedNodeId,
  onNodeSelect,
  documentActions
}: ContainerLifecycleViewProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const lifecycle = useMemo(
    () => rawLifecycle ? normalizeContainerLifecycle(rawLifecycle) : null,
    [rawLifecycle]
  );
  const flowModel = useMemo(
    () => lifecycle ? buildLifecycleFlow(lifecycle, t, Boolean(onNodeSelect), selectedNodeId ?? null, visibilityMode) : { nodes: [], edges: [] },
    [lifecycle, onNodeSelect, selectedNodeId, t, visibilityMode]
  );
  const timelineEntries = useMemo(() => lifecycle ? buildTimelineEntries(lifecycle, visibilityMode) : [], [lifecycle, visibilityMode]);
  const outboundMovementCount = lifecycle?.movements.filter((movement) => movement.movementType === "OUT").length ?? 0;
  const transferMovementCount = lifecycle?.summary.transferCount ?? 0;
  const interactiveFlow = Boolean(onNodeSelect);
  const backButton = onBack ? (
    <Button type="button" variant="outline" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" />
      {backLabel ?? t("backToContainers")}
    </Button>
  ) : null;

  if (!containerNo) {
    return (
      <Card>
        <CardContent className="p-6">
          <InlineAlert>{t("containerDetailMissingDesc")}</InlineAlert>
          {backButton ? <div className="mt-4">{backButton}</div> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <PanelHeader
            title={title ?? `${t("customerPortalContainerLifecycle")} ${containerNo}`}
            description={description ?? t("customerPortalContainerLifecycleDesc")}
            icon={<Route className="h-4 w-4" />}
            errorMessage={errorMessage}
            actions={(
              <>
                {actions}
                {backButton}
              </>
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
            <div className={sidePanel ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]" : "grid gap-4"}>
              <div className="grid gap-4">
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
                    elementsSelectable={interactiveFlow}
                    onNodeClick={(_, node) => onNodeSelect?.(node.data.action)}
                  >
                    <Background color="#cbd5e1" gap={20} />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </div>
              </div>

              {sidePanel ? <aside className="min-w-0">{sidePanel}</aside> : null}
            </div>
          ) : (
            <InlineAlert>{t("containerDetailMissingDesc")}</InlineAlert>
          )}
        </CardContent>
      </Card>

      {lifecycle ? (
        <>
          <Card>
            <CardHeader>
              <PanelHeader
                title={t("customerPortalContainerTimeline")}
                description={t("customerPortalContainerTimelineDesc")}
                icon={<GitBranch className="h-4 w-4" />}
                actions={<Badge variant="secondary">{timelineEntries.length} {t("customerPortalLifecycleEvents")}</Badge>}
              />
            </CardHeader>
            <CardContent className="grid gap-3">
              {timelineEntries.length > 0 ? timelineEntries.map((entry) => (
                <TimelineEntryCard key={entry.id} entry={entry} visibilityMode={visibilityMode} resolvedTimeZone={resolvedTimeZone} t={t} />
              )) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  {t("containerDetailNoHistory")}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <PanelHeader
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
                      {documentActions?.onOpenPackingList || documentActions?.onEditPackingList ? <TableHead>{t("actions")}</TableHead> : null}
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
                        {documentActions?.onOpenPackingList || documentActions?.onEditPackingList ? (
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              {documentActions.onOpenPackingList ? <Button type="button" variant="outline" size="sm" onClick={() => documentActions.onOpenPackingList?.(document)}>{t("view")}</Button> : null}
                              {documentActions.onEditPackingList ? <Button type="button" size="sm" onClick={() => documentActions.onEditPackingList?.(document)}>{t("edit")}</Button> : null}
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                    {lifecycle.packingLists.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={documentActions?.onOpenPackingList || documentActions?.onEditPackingList ? 6 : 5} className="py-8 text-center text-slate-500">{t("noPackingLists")}</TableCell>
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
                      {documentActions?.onOpenPickingOrder || documentActions?.onEditPickingOrder ? <TableHead>{t("actions")}</TableHead> : null}
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
                        {documentActions?.onOpenPickingOrder || documentActions?.onEditPickingOrder ? (
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              {documentActions.onOpenPickingOrder ? <Button type="button" variant="outline" size="sm" onClick={() => documentActions.onOpenPickingOrder?.(document)}>{t("view")}</Button> : null}
                              {documentActions.onEditPickingOrder ? <Button type="button" size="sm" onClick={() => documentActions.onEditPickingOrder?.(document)}>{t("edit")}</Button> : null}
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                    {lifecycle.pickingOrders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={documentActions?.onOpenPickingOrder || documentActions?.onEditPickingOrder ? 6 : 5} className="py-8 text-center text-slate-500">{t("noPickingOrders")}</TableCell>
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

function PanelHeader({
  title,
  description,
  icon,
  actions,
  errorMessage
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  errorMessage?: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-950">
          {icon ? <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700">{icon}</span> : null}
          <span>{title}</span>
        </h2>
        {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p> : null}
        {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function InlineAlert({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
      {children}
    </div>
  );
}

function normalizeContainerLifecycle(lifecycle: CustomerPortalContainerLifecycle | ContainerLifecycle): NormalizedContainerLifecycle {
  return {
    ...lifecycle,
    summary: {
      ...lifecycle.summary,
      warehouses: asArray(lifecycle.summary.warehouses),
      pickingOrderRefs: asArray(lifecycle.summary.pickingOrderRefs)
    },
    packingLists: asArray(lifecycle.packingLists),
    pickingOrders: asArray(lifecycle.pickingOrders),
    movements: asArray(lifecycle.movements),
    lifecycleEvents: asArray(lifecycle.lifecycleEvents),
    pallets: asArray(lifecycle.pallets),
    palletEvents: asArray(lifecycle.palletEvents),
    trackingEvents: asArray(lifecycle.trackingEvents),
    pickupAssignments: asArray(lifecycle.pickupAssignments),
    reworkEvents: asArray(lifecycle.reworkEvents).map((event) => ({
      ...event,
      pallets: asArray(event.pallets)
    })),
    deliveryEvents: asArray(lifecycle.deliveryEvents)
  };
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function LifecycleMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{value}</div>
    </article>
  );
}

function buildLifecycleFlow(
  lifecycle: CustomerPortalContainerLifecycle,
  t: (key: string) => string,
  interactive: boolean,
  selectedNodeId: string | null,
  visibilityMode: LifecycleVisibilityMode
): { nodes: LifecycleNode[]; edges: Edge[] } {
  const MAIN_Y = 160;
  const MAIN_GAP = 290;
  const BRANCH_Y = 390;
  const nodes: LifecycleNode[] = [];
  const edges: Edge[] = [];
  const nodePositions: Record<string, { x: number; y: number }> = {};
  const trackingEvents = filterLifecycleDisplayEvents(lifecycle.trackingEvents ?? [], visibilityMode);
  const pickupAssignments = filterLifecycleDisplayEvents(lifecycle.pickupAssignments ?? [], visibilityMode);
  const reworkEvents = filterLifecycleDisplayEvents(lifecycle.reworkEvents ?? [], visibilityMode);
  const deliveryEvents = filterLifecycleDisplayEvents(lifecycle.deliveryEvents ?? [], visibilityMode);
  let edgeSequence = 0;
  const addNode = (
    id: string,
    x: number,
    y: number,
    action: ContainerLifecycleNodeAction,
    label: ReactNode,
    variant: "default" | "success" | "warning" | "done" = "default"
  ) => {
    nodes.push({
      id,
      position: { x, y },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { label, action },
      style: getFlowNodeStyle(variant, interactive, selectedNodeId === id)
    });
    nodePositions[id] = { x, y };
  };
  const addEdge = (source: string, target: string, label?: string) => {
    edges.push({
      id: `${source}-${target}-${edgeSequence++}`,
      source,
      target,
      label,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#64748b", strokeWidth: 2 },
      labelStyle: { fill: "#475569", fontSize: 11, fontWeight: 600 }
    });
  };

  const shouldShowContainerNode = interactive || Boolean(lifecycle.container) || trackingEvents.length > 0 || pickupAssignments.length > 0;
  const shouldShowTrackingNode = interactive || trackingEvents.length > 0;
  const shouldShowPickupNode = interactive || pickupAssignments.length > 0;
  const shouldShowReworkNode = interactive ? lifecycle.pallets.length > 0 : reworkEvents.length > 0;
  const firstPackingList = lifecycle.packingLists[0];
  const pickingOrderRefs = lifecycle.pickingOrders.length > 0
    ? lifecycle.pickingOrders.map((document) => document.packingListNo || document.orderRef || `#${document.id}`)
    : lifecycle.summary.pickingOrderRefs;
  const visibleOrderRefs = pickingOrderRefs.length > 0 ? pickingOrderRefs.slice(0, 5) : [t("customerPortalNoPickingOrderNode")];
  const shouldShowDeliveryNode = deliveryEvents.length > 0 || (interactive && pickingOrderRefs.length > 0);
  const firstPickingRef = visibleOrderRefs[0];
  const firstPickingDocument = lifecycle.pickingOrders[0];
  const latestDelivery = deliveryEvents[0];
  const mainSteps: LifecycleFlowStep[] = [];

  if (shouldShowContainerNode) {
    mainSteps.push({
      id: "container",
      action: { id: "container", kind: "container", title: lifecycle.summary.containerNo },
      variant: lifecycle.summary.status === "PENDING" ? "default" : "success",
      label: (
      <FlowNodeContent
        icon={<ContainerIcon className="h-4 w-4" />}
        eyebrow={t("containerLifecycleContainerNode")}
        title={lifecycle.summary.containerNo}
        lines={[
          lifecycle.summary.customerName,
          lifecycle.container?.trackingStatus || lifecycle.summary.status || "-"
        ]}
      />
      )
    });
  }

  if (shouldShowTrackingNode) {
    const latestTracking = trackingEvents[0];
    const trackingTitle = getLifecycleDisplayLabel(latestTracking, visibilityMode, t("containerLifecycleTrackingNode"), t);
    mainSteps.push({
      id: "tracking",
      action: { id: "tracking", kind: "tracking", title: t("containerLifecycleTrackingNode") },
      variant: "warning",
      label: (
      <FlowNodeContent
        icon={<MapPinned className="h-4 w-4" />}
        eyebrow={t("containerLifecycleTrackingNode")}
        title={trackingTitle}
        lines={[
          `${trackingEvents.length} ${t("customerPortalLifecycleEvents")}`,
          latestTracking?.location || formatNullableDate(latestTracking?.eventTime)
        ]}
      />
      )
    });
  }

  if (shouldShowPickupNode) {
    const latestPickup = pickupAssignments[0];
    const pickupTitle = getLifecycleDisplayLabel(
      latestPickup,
      visibilityMode,
      t("containerLifecyclePickupNode"),
      t,
      latestPickup?.assignmentType || latestPickup?.status
    );
    const pickupLine = visibilityMode === "admin"
      ? latestPickup?.driverName || latestPickup?.vendorName || latestPickup?.internalLabel || "-"
      : latestPickup?.displayLabel || latestPickup?.publicLabel || formatLifecycleDisplayText(latestPickup?.publicStatus, t) || "-";
    mainSteps.push({
      id: "pickup",
      action: { id: "pickup", kind: "pickup", title: t("containerLifecyclePickupNode") },
      variant: latestPickup?.actualPickupAt ? "success" : "warning",
      label: (
      <FlowNodeContent
        icon={<Truck className="h-4 w-4" />}
        eyebrow={t("containerLifecyclePickupNode")}
        title={pickupTitle}
        lines={[
          pickupLine,
          formatNullableDate(latestPickup?.actualPickupAt || latestPickup?.scheduledPickupAt)
        ]}
      />
      )
    });
  }

  mainSteps.push({
    id: "documents",
    action: {
      id: "documents",
      kind: "documents",
      title: t("customerPortalLifecycleDocuments"),
      documentId: firstPackingList?.id
    },
    label: (
    <FlowNodeContent
      icon={<ClipboardList className="h-4 w-4" />}
      eyebrow={t("customerPortalLifecycleDocuments")}
      title={t("customerPortalLifecycleDocuments")}
      lines={[
        `${lifecycle.summary.packingListCount} ${t("customerPortalPackingLists")}`,
        `${lifecycle.summary.outboundOrderCount} ${t("customerPortalPickingOrders")}`
      ]}
    />
    )
  });

  mainSteps.push({
    id: "received",
    action: { id: "received", kind: "receiving", title: t("received") },
    variant: "success",
    label: (
    <FlowNodeContent
      icon={<PackageCheck className="h-4 w-4" />}
      eyebrow={t("received")}
      title={`${lifecycle.summary.totalReceivedQty}`}
      lines={[formatNullableDate(lifecycle.summary.firstReceivedAt)]}
    />
    )
  });

  mainSteps.push({
    id: "inventory",
    action: { id: "inventory", kind: "inventory", title: t("customerPortalContainerCurrent") },
    variant: lifecycle.summary.currentQty > 0 ? "success" : "default",
    label: (
    <FlowNodeContent
      icon={<Boxes className="h-4 w-4" />}
      eyebrow={t("customerPortalContainerCurrent")}
      title={`${lifecycle.summary.currentQty}`}
      lines={[
        `${t("availableQty")} ${lifecycle.summary.availableQty}`,
        lifecycle.summary.warehouses.join(", ") || "-"
      ]}
    />
    )
  });

  mainSteps.push({
    id: "picking-0",
    action: {
      id: "picking-0",
      kind: "picking-order",
      title: firstPickingRef,
      outboundDocumentId: firstPickingDocument?.id
    },
    variant: pickingOrderRefs.length > 0 ? "warning" : "default",
    label: (
      <FlowNodeContent
        icon={<Send className="h-4 w-4" />}
        eyebrow={t("customerPortalPickingOrders")}
        title={firstPickingRef}
        lines={[`${t("customerPortalContainerShippedQty")} ${lifecycle.summary.shippedQty}`]}
      />
    )
  });

  if (shouldShowDeliveryNode) {
    mainSteps.push({
      id: "delivery",
      action: {
        id: "delivery",
        kind: "delivery",
        title: t("containerLifecycleDeliveryNode"),
        deliveryEventId: latestDelivery?.id,
        outboundDocumentId: latestDelivery?.outboundDocumentId
      },
      variant: latestDelivery?.bolReceivedAt ? "done" : "warning",
      label: (
      <FlowNodeContent
        icon={<Truck className="h-4 w-4" />}
        eyebrow={t("containerLifecycleDeliveryNode")}
        title={getLifecycleDisplayLabel(
          latestDelivery,
          visibilityMode,
          t("containerLifecycleDeliveryNode"),
          t,
          latestDelivery?.bolNumber || latestDelivery?.eventType
        )}
        lines={[
          visibilityMode === "admin"
            ? latestDelivery?.driverName || latestDelivery?.vendorName || latestDelivery?.internalLabel || "-"
            : latestDelivery?.bolNumber || latestDelivery?.displayLabel || latestDelivery?.publicLabel || "-",
          formatNullableDate(latestDelivery?.bolReceivedAt || latestDelivery?.eventTime)
        ]}
      />
      )
    });
  }

  mainSteps.push({
    id: "complete",
    action: { id: "complete", kind: "complete", title: t("containerStatus") },
    variant: lifecycle.summary.currentQty > 0 ? "success" : "done",
    label: (
    <FlowNodeContent
      icon={<CheckCircle2 className="h-4 w-4" />}
      eyebrow={t("containerStatus")}
      title={formatContainerStatus(lifecycle.summary.status, t)}
      lines={[`${t("lastActivity")} ${formatNullableDate(lifecycle.summary.lastActivityAt)}`]}
    />
    )
  });

  mainSteps.forEach((step, index) => {
    addNode(step.id, index * MAIN_GAP, MAIN_Y, step.action, step.label, step.variant);
    if (index > 0) {
      addEdge(mainSteps[index - 1].id, step.id);
    }
  });

  const inventoryPosition = nodePositions.inventory;
  const pickingPosition = nodePositions["picking-0"];
  let rejoinSource = "";

  if (inventoryPosition && lifecycle.summary.transferCount > 0) {
    addNode("transfers", inventoryPosition.x, BRANCH_Y, { id: "transfers", kind: "transfer", title: t("customerPortalContainerTransfers") }, (
      <FlowNodeContent
        icon={<GitBranch className="h-4 w-4" />}
        eyebrow={t("customerPortalContainerTransfers")}
        title={`${lifecycle.summary.transferCount}`}
        lines={[t("customerPortalTransferLifecycleNode")]}
      />
    ), "warning");
    addEdge("inventory", "transfers", t("customerPortalMoved"));
    rejoinSource = "transfers";
  }

  if (inventoryPosition && pickingPosition && shouldShowReworkNode) {
    const reworkX = rejoinSource ? pickingPosition.x : Math.round((inventoryPosition.x + pickingPosition.x) / 2);
    const palletIds = reworkEvents.flatMap((event) => event.pallets.map((pallet) => pallet.palletId));
    addNode("rework", reworkX, BRANCH_Y, {
      id: "rework",
      kind: "rework",
      title: t("containerLifecycleReworkNode"),
      palletIds
    }, (
      <FlowNodeContent
        icon={<Wrench className="h-4 w-4" />}
        eyebrow={t("containerLifecycleReworkNode")}
        title={`${reworkEvents.length || lifecycle.pallets.length}`}
        lines={[
          getLifecycleDisplayLabel(
            reworkEvents[0],
            visibilityMode,
            t("containerLifecycleReworkNode"),
            t,
            reworkEvents[0]?.referenceNo || reworkEvents[0]?.eventType
          )
        ]}
      />
    ), "warning");
    addEdge(rejoinSource || "inventory", "rework", t("containerLifecycleReworked"));
    rejoinSource = "rework";
  }

  if (rejoinSource) {
    addEdge(rejoinSource, "picking-0");
  }

  const branchTarget = shouldShowDeliveryNode ? "delivery" : "complete";
  visibleOrderRefs.slice(1).forEach((ref, branchIndex) => {
    const document = lifecycle.pickingOrders[branchIndex + 1];
    const nodeID = `picking-${branchIndex + 1}`;
    const branchY = MAIN_Y - 170 - branchIndex * 125;
    addNode(nodeID, pickingPosition?.x ?? MAIN_GAP * 4, branchY, {
      id: nodeID,
      kind: "picking-order",
      title: ref,
      outboundDocumentId: document?.id
    }, (
      <FlowNodeContent
        icon={<Send className="h-4 w-4" />}
        eyebrow={t("customerPortalPickingOrders")}
        title={ref}
        lines={[]}
      />
    ), "warning");
    addEdge("inventory", nodeID);
    addEdge(nodeID, branchTarget);
  });

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
  const visibleLines = lines.filter(Boolean).slice(0, 2);
  return (
    <div className="grid h-full min-w-0 content-start gap-2 overflow-hidden">
      <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">{icon}</span>
        <span className="min-w-0 truncate">{eyebrow}</span>
      </div>
      <div className="line-clamp-2 min-h-10 text-base font-semibold leading-5 text-slate-950" title={title}>{title}</div>
      {visibleLines.length > 0 ? (
        <div className="grid min-w-0 gap-0.5 text-xs leading-5 text-slate-500">
          {visibleLines.map((line, index) => <span key={`${line}-${index}`} className="truncate" title={line}>{line}</span>)}
        </div>
      ) : null}
    </div>
  );
}

function getFlowNodeStyle(variant: "default" | "success" | "warning" | "done", interactive: boolean, selected: boolean) {
  const shared = {
    borderRadius: 12,
    padding: 14,
    width: 230,
    height: 132,
    boxSizing: "border-box" as const,
    overflow: "hidden",
    border: selected ? "2px solid #2563eb" : "1px solid #e2e8f0",
    boxShadow: selected ? "0 16px 32px rgba(37, 99, 235, 0.16)" : "0 10px 24px rgba(15, 23, 42, 0.08)",
    cursor: interactive ? "pointer" : "default"
  };
  switch (variant) {
    case "success":
      return { ...shared, background: "#f0fdf4", border: selected ? shared.border : "1px solid #bbf7d0" };
    case "warning":
      return { ...shared, background: "#fffbeb", border: selected ? shared.border : "1px solid #fde68a" };
    case "done":
      return { ...shared, background: "#f8fafc", border: selected ? shared.border : "1px solid #cbd5e1" };
    default:
      return { ...shared, background: "#ffffff" };
  }
}

function buildTimelineEntries(lifecycle: CustomerPortalContainerLifecycle, visibilityMode: LifecycleVisibilityMode): TimelineEntry[] {
  const trackingEvents = filterLifecycleDisplayEvents(lifecycle.trackingEvents ?? [], visibilityMode);
  const pickupAssignments = filterLifecycleDisplayEvents(lifecycle.pickupAssignments ?? [], visibilityMode);
  const reworkEvents = filterLifecycleDisplayEvents(lifecycle.reworkEvents ?? [], visibilityMode);
  const deliveryEvents = filterLifecycleDisplayEvents(lifecycle.deliveryEvents ?? [], visibilityMode);
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
    })),
    ...trackingEvents.map((event) => ({
      id: `tracking-event-${event.id}`,
      kind: "tracking-event" as const,
      timestamp: getTimestamp(event.eventTime),
      event
    })),
    ...pickupAssignments.map((event) => ({
      id: `pickup-assignment-${event.id}`,
      kind: "pickup-assignment" as const,
      timestamp: getTimestamp(event.actualPickupAt || event.scheduledPickupAt || event.createdAt),
      event
    })),
    ...reworkEvents.map((event) => ({
      id: `rework-event-${event.id}`,
      kind: "rework-event" as const,
      timestamp: getTimestamp(event.eventTime),
      event
    })),
    ...deliveryEvents.map((event) => ({
      id: `delivery-event-${event.id}`,
      kind: "delivery-event" as const,
      timestamp: getTimestamp(event.bolReceivedAt || event.eventTime),
      event
    }))
  ].sort((left, right) => right.timestamp - left.timestamp);
}

function TimelineEntryCard({
  entry,
  visibilityMode,
  resolvedTimeZone,
  t
}: {
  entry: TimelineEntry;
  visibilityMode: LifecycleVisibilityMode;
  resolvedTimeZone: string;
  t: (key: string) => string;
}) {
  if (entry.kind === "pallet-event") {
    const event = entry.event;
    return (
      <article className="rounded-lg border border-slate-200 bg-white p-3">
        <TimelineCardHeader
          badge={<Badge variant="secondary">{formatPalletEventType(event.eventType, t)}</Badge>}
          title={event.palletCode}
          description={`${event.locationName} / ${event.storageSection || "-"} - ${event.quantityDelta >= 0 ? `+${event.quantityDelta}` : event.quantityDelta} ${t("quantity")}`}
          time={formatDateTimeValue(event.eventTime, resolvedTimeZone)}
        />
      </article>
    );
  }

  if (entry.kind === "tracking-event") {
    const event = entry.event;
    return (
      <article className="rounded-lg border border-slate-200 bg-white p-3">
        <TimelineCardHeader
          badge={<Badge variant="info">{getLifecycleDisplayStatus(event, visibilityMode, t("containerLifecycleTrackingNode"), t, event.eventType)}</Badge>}
          title={getLifecycleDisplayLabel(event, visibilityMode, event.location || t("containerLifecycleTrackingNode"), t, event.location || event.eventType)}
          description={visibilityMode === "admin" ? event.notes || event.customerName || "-" : event.displayLabel || event.publicLabel || event.location || "-"}
          time={formatDateTimeValue(event.eventTime, resolvedTimeZone)}
        />
      </article>
    );
  }

  if (entry.kind === "pickup-assignment") {
    const event = entry.event;
    return (
      <article className="rounded-lg border border-slate-200 bg-white p-3">
        <TimelineCardHeader
          badge={<Badge variant="warning">{getLifecycleDisplayStatus(event, visibilityMode, t("containerLifecyclePickupNode"), t, event.assignmentType || event.status)}</Badge>}
          title={getLifecycleDisplayLabel(event, visibilityMode, t("containerLifecyclePickupNode"), t, event.driverName || event.vendorName || event.status)}
          description={visibilityMode === "admin" ? [event.phone, event.notes].filter(Boolean).join(" / ") || "-" : event.displayLabel || event.publicLabel || "-"}
          time={formatDateTimeValue(event.actualPickupAt || event.scheduledPickupAt || event.createdAt, resolvedTimeZone)}
        />
      </article>
    );
  }

  if (entry.kind === "rework-event") {
    const event = entry.event;
    return (
      <article className="rounded-lg border border-slate-200 bg-white p-3">
        <TimelineCardHeader
          badge={<Badge variant="warning">{getLifecycleDisplayStatus(event, visibilityMode, t("containerLifecycleReworkNode"), t, event.eventType)}</Badge>}
          title={getLifecycleDisplayLabel(event, visibilityMode, t("containerLifecycleReworkNode"), t, event.referenceNo || event.pallets.map((pallet) => pallet.palletCode).join(", ") || event.eventType)}
          description={visibilityMode === "admin" ? event.notes || `${event.pallets.length} ${t("palletTrace")}` : event.displayLabel || event.publicLabel || `${event.pallets.length} ${t("palletTrace")}`}
          time={formatDateTimeValue(event.eventTime, resolvedTimeZone)}
        />
      </article>
    );
  }

  if (entry.kind === "delivery-event") {
    const event = entry.event;
    return (
      <article className="rounded-lg border border-slate-200 bg-white p-3">
        <TimelineCardHeader
          badge={<Badge variant={event.bolReceivedAt ? "success" : "warning"}>{getLifecycleDisplayStatus(event, visibilityMode, t("containerLifecycleDeliveryNode"), t, event.eventType)}</Badge>}
          title={getLifecycleDisplayLabel(event, visibilityMode, t("containerLifecycleDeliveryNode"), t, event.bolNumber || event.driverName || event.vendorName || event.eventType)}
          description={visibilityMode === "admin" ? [event.vehicleNo, event.notes].filter(Boolean).join(" / ") || "-" : event.bolNumber || event.displayLabel || event.publicLabel || "-"}
          time={formatDateTimeValue(event.bolReceivedAt || event.eventTime, resolvedTimeZone)}
        />
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
            {movement.locationName} / {movement.storageSection || "-"} - {movement.quantityChange >= 0 ? `+${movement.quantityChange}` : movement.quantityChange}
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

function TimelineCardHeader({
  badge,
  title,
  description,
  time
}: {
  badge: ReactNode;
  title: string;
  description: string;
  time: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {badge}
        <h3 className="mt-2 text-sm font-semibold text-slate-950">{title || "-"}</h3>
        <p className="mt-1 text-sm text-slate-500">{description || "-"}</p>
      </div>
      <time className="text-xs font-semibold text-slate-500">{time}</time>
    </div>
  );
}

function filterLifecycleDisplayEvents<T extends LifecycleDisplayFields>(
  events: T[],
  visibilityMode: LifecycleVisibilityMode
): T[] {
  if (visibilityMode === "admin") {
    return events;
  }
  return events.filter((event) => isCustomerVisibleLifecycleEvent(event.visibility));
}

function isCustomerVisibleLifecycleEvent(visibility?: string) {
  const normalized = (visibility ?? "BOTH").trim().toUpperCase();
  return normalized === "" || normalized === "PUBLIC" || normalized === "BOTH" || normalized === "CUSTOMER";
}

function getLifecycleDisplayLabel(
  event: LifecycleDisplayFields | null | undefined,
  visibilityMode: LifecycleVisibilityMode,
  fallback: string,
  t: (key: string) => string,
  adminFallback?: string
) {
  const rawValue = visibilityMode === "admin"
    ? firstNonEmptyText(event?.displayLabel, event?.internalLabel, event?.publicLabel, event?.internalStatus, event?.publicStatus, adminFallback, fallback)
    : firstNonEmptyText(event?.displayLabel, event?.publicLabel, event?.publicStatus, fallback);
  return formatLifecycleDisplayText(rawValue, t);
}

function getLifecycleDisplayStatus(
  event: LifecycleDisplayFields | null | undefined,
  visibilityMode: LifecycleVisibilityMode,
  fallback: string,
  t: (key: string) => string,
  adminFallback?: string
) {
  const rawValue = visibilityMode === "admin"
    ? firstNonEmptyText(event?.internalStatus, event?.publicStatus, event?.internalLabel, event?.publicLabel, adminFallback, fallback)
    : firstNonEmptyText(event?.publicStatus, event?.publicLabel, fallback);
  return formatLifecycleDisplayText(rawValue, t);
}

function firstNonEmptyText(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim() ?? "").find(Boolean) ?? "";
}

function formatLifecycleDisplayText(value: string | null | undefined, t: (key: string) => string) {
  const rawValue = value?.trim() ?? "";
  if (!rawValue) {
    return "";
  }
  const normalized = rawValue.toUpperCase();
  const keyByStatus: Record<string, string> = {
    NOT_ARRIVED: "containerLifecycleStatusNotArrived",
    ARRIVED_PORT: "containerLifecycleStatusArrivedPort",
    UNLOADED: "containerLifecycleStatusUnloaded",
    TRACKING_RECEIVED: "containerLifecycleStatusTrackingReceived",
    PICKUP_ASSIGNED: "containerLifecycleStatusPickupAssigned",
    PICKED_UP: "containerLifecycleStatusPickedUp",
    REWORKED: "containerLifecycleStatusReworked",
    DISPATCHED: "containerLifecycleStatusDispatched",
    BOL_RECEIVED: "containerLifecycleStatusBolReceived"
  };
  const translationKey = keyByStatus[normalized];
  if (translationKey) {
    const translated = t(translationKey);
    if (translated !== translationKey) {
      return translated;
    }
  }
  if (/^[A-Z0-9_ -]+$/.test(rawValue) && rawValue.includes("_")) {
    return rawValue
      .toLowerCase()
      .split("_")
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ");
  }
  return rawValue;
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

function formatNullableDate(value?: string | null) {
  if (!value) {
    return "-";
  }
  const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return dateMatch?.[1] ?? value;
}

function formatContainerStatus(status: string, t: (key: string) => string) {
  switch (status) {
    case "IN_STOCK":
      return t("customerPortalContainerActive");
    case "PARTIAL":
      return t("customerPortalContainerPartial");
    case "SHIPPED":
      return t("customerPortalContainerShipped");
    case "DEPLETED":
      return t("customerPortalContainerDepleted");
    case "PENDING":
      return t("customerPortalContainerPending");
    default:
      return status || "-";
  }
}
