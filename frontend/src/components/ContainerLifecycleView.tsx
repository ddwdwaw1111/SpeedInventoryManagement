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
  type NodeProps
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
  Truck,
  Wrench
} from "lucide-react";
import { useMemo, type CSSProperties, type ReactNode } from "react";

import { formatNumber } from "../lib/formatters";
import { useI18n } from "../lib/i18n";
import type {
  ContainerLifecycle,
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
  | "documents"
  | "packing-list"
  | "receiving"
  | "inventory"
  | "transfer"
  | "rework"
  | "picking-order"
  | "delivery";

export type ContainerLifecycleNodeAction = {
  id: string;
  kind: ContainerLifecycleNodeKind;
  title: string;
  documentId?: number;
  outboundDocumentId?: number;
  deliveryEventId?: number;
  palletIds?: number[];
  attachedToNodeId?: string;
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
  pallets: CustomerPortalContainerLifecycle["pallets"];
  palletEvents: CustomerPortalContainerLifecycle["palletEvents"];
  trackingEvents: NonNullable<CustomerPortalContainerLifecycle["trackingEvents"]>;
  pickupAssignments: NonNullable<CustomerPortalContainerLifecycle["pickupAssignments"]>;
  reworkEvents: NonNullable<CustomerPortalContainerLifecycle["reworkEvents"]>;
  deliveryEvents: NonNullable<CustomerPortalContainerLifecycle["deliveryEvents"]>;
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
  documentActions
}: ContainerLifecycleViewProps) {
  const { t } = useI18n();
  const lifecycle = useMemo(
    () => rawLifecycle ? normalizeContainerLifecycle(rawLifecycle) : null,
    [rawLifecycle]
  );
  const flowModel = useMemo(
    () => lifecycle ? buildLifecycleFlow(lifecycle, t, Boolean(onNodeSelect), selectedNodeId ?? null, visibilityMode) : { nodes: [], edges: [] },
    [lifecycle, onNodeSelect, selectedNodeId, t, visibilityMode]
  );
  const interactiveFlow = Boolean(onNodeSelect);
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
                <div className="h-[calc(100vh-2rem)] min-h-[720px] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  <ReactFlow
                    nodes={flowModel.nodes}
                    edges={flowModel.edges}
                    nodeTypes={LIFECYCLE_NODE_TYPES}
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
  const DOCUMENT_BRANCH_GAP = 175;
  const DOCUMENT_NODE_X_GAP = 270;
  const DOCUMENT_NODE_ROW_GAP = 150;
  const DOCUMENT_NODE_COLUMNS = 3;
  const nodes: LifecycleNode[] = [];
  const edges: Edge[] = [];
  const nodePositions: Record<string, { x: number; y: number }> = {};
  const trackingEvents = filterLifecycleDisplayEvents(lifecycle.trackingEvents ?? [], visibilityMode);
  const pickupAssignments = filterLifecycleDisplayEvents(lifecycle.pickupAssignments ?? [], visibilityMode);
  const reworkEvents = filterLifecycleDisplayEvents(lifecycle.reworkEvents ?? [], visibilityMode);
  const deliveryEvents = filterLifecycleDisplayEvents(lifecycle.deliveryEvents ?? [], visibilityMode);
  const reworkPalletIds = collectReworkPalletIds(reworkEvents);
  let edgeSequence = 0;
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
  const addReworkNode = (id: string, x: number, y: number) => {
    const reworkSummary = formatPalletReworkSummary(reworkEvents[0], lifecycle.pallets.length, t);
    addNode(id, x, y, {
      id,
      kind: "rework",
      title: t("containerLifecycleReworkNode"),
      palletIds: reworkPalletIds
    }, (
      <FlowNodeContent
        icon={<Wrench className="h-4 w-4" />}
        eyebrow={t("containerLifecycleReworkNode")}
        title={reworkSummary}
        lines={[]}
      />
    ), "warning");
  };

  const shouldShowContainerNode = interactive || Boolean(lifecycle.container) || trackingEvents.length > 0 || pickupAssignments.length > 0;
  const shouldShowTrackingNode = interactive || trackingEvents.length > 0;
  const shouldShowPickupNode = interactive || pickupAssignments.length > 0;
  const shouldShowReworkNode = reworkEvents.length > 0;
  const pickingOrderRefs = lifecycle.pickingOrders.length > 0
    ? lifecycle.pickingOrders.map((document) => document.packingListNo || document.orderRef || `#${document.id}`)
    : lifecycle.summary.pickingOrderRefs;
  const hasPickingOrders = pickingOrderRefs.length > 0;
  const visibleOrderRefs = hasPickingOrders ? pickingOrderRefs.slice(0, 5) : [];
  const firstPickingDocument = lifecycle.pickingOrders[0];
  const mainSteps: LifecycleFlowStep[] = [];
  const selectedAnchorNodeId = getSelectedDocumentAnchorNodeId(selectedNodeId);

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

  const receivedPalletCount = getInboundPalletCount(lifecycle);
  const receivedSkuCount = getInboundSkuCount(lifecycle);
  const receivedQuantity = getInboundReceivedQty(lifecycle);
  const inboundDiscrepancyKind = getInboundDiscrepancyKind(lifecycle);
  const receivedAt = formatNullableDate(lifecycle.summary.firstReceivedAt);
  const inventoryWarehouses = getCurrentInventoryWarehouses(lifecycle);
  const inventoryWarehouseSummary = formatWarehouseSummary(inventoryWarehouses);
  const inventoryReferenceQty = getInventoryReferenceQty(lifecycle, receivedQuantity);
  const transferMovements = getTransferMovements(lifecycle.movements);
  const transferCount = getTransferCount(lifecycle.summary.transferCount, transferMovements);
  const transferRouteSummary = formatTransferRouteSummary(transferMovements);
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
      t={t}
    />
    )
  });

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
  const shouldShowInlineReworkNode = Boolean(inventoryPosition && shouldShowReworkNode);
  const reworkTargetPickingIndex = shouldShowInlineReworkNode
    ? findReworkTargetPickingOrderIndex(lifecycle.pickingOrders, reworkPalletIds, visibleOrderRefs.length)
    : -1;
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
    const reworkNodeID = `rework-${documentIndex}`;
    const isReworkTarget = shouldShowInlineReworkNode && documentIndex === reworkTargetPickingIndex;
    const nodeTitle = formatOutboundNodeTitle(document, ref, lifecycle.summary.containerNo);
    if (isReworkTarget) {
      const reworkSourcePosition = nodePositions[transferSourceNodeId] ?? inventoryPosition!;
      addReworkNode(reworkNodeID, Math.round((reworkSourcePosition.x + outboundX) / 2), rowY);
    }
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
    if (isReworkTarget) {
      addEdge(transferSourceNodeId, reworkNodeID, t("containerLifecycleReworked"));
      addEdge(reworkNodeID, nodeID);
    } else {
      addEdge(transferSourceNodeId, nodeID);
    }
    addEdge(nodeID, deliveryNodeID);
  });

  if (shouldShowInlineReworkNode && visibleOrderRefs.length === 0) {
    const reworkNodeID = "rework-0";
    addReworkNode(reworkNodeID, outboundX, MAIN_Y);
    addEdge("inventory", reworkNodeID, t("containerLifecycleReworked"));
  }

  if (lifecycle.packingLists.length > 0 && nodePositions.received) {
    const anchorPosition = nodePositions.received;
    lifecycle.packingLists.forEach((document, index) => {
      const documentNode = buildPackingListDocumentNodeAction(document, t);
      const rowIndex = Math.floor(index / DOCUMENT_NODE_COLUMNS);
      const columnIndex = index % DOCUMENT_NODE_COLUMNS;
      const columnsInRow = Math.min(DOCUMENT_NODE_COLUMNS, lifecycle.packingLists.length - rowIndex * DOCUMENT_NODE_COLUMNS);
      const documentNodeId = `documents-received-${document.id}`;
      const x = anchorPosition.x + (columnIndex - (columnsInRow - 1) / 2) * DOCUMENT_NODE_X_GAP;
      const y = anchorPosition.y + DOCUMENT_BRANCH_GAP + rowIndex * DOCUMENT_NODE_ROW_GAP;
      addNode(documentNodeId, x, y, {
        ...documentNode.action,
        id: documentNodeId,
        attachedToNodeId: "received"
      }, documentNode.label, "default");
      addEdge("received", documentNodeId, index === 0 ? t("customerPortalPackingListSource") : undefined, "vertical-down");
    });
  }

  if (interactive && selectedAnchorNodeId && selectedAnchorNodeId !== "received" && nodePositions[selectedAnchorNodeId]) {
    const documentNode = buildAttachedDocumentNodeAction(
      selectedAnchorNodeId,
      lifecycle,
      firstPickingDocument,
      t
    );
    if (documentNode) {
      const anchorPosition = nodePositions[selectedAnchorNodeId];
      const documentNodeId = `documents-${selectedAnchorNodeId}`;
      addNode(documentNodeId, anchorPosition.x, anchorPosition.y + DOCUMENT_BRANCH_GAP, {
        ...documentNode.action,
        id: documentNodeId,
        attachedToNodeId: selectedAnchorNodeId
      }, documentNode.label, "default");
      addEdge(selectedAnchorNodeId, documentNodeId, t("customerPortalLifecycleDocuments"), "vertical-down");
    }
  }

  return { nodes, edges };
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

