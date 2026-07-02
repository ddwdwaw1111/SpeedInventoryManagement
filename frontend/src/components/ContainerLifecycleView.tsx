import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type XYPosition
} from "@xyflow/react";
import {
  ArrowLeft,
  Boxes,
  ClipboardList,
  Container as ContainerIcon,
  GitBranch,
  MapPinned,
  PackageCheck,
  Route,
  Send,
  Truck
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";

import { formatNumber } from "../lib/formatters";
import { useI18n } from "../lib/i18n";
import type {
  ContainerLifecycle,
  ContainerLifecycleNode,
  CustomerPortalContainerLifecycle,
  InboundDocument,
  LifecycleDisplayFields,
  Movement,
  OutboundDocument
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
  | "receiving"
  | "inventory"
  | "transfer"
  | "picking-order"
  | "delivery";

export type ContainerLifecycleNodeAction = {
  id: string;
  kind: ContainerLifecycleNodeKind;
  title: string;
  lifecycleNodeId?: number;
  isDraft?: boolean;
  documentId?: number;
  outboundDocumentId?: number;
  deliveryEventId?: number;
  attachedToNodeId?: string;
};

export const CONTAINER_LIFECYCLE_DRAFT_NODE_MIME_TYPE = "application/x-container-lifecycle-draft-node";

export type ContainerLifecycleDraftNodeKind = Extract<ContainerLifecycleNodeKind, "tracking" | "pickup" | "receiving" | "delivery">;

export type ContainerLifecycleDraftNode = {
  id: string;
  kind: ContainerLifecycleDraftNodeKind;
  title: string;
  position: XYPosition;
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
  hideHeaderText?: boolean;
  backLabel?: string;
  onBack?: () => void;
  actions?: ReactNode;
  sidePanel?: ReactNode;
  selectedNodeId?: string | null;
  onNodeSelect?: (action: ContainerLifecycleNodeAction) => void;
  onLifecycleNodeMove?: (action: ContainerLifecycleNodeAction, position: XYPosition) => void;
  draftNodes?: ContainerLifecycleDraftNode[];
  onDraftNodeDrop?: (kind: ContainerLifecycleDraftNodeKind, position: XYPosition) => void;
  onDraftNodeMove?: (id: string, position: XYPosition) => void;
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
  variant?: LifecycleNodeVariant;
};

type LifecycleNodeVariant = "default" | "success" | "warning" | "danger" | "done";

export type InboundDiscrepancyKind = "none" | "shortage" | "overage" | "damaged";

type LifecycleEdgeRoute = "horizontal" | "vertical-down" | "vertical-up";

type NormalizedContainerLifecycle = CustomerPortalContainerLifecycle & {
  packingLists: InboundDocument[];
  pickingOrders: OutboundDocument[];
  movements: Movement[];
  lifecycleEvents: CustomerPortalContainerLifecycle["lifecycleEvents"];
  trackingEvents: NonNullable<CustomerPortalContainerLifecycle["trackingEvents"]>;
  pickupAssignments: NonNullable<CustomerPortalContainerLifecycle["pickupAssignments"]>;
  deliveryEvents: NonNullable<CustomerPortalContainerLifecycle["deliveryEvents"]>;
  nodes: ContainerLifecycleNode[];
};

const LIFECYCLE_NODE_TYPES = {
  lifecycle: LifecycleFlowNode
};

const HANDLE_STYLE: CSSProperties = {
  width: 10,
  height: 10,
  border: "2px solid #64748b",
  background: "#ffffff",
  zIndex: 3
};

const HIDDEN_TARGET_HANDLE_STYLE: CSSProperties = {
  ...HANDLE_STYLE,
  opacity: 0,
  zIndex: 2
};

export function ContainerLifecycleView({
  containerNo,
  lifecycle: rawLifecycle,
  visibilityMode = "customer",
  isLoading = false,
  errorMessage = "",
  title,
  description,
  hideHeaderText = false,
  backLabel,
  onBack,
  actions,
  sidePanel,
  selectedNodeId,
  onNodeSelect,
  onLifecycleNodeMove,
  draftNodes = [],
  onDraftNodeDrop,
  onDraftNodeMove,
  documentActions
}: ContainerLifecycleViewProps) {
  const { t } = useI18n();
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<LifecycleNode, Edge> | null>(null);
  const lifecycle = useMemo(
    () => rawLifecycle ? normalizeContainerLifecycle(rawLifecycle) : null,
    [rawLifecycle]
  );
  const flowModel = useMemo(
    () => lifecycle ? buildLifecycleFlow(lifecycle, t, Boolean(onNodeSelect), selectedNodeId ?? null, visibilityMode) : { nodes: [], edges: [] },
    [lifecycle, onNodeSelect, selectedNodeId, t, visibilityMode]
  );
  const interactiveFlow = Boolean(onNodeSelect);
  const draftFlowNodes = useMemo(
    () => draftNodes.map((draftNode): LifecycleNode => ({
      id: draftNode.id,
      position: draftNode.position,
      type: "lifecycle",
      draggable: true,
      data: {
        action: {
          id: draftNode.id,
          kind: draftNode.kind,
          title: draftNode.title,
          isDraft: true
        },
        label: getDraftLifecycleNodeLabel(draftNode.kind, draftNode.title, t)
      },
      style: getFlowNodeStyle("warning", interactiveFlow, selectedNodeId === draftNode.id)
    })),
    [draftNodes, interactiveFlow, selectedNodeId, t]
  );
  const flowNodes = useMemo(
    () => [...flowModel.nodes, ...draftFlowNodes],
    [draftFlowNodes, flowModel.nodes]
  );
  const handleFlowDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!onDraftNodeDrop || !Array.from(event.dataTransfer.types).includes(CONTAINER_LIFECYCLE_DRAFT_NODE_MIME_TYPE)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, [onDraftNodeDrop]);
  const handleFlowDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!onDraftNodeDrop) {
      return;
    }
    const draftKind = event.dataTransfer.getData(CONTAINER_LIFECYCLE_DRAFT_NODE_MIME_TYPE);
    if (!isContainerLifecycleDraftNodeKind(draftKind)) {
      return;
    }
    event.preventDefault();
    const fallbackBounds = flowWrapperRef.current?.getBoundingClientRect();
    const position = flowInstance
      ? flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      : {
        x: event.clientX - (fallbackBounds?.left ?? 0),
        y: event.clientY - (fallbackBounds?.top ?? 0)
      };
    onDraftNodeDrop(draftKind, position);
  }, [flowInstance, onDraftNodeDrop]);
  const handleNodeDragStop = useCallback((_: unknown, node: LifecycleNode) => {
    if (node.data.action.isDraft) {
      onDraftNodeMove?.(node.id, node.position);
      return;
    }
    if (node.data.action.lifecycleNodeId) {
      onLifecycleNodeMove?.(node.data.action, node.position);
    }
  }, [onDraftNodeMove, onLifecycleNodeMove]);
  const backButton = onBack ? (
    <Button type="button" variant="outline" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" />
      {backLabel ?? t("backToContainers")}
    </Button>
  ) : null;
  const headerActions = actions || backButton ? (
    <>
      {actions}
      {backButton}
    </>
  ) : null;
  const showHeader = !hideHeaderText || Boolean(errorMessage) || Boolean(headerActions);

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
        {showHeader ? (
          <CardHeader>
            <PanelHeader
              title={title ?? `${t("customerPortalContainerLifecycle")} ${containerNo}`}
              description={description ?? t("customerPortalContainerLifecycleDesc")}
              icon={hideHeaderText ? undefined : <Route className="h-4 w-4" />}
              hideText={hideHeaderText}
              errorMessage={errorMessage}
              actions={headerActions}
            />
          </CardHeader>
        ) : null}
        <CardContent className="grid gap-4">
          {isLoading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
              <span className="inline-flex items-center justify-center gap-2">
                <InlineLoadingIndicator />
                {t("loadingRecords")}
              </span>
            </div>
          ) : lifecycle ? (
            <div className="grid gap-4">
              <div className={sidePanel ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]" : "grid gap-4"}>
                <div
                  ref={flowWrapperRef}
                  className="h-[calc(100vh-2rem)] min-h-[720px] overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                  onDragOver={handleFlowDragOver}
                  onDrop={handleFlowDrop}
                >
                  <ReactFlow
                    nodes={flowNodes}
                    edges={flowModel.edges}
                    nodeTypes={LIFECYCLE_NODE_TYPES}
                    fitView
                    fitViewOptions={{ padding: 0.18 }}
                    minZoom={0.35}
                    maxZoom={1.35}
                    nodesDraggable={draftNodes.length > 0 || Boolean(onLifecycleNodeMove)}
                    nodesConnectable={false}
                    elementsSelectable={interactiveFlow}
                    onInit={setFlowInstance}
                    onNodeClick={(_, node) => onNodeSelect?.(node.data.action)}
                    onNodeDragStop={handleNodeDragStop}
                  >
                    <Background color="#cbd5e1" gap={20} />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </div>

                {sidePanel ? <aside className="h-[calc(100vh-2rem)] min-h-[720px] min-w-0">{sidePanel}</aside> : null}
              </div>
            </div>
          ) : (
            <InlineAlert>{t("containerDetailMissingDesc")}</InlineAlert>
          )}
        </CardContent>
      </Card>

      {lifecycle ? (
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
                      <TableCell>{getOutboundContainerQuantity(document, containerNo, lifecycle.summary.containerId)}</TableCell>
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
      ) : null}
    </div>
  );
}