function getSelectedDocumentAnchorNodeId(selectedNodeId: string | null) {
  if (!selectedNodeId) {
    return "";
  }
  if (selectedNodeId.startsWith("documents-received")) {
    return "received";
  }
  return selectedNodeId.startsWith("documents-")
    ? selectedNodeId.slice("documents-".length)
    : selectedNodeId;
}

function collectReworkPalletIds(reworkEvents: NonNullable<CustomerPortalContainerLifecycle["reworkEvents"]>) {
  return Array.from(
    new Set(
      reworkEvents.flatMap((event) => (event.pallets ?? []).map((pallet) => pallet.palletId))
    )
  );
}

function findReworkTargetPickingOrderIndex(
  outboundDocuments: OutboundDocument[],
  reworkPalletIds: number[],
  visibleOutboundCount: number
) {
  if (visibleOutboundCount === 0) {
    return -1;
  }
  if (outboundDocuments.length === 0 || reworkPalletIds.length === 0) {
    return 0;
  }
  const reworkPalletIdSet = new Set(reworkPalletIds);
  const matchedIndex = outboundDocuments.findIndex((document) =>
    (document.lines ?? []).some((line) =>
      (line.pickPallets ?? []).some((pick) => reworkPalletIdSet.has(pick.palletId))
    )
  );
  return matchedIndex >= 0 && matchedIndex < visibleOutboundCount ? matchedIndex : 0;
}

function formatPalletReworkSummary(
  event: NonNullable<CustomerPortalContainerLifecycle["reworkEvents"]>[number] | undefined,
  fallbackPalletCount: number,
  t: (key: string, params?: Record<string, string | number>) => string
) {
  const pallets = event?.pallets ?? [];
  const sourceCount = countUniqueReworkPalletsByRole(pallets, "SOURCE");
  const targetCount = countUniqueReworkPalletsByRole(pallets, "TARGET");
  const relatedCount = countUniqueReworkPalletsByRole(pallets, "RELATED");
  const fromCount = sourceCount || relatedCount || targetCount || fallbackPalletCount || 0;
  const toCount = targetCount || relatedCount || fromCount;
  return t("containerLifecycleReworkPalletSummary", {
    from: formatPalletCount(fromCount, t),
    to: formatPalletCount(toCount, t)
  });
}

function countUniqueReworkPalletsByRole(
  pallets: NonNullable<CustomerPortalContainerLifecycle["reworkEvents"]>[number]["pallets"],
  role: string
) {
  return new Set(pallets.filter((pallet) => pallet.role === role).map((pallet) => pallet.palletId)).size;
}

function formatPalletCount(count: number, t: (key: string) => string) {
  return `${count} ${count === 1 ? t("palletUnit") : t("palletUnits")}`;
}