function PanelHeader({
  title,
  description,
  icon,
  actions,
  errorMessage,
  hideText = false
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  errorMessage?: string;
  hideText?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-start ${hideText ? "sm:justify-end" : "sm:justify-between"}`}>
      {!hideText || errorMessage ? (
        <div>
          {!hideText ? (
            <>
              <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-950">
                {icon ? <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700">{icon}</span> : null}
                <span>{title}</span>
              </h2>
              {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p> : null}
            </>
          ) : null}
        {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
      </div>
      ) : null}
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
    trackingEvents: asArray(lifecycle.trackingEvents),
    pickupAssignments: asArray(lifecycle.pickupAssignments),
    deliveryEvents: asArray(lifecycle.deliveryEvents),
    nodes: asArray(lifecycle.nodes)
  };
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function buildLifecycleFlow(
  lifecycle: CustomerPortalContainerLifecycle,
  t: (key: string, params?: Record<string, string | number>) => string,
  interactive: boolean,
  selectedNodeId: string | null,
  visibilityMode: LifecycleVisibilityMode
): { nodes: LifecycleNode[]; edges: Edge[] } {
  const MAIN_Y = 160;
  const MAIN_GAP = 290;
  const BRANCH_Y = 390;
  const OUTBOUND_ROW_GAP = 150;
  const nodes: LifecycleNode[] = [];
  const edges: Edge[] = [];
  const nodePositions: Record<string, { x: number; y: number }> = {};
  const trackingEvents = filterLifecycleDisplayEvents(lifecycle.trackingEvents ?? [], visibilityMode);
  const pickupAssignments = filterLifecycleDisplayEvents(lifecycle.pickupAssignments ?? [], visibilityMode);
  const deliveryEvents = filterLifecycleDisplayEvents(lifecycle.deliveryEvents ?? [], visibilityMode);
  const persistedNodes = filterPersistedLifecycleNodes(lifecycle.nodes ?? [], visibilityMode);
  let edgeSequence = 0;
  if (persistedNodes.length > 0) {
    return buildPersistedLifecycleFlow(lifecycle, persistedNodes, t, interactive, selectedNodeId, visibilityMode);
  }
  const addNode = (
    id: string,
    x: number,
    y: number,
    action: ContainerLifecycleNodeAction,
    label: ReactNode,
    variant: LifecycleNodeVariant = "default"
  ) => {
    nodes.push({
      id,
      position: { x, y },
      type: "lifecycle",
      draggable: false,
      data: { label, action },
      style: getFlowNodeStyle(variant, interactive, selectedNodeId === id)
    });
    nodePositions[id] = { x, y };
  };
  const addEdge = (source: string, target: string, label?: string, route: LifecycleEdgeRoute = "horizontal") => {
    const handles = getLifecycleEdgeHandles(route);
    edges.push({
      id: `${source}-${target}-${edgeSequence++}`,
      source,
      target,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      label,
      type: "default",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#64748b", strokeWidth: 2 },
      labelStyle: { fill: "#475569", fontSize: 11, fontWeight: 600 }
    });
  };
  const receivedPalletCount = getInboundPalletCount(lifecycle);
  const receivedSkuCount = getInboundSkuCount(lifecycle);
  const receivedQuantity = getInboundReceivedQty(lifecycle);
  const inboundDiscrepancyKind = getInboundDiscrepancyKind(lifecycle);
  const receivedAt = formatNullableDate(lifecycle.summary.firstReceivedAt);
  const inventoryWarehouses = getCurrentInventoryWarehouses(lifecycle);
  const inventoryWarehouseSummary = formatWarehouseSummary(inventoryWarehouses);
  const inventoryReferenceQty = getInventoryReferenceQty(lifecycle, receivedQuantity);
  const transferMovements = getTransferMovements(lifecycle.movements ?? []);
  const transferCount = getTransferCount(lifecycle.summary.transferCount, transferMovements);
  const transferRouteSummary = formatTransferRouteSummary(transferMovements);
  const pickingOrderRefs = lifecycle.pickingOrders.length > 0
    ? lifecycle.pickingOrders.map((document) => document.packingListNo || document.orderRef || `#${document.id}`)
    : lifecycle.summary.pickingOrderRefs;
  const hasPickingOrders = pickingOrderRefs.length > 0;
  const visibleOrderRefs = hasPickingOrders ? pickingOrderRefs.slice(0, 5) : [];
  const packingListRefs = formatLifecycleDocumentRefs(
    lifecycle.packingLists.map((document) => document.containerNo || `#${document.id}`)
  );
  const hasReceivedActivity = receivedQuantity > 0
    || (lifecycle.summary.totalReceivedQty ?? 0) > 0
    || Boolean(lifecycle.summary.firstReceivedAt)
    || (lifecycle.lifecycleEvents ?? []).some((event) => event.eventType === "RECEIVE");
  const hasInventoryActivity = hasReceivedActivity
    || (lifecycle.summary.currentQty ?? 0) > 0
    || (lifecycle.summary.shippedQty ?? 0) > 0
    || transferCount > 0
    || hasPickingOrders
    || deliveryEvents.length > 0;
  const shouldShowContainerNode = Boolean(lifecycle.summary.containerNo);
  const shouldShowTrackingNode = trackingEvents.length > 0;
  const shouldShowPickupNode = pickupAssignments.length > 0;
  const shouldShowReceivingNode = hasReceivedActivity;
  const shouldShowInventoryNode = hasInventoryActivity;
  const mainSteps: LifecycleFlowStep[] = [];

  if (shouldShowContainerNode) {
    mainSteps.push({
      id: "container",
      action: { id: "container", kind: "container", title: lifecycle.summary.containerNo },
      variant: getContainerStatusNodeVariant(lifecycle.summary.status),
      label: (
      <FlowNodeContent
        icon={<ContainerIcon className="h-4 w-4" />}
        eyebrow={`${t("containerLifecycleContainerNode")} / ${formatContainerStatus(lifecycle.summary.status, t)}`}
        title={lifecycle.summary.containerNo}
        lines={[
          lifecycle.summary.customerName,
          packingListRefs || `${lifecycle.summary.packingListCount || 0} ${t("customerPortalPackingLists")}`,
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

  if (shouldShowReceivingNode) {
    mainSteps.push({
      id: "received",
      action: { id: "received", kind: "receiving", title: t("containerLifecycleInboundNode") },
      variant: getInboundDiscrepancyNodeVariant(inboundDiscrepancyKind),
      label: (
      <InboundFlowNodeContent
        icon={<PackageCheck className="h-4 w-4" />}
        eyebrow={t("containerLifecycleInboundNode")}
        palletCount={receivedPalletCount}
        skuCount={receivedSkuCount}
        quantity={receivedQuantity}
        discrepancyKind={inboundDiscrepancyKind}
        receivedAt={receivedAt}
        documentSummary={packingListRefs}
        t={t}
      />
      )
    });
  }

  if (shouldShowInventoryNode) {
    mainSteps.push({
      id: "inventory",
      action: { id: "inventory", kind: "inventory", title: t("customerPortalContainerCurrent") },
      variant: lifecycle.summary.currentQty > 0 ? "success" : "default",
      label: (
      <InventoryFlowNodeContent
        icon={<Boxes className="h-4 w-4" />}
        eyebrow={t("customerPortalContainerCurrent")}
        quantity={lifecycle.summary.currentQty}
        referenceQuantity={inventoryReferenceQty}
        warehouseLabel={t("currentStorage")}
        warehouseSummary={inventoryWarehouseSummary}
      />
      )
    });
  }

  mainSteps.forEach((step, index) => {
    addNode(step.id, index * MAIN_GAP, MAIN_Y, step.action, step.label, step.variant);
    if (index > 0) {
      addEdge(mainSteps[index - 1].id, step.id);
    }
  });

  const inventoryPosition = nodePositions.inventory;
  const shouldShowAdminTransferNode = Boolean(visibilityMode === "admin" && inventoryPosition && transferCount > 0);
  const shouldInlineTransferNode = shouldShowAdminTransferNode && visibleOrderRefs.length > 0;
  const transferNodeX = inventoryPosition ? inventoryPosition.x + MAIN_GAP : MAIN_GAP * mainSteps.length;
  const outboundX = inventoryPosition ? inventoryPosition.x + MAIN_GAP + (shouldInlineTransferNode ? MAIN_GAP : 0) : MAIN_GAP * mainSteps.length;
  const deliveryX = outboundX + MAIN_GAP;
  const transferSourceNodeId = shouldInlineTransferNode ? "transfer" : "inventory";

  if (shouldShowAdminTransferNode) {
    addNode("transfer", shouldInlineTransferNode ? transferNodeX : inventoryPosition.x, shouldInlineTransferNode ? MAIN_Y : BRANCH_Y, { id: "transfer", kind: "transfer", title: t("containerLifecycleTransferNode") }, (
      <FlowNodeContent
        icon={<GitBranch className="h-4 w-4" />}
        eyebrow={`${t("containerLifecycleTransferNode")} / ${formatNumber(transferCount)} ${t("customerPortalMoved")}`}
        title={transferRouteSummary || t("customerPortalTransferLifecycleNode")}
      />
    ), "warning");
    addEdge("inventory", "transfer", t("customerPortalMoved"), shouldInlineTransferNode ? "horizontal" : "vertical-down");
  }

  visibleOrderRefs.forEach((ref, documentIndex) => {
    const document = lifecycle.pickingOrders[documentIndex];
    const delivery = getDeliveryEventForOutbound(document, documentIndex, deliveryEvents);
    const nodeID = `picking-${documentIndex}`;
    const deliveryNodeID = `delivery-${documentIndex}`;
    const rowY = getCenteredStackY(documentIndex, visibleOrderRefs.length, MAIN_Y, OUTBOUND_ROW_GAP);
    const nodeTitle = formatOutboundNodeTitle(document, ref, lifecycle.summary.containerNo, lifecycle.summary.containerId);
    addNode(nodeID, outboundX, rowY, {
      id: nodeID,
      kind: "picking-order",
      title: nodeTitle,
      outboundDocumentId: document?.id
    }, (
        <FlowNodeContent
          icon={<Send className="h-4 w-4" />}
          eyebrow={t("customerPortalPickingOrders")}
          title={nodeTitle}
          lines={[]}
        />
    ), "warning");
    addNode(deliveryNodeID, deliveryX, rowY, {
      id: deliveryNodeID,
      kind: "delivery",
      title: formatDeliveryNodeTitle(delivery, visibilityMode, t),
      deliveryEventId: delivery?.id,
      outboundDocumentId: document?.id ?? delivery?.outboundDocumentId
    }, (
      <FlowNodeContent
        icon={<Truck className="h-4 w-4" />}
        eyebrow={t("containerLifecycleDeliveryNode")}
        title={formatDeliveryNodeTitle(delivery, visibilityMode, t)}
        lines={[]}
      />
    ), delivery?.bolReceivedAt ? "done" : "warning");
    addEdge(transferSourceNodeId, nodeID);
    addEdge(nodeID, deliveryNodeID);
  });

  return { nodes, edges };
}

function buildPersistedLifecycleFlow(
  lifecycle: CustomerPortalContainerLifecycle,
  persistedNodes: ContainerLifecycleNode[],
  t: (key: string, params?: Record<string, string | number>) => string,
  interactive: boolean,
  selectedNodeId: string | null,
  visibilityMode: LifecycleVisibilityMode
): { nodes: LifecycleNode[]; edges: Edge[] } {
  const MAIN_Y = 160;
  const MAIN_GAP = 290;
  const nodes: LifecycleNode[] = [];
  const edges: Edge[] = [];
  const flowIdByNodeId = new Map<number, string>();
  const sortedNodes = [...persistedNodes].sort((left, right) => (
    (left.sortOrder || 0) - (right.sortOrder || 0) || left.id - right.id
  ));

  sortedNodes.forEach((node, index) => {
    const nodeKind = getPersistedLifecycleNodeKind(node);
    if (!nodeKind) {
      return;
    }
    const flowId = persistedLifecycleNodeFlowId(node);
    flowIdByNodeId.set(node.id, flowId);
    const presentation = getPersistedLifecycleNodePresentation(node, nodeKind, lifecycle, t, visibilityMode);
    const position = {
      x: typeof node.positionX === "number" ? node.positionX : index * MAIN_GAP,
      y: typeof node.positionY === "number" ? node.positionY : MAIN_Y
    };
    nodes.push({
      id: flowId,
      position,
      type: "lifecycle",
      draggable: interactive,
      data: {
        action: {
          ...presentation.action,
          id: flowId,
          lifecycleNodeId: node.id
        },
        label: presentation.label
      },
      style: getFlowNodeStyle(presentation.variant, interactive, selectedNodeId === flowId)
    });
  });

  sortedNodes.forEach((node, index) => {
    const target = flowIdByNodeId.get(node.id);
    if (!target) {
      return;
    }
    const parent = node.parentNodeId ? flowIdByNodeId.get(node.parentNodeId) : undefined;
    const previous = index > 0 ? flowIdByNodeId.get(sortedNodes[index - 1].id) : undefined;
    const source = parent ?? previous;
    if (!source || source === target) {
      return;
    }
    const handles = getLifecycleEdgeHandles("horizontal");
    edges.push({
      id: `${source}-${target}`,
      source,
      target,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      type: "default",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#64748b", strokeWidth: 2 },
      labelStyle: { fill: "#475569", fontSize: 11, fontWeight: 600 }
    });
  });

  return { nodes, edges };
}

function getPersistedLifecycleNodePresentation(
  node: ContainerLifecycleNode,
  kind: ContainerLifecycleNodeKind,
  lifecycle: CustomerPortalContainerLifecycle,
  t: (key: string, params?: Record<string, string | number>) => string,
  visibilityMode: LifecycleVisibilityMode
): { action: ContainerLifecycleNodeAction; label: ReactNode; variant: LifecycleNodeVariant } {
  const sourceType = String(node.sourceType || "").toUpperCase();
  const title = node.title?.trim() || getLifecycleNodeDefaultTitle(kind, lifecycle, t);
  const action: ContainerLifecycleNodeAction = {
    id: persistedLifecycleNodeFlowId(node),
    kind,
    title
  };

  if (kind === "container") {
    const packingListRefs = formatLifecycleDocumentRefs([
      lifecycle.container?.packingListNo,
      lifecycle.summary.packingListNo,
      ...(lifecycle.packingLists ?? []).map((document) => document.containerNo || `#${document.id}`)
    ].filter(Boolean) as string[]);
    return {
      action,
      variant: getContainerStatusNodeVariant(lifecycle.summary.status),
      label: (
        <FlowNodeContent
          icon={<ContainerIcon className="h-4 w-4" />}
          eyebrow={`${t("containerLifecycleContainerNode")} / ${formatContainerStatus(lifecycle.summary.status, t)}`}
          title={lifecycle.summary.containerNo || title}
          lines={[
            lifecycle.summary.customerName,
            packingListRefs || `${lifecycle.summary.packingListCount || 0} ${t("customerPortalPackingLists")}`,
            lifecycle.container?.trackingStatus || lifecycle.summary.status || "-"
          ]}
        />
      )
    };
  }

  if (kind === "receiving") {
    const receivedQuantity = getInboundReceivedQty(lifecycle);
    const inboundDiscrepancyKind = getInboundDiscrepancyKind(lifecycle);
    if (sourceType === "INBOUND_DOCUMENT" && node.sourceId > 0) {
      action.documentId = node.sourceId;
    }
    return {
      action,
      variant: receivedQuantity > 0 ? getInboundDiscrepancyNodeVariant(inboundDiscrepancyKind) : "warning",
      label: (
        <InboundFlowNodeContent
          icon={<PackageCheck className="h-4 w-4" />}
          eyebrow={t("containerLifecycleInboundNode")}
          palletCount={getInboundPalletCount(lifecycle)}
          skuCount={getInboundSkuCount(lifecycle)}
          quantity={receivedQuantity}
          discrepancyKind={inboundDiscrepancyKind}
          receivedAt={formatNullableDate(lifecycle.summary.firstReceivedAt)}
          documentSummary={formatLifecycleDocumentRefs((lifecycle.packingLists ?? []).map((document) => document.containerNo || `#${document.id}`))}
          t={t}
        />
      )
    };
  }

  if (kind === "inventory") {
    const receivedQuantity = getInboundReceivedQty(lifecycle);
    return {
      action,
      variant: lifecycle.summary.currentQty > 0 ? "success" : "default",
      label: (
        <InventoryFlowNodeContent
          icon={<Boxes className="h-4 w-4" />}
          eyebrow={t("customerPortalContainerCurrent")}
          quantity={lifecycle.summary.currentQty}
          referenceQuantity={getInventoryReferenceQty(lifecycle, receivedQuantity)}
          warehouseLabel={t("currentStorage")}
          warehouseSummary={formatWarehouseSummary(getCurrentInventoryWarehouses(lifecycle))}
        />
      )
    };
  }

  if (kind === "tracking") {
    const tracking = sourceType === "TRACKING_EVENT"
      ? (lifecycle.trackingEvents ?? []).find((event) => event.id === node.sourceId)
      : undefined;
    return {
      action,
      variant: "warning",
      label: (
        <FlowNodeContent
          icon={<MapPinned className="h-4 w-4" />}
          eyebrow={t("containerLifecycleTrackingNode")}
          title={getLifecycleDisplayLabel(tracking, visibilityMode, title, t)}
          lines={[
            tracking?.location || "",
            formatNullableDate(tracking?.eventTime)
          ]}
        />
      )
    };
  }

  if (kind === "pickup") {
    const pickup = sourceType === "PICKUP_ASSIGNMENT"
      ? (lifecycle.pickupAssignments ?? []).find((assignment) => assignment.id === node.sourceId)
      : undefined;
    return {
      action,
      variant: pickup?.actualPickupAt ? "success" : "warning",
      label: (
        <FlowNodeContent
          icon={<Truck className="h-4 w-4" />}
          eyebrow={t("containerLifecyclePickupNode")}
          title={getLifecycleDisplayLabel(pickup, visibilityMode, title, t, pickup?.assignmentType || pickup?.status)}
          lines={[
            visibilityMode === "admin" ? pickup?.driverName || pickup?.vendorName || "" : "",
            formatNullableDate(pickup?.actualPickupAt || pickup?.scheduledPickupAt)
          ]}
        />
      )
    };
  }

  if (kind === "picking-order") {
    const document = sourceType === "OUTBOUND_DOCUMENT"
      ? (lifecycle.pickingOrders ?? []).find((entry) => entry.id === node.sourceId)
      : undefined;
    if (document?.id) {
      action.outboundDocumentId = document.id;
    }
    const nodeTitle = formatOutboundNodeTitle(document, title, lifecycle.summary.containerNo, lifecycle.summary.containerId);
    action.title = nodeTitle;
    return {
      action,
      variant: "warning",
      label: (
        <FlowNodeContent
          icon={<Send className="h-4 w-4" />}
          eyebrow={t("customerPortalPickingOrders")}
          title={nodeTitle}
        />
      )
    };
  }

  if (kind === "delivery") {
    const delivery = sourceType === "DELIVERY_EVENT"
      ? (lifecycle.deliveryEvents ?? []).find((event) => event.id === node.sourceId)
      : undefined;
    if (delivery?.id) {
      action.deliveryEventId = delivery.id;
      action.outboundDocumentId = delivery.outboundDocumentId;
    }
    return {
      action,
      variant: delivery?.bolReceivedAt ? "done" : "warning",
      label: (
        <FlowNodeContent
          icon={<Truck className="h-4 w-4" />}
          eyebrow={t("containerLifecycleDeliveryNode")}
          title={formatDeliveryNodeTitle(delivery, visibilityMode, t) || title}
          lines={[delivery?.bolNumber || "", formatNullableDate(delivery?.eventTime)]}
        />
      )
    };
  }

  if (kind === "transfer") {
    const transferMovements = getTransferMovements(lifecycle.movements ?? []);
    return {
      action,
      variant: "warning",
      label: (
        <FlowNodeContent
          icon={<GitBranch className="h-4 w-4" />}
          eyebrow={t("containerLifecycleTransferNode")}
          title={formatTransferRouteSummary(transferMovements) || title}
        />
      )
    };
  }

  return {
    action,
    variant: "warning",
    label: (
      <FlowNodeContent
        icon={getLifecycleNodeIcon(kind)}
        eyebrow={getLifecycleNodeEyebrow(kind, t)}
        title={title}
      />
    )
  };
}

function filterPersistedLifecycleNodes(nodes: ContainerLifecycleNode[], visibilityMode: LifecycleVisibilityMode) {
  return nodes.filter((node) => getPersistedLifecycleNodeKind(node) && (
    visibilityMode === "admin" || isCustomerVisibleLifecycleEvent(node.visibility)
  ));
}

function getPersistedLifecycleNodeKind(node: ContainerLifecycleNode): ContainerLifecycleNodeKind | null {
  const value = String(node.nodeKind || "").toLowerCase();
  if (
    value === "container"
    || value === "tracking"
    || value === "pickup"
    || value === "receiving"
    || value === "inventory"
    || value === "transfer"
    || value === "picking-order"
    || value === "delivery"
  ) {
    return value as ContainerLifecycleNodeKind;
  }
  return null;
}

function persistedLifecycleNodeFlowId(node: ContainerLifecycleNode) {
  return `lifecycle-node-${node.id}`;
}

function getLifecycleNodeDefaultTitle(
  kind: ContainerLifecycleNodeKind,
  lifecycle: CustomerPortalContainerLifecycle,
  t: (key: string, params?: Record<string, string | number>) => string
) {
  switch (kind) {
    case "container":
      return lifecycle.summary.containerNo || t("containerLifecycleContainerNode");
    case "tracking":
      return t("containerLifecycleTrackingNode");
    case "pickup":
      return t("containerLifecyclePickupNode");
    case "receiving":
      return t("containerLifecycleInboundNode");
    case "inventory":
      return t("customerPortalContainerCurrent");
    case "transfer":
      return t("containerLifecycleTransferNode");
    case "picking-order":
      return t("customerPortalPickingOrders");
    case "delivery":
      return t("containerLifecycleDeliveryNode");
  }
}

function getLifecycleNodeEyebrow(kind: ContainerLifecycleNodeKind, t: (key: string) => string) {
  switch (kind) {
    case "container":
      return t("containerLifecycleContainerNode");
    case "tracking":
      return t("containerLifecycleTrackingNode");
    case "pickup":
      return t("containerLifecyclePickupNode");
    case "receiving":
      return t("containerLifecycleInboundNode");
    case "inventory":
      return t("customerPortalContainerCurrent");
    case "transfer":
      return t("containerLifecycleTransferNode");
    case "picking-order":
      return t("customerPortalPickingOrders");
    case "delivery":
      return t("containerLifecycleDeliveryNode");
  }
}

function getLifecycleNodeIcon(kind: ContainerLifecycleNodeKind) {
  switch (kind) {
    case "container":
      return <ContainerIcon className="h-4 w-4" />;
    case "tracking":
      return <MapPinned className="h-4 w-4" />;
    case "pickup":
      return <Truck className="h-4 w-4" />;
    case "receiving":
      return <PackageCheck className="h-4 w-4" />;
    case "inventory":
      return <Boxes className="h-4 w-4" />;
    case "transfer":
      return <GitBranch className="h-4 w-4" />;
    case "picking-order":
      return <Send className="h-4 w-4" />;
    case "delivery":
      return <Truck className="h-4 w-4" />;
  }
}

function LifecycleFlowNode({ data }: NodeProps<LifecycleNode>) {
  return (
    <div className="relative h-full w-full">
      <Handle type="source" id="top-source" position={Position.Top} isConnectable={false} style={HANDLE_STYLE} />
      <Handle type="target" id="top-target" position={Position.Top} isConnectable={false} style={HIDDEN_TARGET_HANDLE_STYLE} />
      <Handle type="source" id="right-source" position={Position.Right} isConnectable={false} style={HANDLE_STYLE} />
      <Handle type="target" id="right-target" position={Position.Right} isConnectable={false} style={HIDDEN_TARGET_HANDLE_STYLE} />
      <Handle type="source" id="bottom-source" position={Position.Bottom} isConnectable={false} style={HANDLE_STYLE} />
      <Handle type="target" id="bottom-target" position={Position.Bottom} isConnectable={false} style={HIDDEN_TARGET_HANDLE_STYLE} />
      <Handle type="source" id="left-source" position={Position.Left} isConnectable={false} style={HANDLE_STYLE} />
      <Handle type="target" id="left-target" position={Position.Left} isConnectable={false} style={HIDDEN_TARGET_HANDLE_STYLE} />
      <div className="h-full w-full p-3.5">{data.label}</div>
    </div>
  );
}

function getLifecycleEdgeHandles(route: LifecycleEdgeRoute) {
  switch (route) {
    case "vertical-down":
      return { sourceHandle: "bottom-source", targetHandle: "top-target" };
    case "vertical-up":
      return { sourceHandle: "top-source", targetHandle: "bottom-target" };
    default:
      return { sourceHandle: "right-source", targetHandle: "left-target" };
  }
}

function getCenteredStackY(index: number, total: number, centerY: number, rowGap: number) {
  return centerY + (index - (total - 1) / 2) * rowGap;
}

function isContainerLifecycleDraftNodeKind(value: string): value is ContainerLifecycleDraftNodeKind {
  return value === "tracking" || value === "pickup" || value === "receiving" || value === "delivery";
}

function getDraftLifecycleNodeLabel(
  kind: ContainerLifecycleDraftNodeKind,
  title: string,
  t: (key: string) => string
) {
  return (
    <FlowNodeContent
      icon={getDraftLifecycleNodeIcon(kind)}
      eyebrow={t("adminContainerLifecycleNodePanel")}
      title={title}
      lines={[]}
    />
  );
}

function getDraftLifecycleNodeIcon(kind: ContainerLifecycleDraftNodeKind) {
  switch (kind) {
    case "tracking":
      return <MapPinned className="h-4 w-4" />;
    case "pickup":
      return <Truck className="h-4 w-4" />;
    case "receiving":
      return <PackageCheck className="h-4 w-4" />;
    case "delivery":
      return <Send className="h-4 w-4" />;
  }
}

function getCurrentInventoryWarehouses(lifecycle: CustomerPortalContainerLifecycle) {
  if ((lifecycle.summary.currentQty ?? 0) <= 0) {
    return [];
  }
  const names = new Set<string>();
  (lifecycle.summary.warehouses ?? []).forEach((warehouse) => addNonEmptyText(names, warehouse));
  addNonEmptyText(names, lifecycle.container?.locationName);
  return Array.from(names);
}

function formatWarehouseSummary(warehouses: string[]) {
  if (warehouses.length === 0) {
    return "-";
  }
  const visibleWarehouses = warehouses.slice(0, 2);
  const remainingCount = warehouses.length - visibleWarehouses.length;
  return remainingCount > 0 ? `${visibleWarehouses.join(", ")} +${remainingCount}` : visibleWarehouses.join(", ");
}

function getInventoryReferenceQty(lifecycle: CustomerPortalContainerLifecycle, receivedQuantity: number) {
  return receivedQuantity || lifecycle.summary.totalReceivedQty || lifecycle.summary.currentQty || 0;
}

function getTransferMovements(movements: Movement[]) {
  return movements.filter((movement) => movement.movementType === "TRANSFER_IN" || movement.movementType === "TRANSFER_OUT");
}

function getTransferCount(summaryTransferCount: number, transferMovements: Movement[]) {
  if (summaryTransferCount > 0) {
    return summaryTransferCount;
  }
  if (transferMovements.length === 0) {
    return 0;
  }
  return new Set(transferMovements.map(getTransferMovementGroupKey)).size;
}

function formatTransferRouteSummary(transferMovements: Movement[]) {
  const routeGroups = new Map<string, { from?: string; to?: string; fallback?: string }>();
  transferMovements.forEach((movement) => {
    const key = getTransferMovementGroupKey(movement);
    const route = routeGroups.get(key) ?? {};
    const location = formatMovementLocation(movement);
    if (movement.movementType === "TRANSFER_OUT") {
      route.from = route.from || location;
    } else if (movement.movementType === "TRANSFER_IN") {
      route.to = route.to || location;
    }
    route.fallback = route.fallback || location;
    routeGroups.set(key, route);
  });

  const routes = Array.from(routeGroups.values())
    .map((route) => {
      if (route.from && route.to) {
        return `${route.from} -> ${route.to}`;
      }
      return route.to || route.from || route.fallback || "";
    })
    .filter(Boolean);
  const uniqueRoutes = Array.from(new Set(routes));
  const visibleRoutes = uniqueRoutes.slice(0, 2);
  const remainingCount = uniqueRoutes.length - visibleRoutes.length;
  return remainingCount > 0 ? `${visibleRoutes.join(", ")} +${remainingCount}` : visibleRoutes.join(", ");
}

function getTransferMovementGroupKey(movement: Movement) {
  if ((movement.sourceDocumentId || 0) > 0) {
    return `${movement.sourceDocumentType || "TRANSFER"}-${movement.sourceDocumentId}`;
  }
  if (movement.referenceCode) {
    return movement.referenceCode;
  }
  return String(movement.id);
}

function formatMovementLocation(movement: Pick<Movement, "locationName" | "storageSection">) {
  return [movement.locationName, movement.storageSection].filter(Boolean).join(" / ") || "-";
}

function addNonEmptyText(values: Set<string>, value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  if (trimmed) {
    values.add(trimmed);
  }
}

function getContainerStatusNodeVariant(status: string): "default" | "success" | "warning" | "done" {
  switch (status) {
    case "IN_STOCK":
      return "success";
    case "PARTIAL":
      return "warning";
    case "SHIPPED":
    case "DEPLETED":
      return "done";
    case "PENDING":
    default:
      return "default";
  }
}

function formatOutboundNodeTitle(
  document: OutboundDocument | undefined,
  fallbackRef: string,
  containerNo: string,
  containerId?: number | null
) {
  if (!document) {
    return fallbackRef;
  }
  const reference = document.packingListNo || document.orderRef || fallbackRef || `#${document.id}`;
  const goodsSummary = formatOutboundContainerGoodsSummary(document, containerNo, containerId);
  return goodsSummary ? `${reference}: ${goodsSummary}` : reference;
}

function getDeliveryEventForOutbound(
  document: OutboundDocument | undefined,
  documentIndex: number,
  deliveryEvents: NonNullable<CustomerPortalContainerLifecycle["deliveryEvents"]>
) {
  if (document?.id) {
    return deliveryEvents.find((event) => event.outboundDocumentId === document.id);
  }
  return deliveryEvents[documentIndex];
}

function formatDeliveryNodeTitle(
  event: NonNullable<CustomerPortalContainerLifecycle["deliveryEvents"]>[number] | undefined,
  visibilityMode: LifecycleVisibilityMode,
  t: (key: string) => string
) {
  return getLifecycleDisplayLabel(
    event,
    visibilityMode,
    t("containerLifecycleDeliveryNode"),
    t,
    event?.bolNumber || event?.eventType
  );
}

function formatOutboundContainerGoodsSummary(document: OutboundDocument, containerNo: string, containerId?: number | null) {
  const rows = getOutboundContainerGoodsRows(document, containerNo, containerId);
  if (rows.length === 0) {
    return "";
  }
  const visibleRows = rows.slice(0, 2).map((row) => `${row.sku} ${formatNumber(row.quantity)}`);
  const remainingCount = rows.length - visibleRows.length;
  return remainingCount > 0 ? `${visibleRows.join(", ")} +${remainingCount}` : visibleRows.join(", ");
}

function getOutboundContainerGoodsRows(document: OutboundDocument, containerNo: string, containerId?: number | null) {
  const normalizedContainerNo = normalizeContainerNo(containerNo);
  const normalizedContainerId = containerId && containerId > 0 ? containerId : 0;
  const rows = new Map<string, number>();
  let hasAnyPickAllocation = false;

  (document.lines ?? []).forEach((line) => {
    const sku = line.sku || line.itemNumber || "-";
    (line.pickAllocations ?? []).forEach((allocation) => {
      hasAnyPickAllocation = true;
      if (!outboundAllocationMatchesContainer(allocation, normalizedContainerId, normalizedContainerNo)) {
        return;
      }
      rows.set(sku, (rows.get(sku) ?? 0) + (allocation.allocatedQty || 0));
    });
  });

  if (rows.size === 0 && !hasAnyPickAllocation) {
    (document.lines ?? []).forEach((line) => {
      const sku = line.sku || line.itemNumber || "-";
      rows.set(sku, (rows.get(sku) ?? 0) + (line.quantity || 0));
    });
  }

  return Array.from(rows.entries())
    .filter(([, quantity]) => quantity > 0)
    .map(([sku, quantity]) => ({ sku, quantity }))
    .sort((left, right) => left.sku.localeCompare(right.sku));
}

function FlowNodeContent({
  icon,
  eyebrow,
  title,
  lines = []
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  lines?: string[];
}) {
  return (
    <div className="grid h-full min-w-0 content-center gap-3 overflow-hidden">
      <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">{icon}</span>
        <span className="min-w-0 truncate">{eyebrow}</span>
      </div>
      <div className="line-clamp-2 text-base font-semibold leading-5 text-slate-950" title={title}>{title}</div>
      {lines.length > 0 ? (
        <div className="grid gap-0.5 text-[11px] font-medium leading-3 text-slate-600">
          {lines.filter(Boolean).slice(0, 2).map((line) => (
            <div key={line} className="truncate" title={line}>{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InventoryFlowNodeContent({
  icon,
  eyebrow,
  quantity,
  referenceQuantity,
  warehouseLabel,
  warehouseSummary
}: {
  icon: ReactNode;
  eyebrow: string;
  quantity: number;
  referenceQuantity: number;
  warehouseLabel: string;
  warehouseSummary: string;
}) {
  return (
    <div className="grid h-full min-w-0 grid-rows-[auto_1fr_auto] gap-2 overflow-hidden">
      <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700">{icon}</span>
        <span className="min-w-0 truncate">{eyebrow}</span>
      </div>
      <div className="flex min-w-0 items-center rounded-md bg-white/70 px-2 py-1.5">
        <span className="truncate text-xl font-bold tabular-nums text-slate-950">
          {formatNumber(quantity)} / {formatNumber(referenceQuantity)}
        </span>
      </div>
      <div className="truncate text-[11px] font-medium leading-3 text-slate-600" title={`${warehouseLabel}: ${warehouseSummary}`}>
        {warehouseLabel}: {warehouseSummary}
      </div>
    </div>
  );
}

function InboundFlowNodeContent({
  icon,
  eyebrow,
  palletCount,
  skuCount,
  quantity,
  discrepancyKind,
  receivedAt,
  documentSummary,
  t
}: {
  icon: ReactNode;
  eyebrow: string;
  palletCount: number;
  skuCount: number;
  quantity: number;
  discrepancyKind: InboundDiscrepancyKind;
  receivedAt: string;
  documentSummary?: string;
  t: (key: string) => string;
}) {
  return (
    <div className="grid h-full min-w-0 grid-rows-[auto_1fr_auto] gap-2 overflow-hidden">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700">{icon}</span>
          <span className="min-w-0 truncate">{eyebrow}</span>
        </div>
        <Badge variant={getInboundDiscrepancyBadgeVariant(discrepancyKind)} className="shrink-0 px-2 py-0 text-[10px] leading-4">
          {discrepancyKind === "none" ? t("inboundNoDiscrepancyStatus") : t("inboundHasDiscrepancyStatus")}
        </Badge>
      </div>
      <div className="grid min-w-0 content-center gap-1 rounded-md bg-white/70 px-2 py-1 text-[10px] leading-3">
        <InboundMetric label={t("skuCount")} value={formatNumber(skuCount)} />
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <InboundCompactMetric label={t("pallets")} value={formatNumber(palletCount)} />
          <InboundCompactMetric label={t("received")} value={formatNumber(quantity)} />
        </div>
      </div>
      <div className="grid gap-0.5 text-[11px] font-medium leading-3 text-slate-600">
        <div className="truncate" title={receivedAt}>{t("containerReceivedAt")}: {receivedAt}</div>
        {documentSummary ? <div className="truncate" title={documentSummary}>{documentSummary}</div> : null}
      </div>
    </div>
  );
}

function InboundMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-1.5">
      <span className="min-w-0 truncate font-semibold uppercase text-emerald-700" title={label}>{label}</span>
      <span className="shrink-0 font-bold tabular-nums text-slate-950">{value}</span>
    </div>
  );
}

function InboundCompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-1">
      <span className="min-w-0 truncate font-semibold uppercase text-slate-500" title={label}>{label}</span>
      <span className="shrink-0 font-bold tabular-nums text-slate-950">{value}</span>
    </div>
  );
}

function getFlowNodeStyle(variant: LifecycleNodeVariant, interactive: boolean, selected: boolean) {
  const shared = {
    borderRadius: 12,
    padding: 0,
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
    case "danger":
      return { ...shared, background: "#fef2f2", border: selected ? shared.border : "1px solid #fecaca" };
    case "done":
      return { ...shared, background: "#f8fafc", border: selected ? shared.border : "1px solid #cbd5e1" };
    default:
      return { ...shared, background: "#ffffff" };
  }
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

function getOutboundContainerQuantity(document: OutboundDocument, containerNo: string, containerId?: number | null) {
  const normalizedContainerNo = normalizeContainerNo(containerNo);
  const normalizedContainerId = containerId && containerId > 0 ? containerId : 0;
  return (document.lines ?? []).reduce((total, line) => (
    total + (line.pickAllocations ?? [])
      .filter((allocation) => outboundAllocationMatchesContainer(allocation, normalizedContainerId, normalizedContainerNo))
      .reduce((lineTotal, allocation) => lineTotal + allocation.allocatedQty, 0)
  ), 0);
}

function outboundAllocationMatchesContainer(allocation: { containerId?: number; containerNo?: string }, containerId: number, containerNo: string) {
  if (containerId > 0) {
    return Boolean(allocation.containerId && allocation.containerId > 0 && allocation.containerId === containerId);
  }
  return containerNo !== "" && normalizeContainerNo(allocation.containerNo) === containerNo;
}

function formatLifecycleDocumentRefs(refs: string[]) {
  const uniqueRefs = Array.from(new Set(refs.map((ref) => ref.trim()).filter(Boolean)));
  if (uniqueRefs.length === 0) {
    return "";
  }
  const visibleRefs = uniqueRefs.slice(0, 2);
  const remainingCount = uniqueRefs.length - visibleRefs.length;
  return remainingCount > 0 ? `${visibleRefs.join(", ")} +${remainingCount}` : visibleRefs.join(", ");
}

export function getInboundPalletCount(lifecycle: Pick<CustomerPortalContainerLifecycle, "packingLists" | "summary">) {
  const linePalletCount = (lifecycle.packingLists ?? []).reduce((documentTotal, document) => (
    documentTotal + (document.lines ?? []).reduce((lineTotal, line) => lineTotal + (line.pallets || 0), 0)
  ), 0);
  return linePalletCount || lifecycle.summary.palletCount || 0;
}

export function getInboundSkuCount(lifecycle: Pick<CustomerPortalContainerLifecycle, "packingLists">) {
  const skus = new Set<string>();
  (lifecycle.packingLists ?? []).forEach((document) => {
    (document.lines ?? []).forEach((line) => {
      const sku = String(line.sku || "").trim();
      if (sku) {
        skus.add(sku.toUpperCase());
      }
    });
  });
  return skus.size;
}

export function getInboundExpectedQty(lifecycle: Pick<CustomerPortalContainerLifecycle, "packingLists" | "summary">) {
  const lineExpectedQty = sumInboundLineQuantity(lifecycle.packingLists, "expectedQty");
  const documentExpectedQty = (lifecycle.packingLists ?? []).reduce((total, document) => total + (document.totalExpectedQty || 0), 0);
  return lineExpectedQty || lifecycle.summary.totalExpectedQty || documentExpectedQty || 0;
}

export function getInboundReceivedQty(lifecycle: Pick<CustomerPortalContainerLifecycle, "packingLists" | "summary">) {
  const lineReceivedQty = sumInboundLineQuantity(lifecycle.packingLists, "receivedQty");
  const documentReceivedQty = (lifecycle.packingLists ?? []).reduce((total, document) => total + (document.totalReceivedQty || 0), 0);
  return lineReceivedQty || lifecycle.summary.totalReceivedQty || documentReceivedQty || 0;
}

export function getInboundDiscrepancyKind(lifecycle: Pick<CustomerPortalContainerLifecycle, "packingLists" | "summary">): InboundDiscrepancyKind {
  const expectedQty = getInboundExpectedQty(lifecycle);
  const receivedQty = getInboundReceivedQty(lifecycle);
  if (expectedQty > 0 && receivedQty < expectedQty) {
    return "shortage";
  }
  if (expectedQty > 0 && receivedQty > expectedQty) {
    return "overage";
  }

  const noteText = getInboundDiscrepancyNoteText(lifecycle.packingLists);
  if (hasInboundDamageNote(noteText)) {
    return "damaged";
  }
  if (hasInboundShortageNote(noteText)) {
    return "shortage";
  }
  if (hasInboundOverageNote(noteText)) {
    return "overage";
  }
  return "none";
}

export function getInboundDiscrepancyReasons(
  lifecycle: Pick<CustomerPortalContainerLifecycle, "packingLists" | "summary">,
  t: (key: string) => string
) {
  const expectedQty = getInboundExpectedQty(lifecycle);
  const receivedQty = getInboundReceivedQty(lifecycle);
  const reasons = new Set<string>();

  if (expectedQty > 0 && receivedQty < expectedQty) {
    reasons.add(t("inboundDiscrepancyShortage"));
  } else if (expectedQty > 0 && receivedQty > expectedQty) {
    reasons.add(t("inboundDiscrepancyOverage"));
  }

  const noteText = getInboundDiscrepancyNoteText(lifecycle.packingLists);

  if (hasInboundDamageNote(noteText)) {
    reasons.add(t("inboundDiscrepancyDamaged"));
  }
  if (hasInboundShortageNote(noteText)) {
    reasons.add(t("inboundDiscrepancyShortage"));
  }
  if (hasInboundOverageNote(noteText)) {
    reasons.add(t("inboundDiscrepancyOverage"));
  }

  return Array.from(reasons).join(" / ");
}

function getInboundDiscrepancyNodeVariant(kind: InboundDiscrepancyKind): LifecycleNodeVariant {
  if (kind === "overage") {
    return "warning";
  }
  if (kind === "shortage" || kind === "damaged") {
    return "danger";
  }
  return "success";
}

export function getInboundDiscrepancyBadgeVariant(kind: InboundDiscrepancyKind): "success" | "warning" | "destructive" {
  if (kind === "overage") {
    return "warning";
  }
  if (kind === "shortage" || kind === "damaged") {
    return "destructive";
  }
  return "success";
}

function getInboundDiscrepancyNoteText(documents: CustomerPortalContainerLifecycle["packingLists"]) {
  return (documents ?? []).flatMap((document) => [
    document.documentNote,
    ...(document.lines ?? []).map((line) => line.lineNote)
  ]).filter(Boolean).join(" ");
}

function hasInboundDamageNote(noteText: string) {
  return /\b(damage|damaged|broken)\b|破损|损坏|残损|损毁/i.test(noteText);
}

function hasInboundShortageNote(noteText: string) {
  return /\b(short|shortage|missing)\b|缺货|少货|短收/i.test(noteText);
}

function hasInboundOverageNote(noteText: string) {
  return /\b(over|overage|extra)\b|多收|超收/i.test(noteText);
}

function sumInboundLineQuantity(
  documents: CustomerPortalContainerLifecycle["packingLists"],
  field: "expectedQty" | "receivedQty"
) {
  return (documents ?? []).reduce((documentTotal, document) => (
    documentTotal + (document.lines ?? []).reduce((lineTotal, line) => lineTotal + (line[field] || 0), 0)
  ), 0);
}

function normalizeContainerNo(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
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