function getCurrentInventoryWarehouses(lifecycle: CustomerPortalContainerLifecycle) {
  if ((lifecycle.summary.currentQty ?? 0) <= 0) {
    return [];
  }
  const names = new Set<string>();
  (lifecycle.summary.warehouses ?? []).forEach((warehouse) => addNonEmptyText(names, warehouse));
  (lifecycle.pallets ?? []).forEach((pallet) => addNonEmptyText(names, pallet.currentLocationName));
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
  containerNo: string
) {
  if (!document) {
    return fallbackRef;
  }
  const reference = document.packingListNo || document.orderRef || fallbackRef || `#${document.id}`;
  const goodsSummary = formatOutboundContainerGoodsSummary(document, containerNo);
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

function formatOutboundContainerGoodsSummary(document: OutboundDocument, containerNo: string) {
  const rows = getOutboundContainerGoodsRows(document, containerNo);
  if (rows.length === 0) {
    return "";
  }
  const visibleRows = rows.slice(0, 2).map((row) => `${row.sku} ${formatNumber(row.quantity)}`);
  const remainingCount = rows.length - visibleRows.length;
  return remainingCount > 0 ? `${visibleRows.join(", ")} +${remainingCount}` : visibleRows.join(", ");
}

function getOutboundContainerGoodsRows(document: OutboundDocument, containerNo: string) {
  const normalizedContainerNo = normalizeContainerNo(containerNo);
  const rows = new Map<string, number>();
  let hasAnyPickAllocation = false;

  (document.lines ?? []).forEach((line) => {
    const sku = line.sku || line.itemNumber || "-";
    (line.pickAllocations ?? []).forEach((allocation) => {
      hasAnyPickAllocation = true;
      if (normalizeContainerNo(allocation.containerNo) !== normalizedContainerNo) {
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

function buildAttachedDocumentNodeAction(
  anchorNodeId: string,
  lifecycle: CustomerPortalContainerLifecycle,
  firstPickingDocument: OutboundDocument | undefined,
  t: (key: string) => string
): { action: ContainerLifecycleNodeAction; label: ReactNode } | null {
  const outboundDocument = resolveOutboundDocumentForAnchor(anchorNodeId, lifecycle, firstPickingDocument);
  if (outboundDocument) {
    const attachmentCount = outboundDocument.attachments?.length ?? 0;
    return {
      action: {
        id: "",
        kind: "documents",
        title: t("customerPortalLifecycleDocuments"),
        outboundDocumentId: outboundDocument.id
      },
      label: (
        <FlowNodeContent
          icon={<ClipboardList className="h-4 w-4" />}
          eyebrow={t("customerPortalLifecycleDocuments")}
          title={outboundDocument.packingListNo || outboundDocument.orderRef || `#${outboundDocument.id}`}
          lines={[
            t("customerPortalPickingOrders"),
            `${attachmentCount} ${t("files")}`
          ]}
        />
      )
    };
  }

  return null;
}

function buildPackingListDocumentNodeAction(
  document: InboundDocument,
  t: (key: string) => string
): { action: ContainerLifecycleNodeAction; label: ReactNode } {
  const attachmentCount = document.attachments?.length ?? 0;
  return {
    action: {
      id: "",
      kind: "documents",
      title: t("customerPortalLifecycleDocuments"),
      documentId: document.id
    },
    label: (
      <FlowNodeContent
        icon={<ClipboardList className="h-4 w-4" />}
        eyebrow={t("customerPortalLifecycleDocuments")}
        title={t("customerPortalPackingListSource")}
        lines={[
          document.containerNo || `#${document.id}`,
          `${attachmentCount} ${t("files")}`
        ]}
      />
    )
  };
}

function resolveOutboundDocumentForAnchor(
  anchorNodeId: string,
  lifecycle: CustomerPortalContainerLifecycle,
  firstPickingDocument: OutboundDocument | undefined
) {
  if (anchorNodeId.startsWith("picking-")) {
    const index = Number(anchorNodeId.replace("picking-", ""));
    return Number.isFinite(index) ? lifecycle.pickingOrders[index] : firstPickingDocument;
  }
  if (anchorNodeId.startsWith("delivery-")) {
    const index = Number(anchorNodeId.replace("delivery-", ""));
    return Number.isFinite(index) ? lifecycle.pickingOrders[index] : firstPickingDocument;
  }
  return null;
}

function FlowNodeContent({
  icon,
  eyebrow,
  title
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
  t
}: {
  icon: ReactNode;
  eyebrow: string;
  palletCount: number;
  skuCount: number;
  quantity: number;
  discrepancyKind: InboundDiscrepancyKind;
  receivedAt: string;
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
      <div className="truncate text-[11px] font-medium leading-3 text-slate-600" title={receivedAt}>
        {t("containerReceivedAt")}: {receivedAt}
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

function getOutboundContainerQuantity(document: OutboundDocument, containerNo: string) {
  const normalizedContainerNo = normalizeContainerNo(containerNo);
  return (document.lines ?? []).reduce((total, line) => (
    total + (line.pickAllocations ?? [])
      .filter((allocation) => normalizeContainerNo(allocation.containerNo) === normalizedContainerNo)
      .reduce((lineTotal, allocation) => lineTotal + allocation.allocatedQty, 0)
  ), 0);
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
