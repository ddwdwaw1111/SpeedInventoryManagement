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
import { Container as ContainerIcon, Edit, FileText, PackageCheck, Repeat2, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { formatDateValue } from "../lib/dates";
import { formatOutboundTrackingStatusLabel, normalizeDocumentStatus } from "../lib/documentTracking";
import { formatNumber } from "../lib/formatters";
import { useI18n } from "../lib/i18n";
import { normalizeStorageSection, type OutboundDocument, type OutboundDocumentLine, type OutboundPickAllocation } from "../lib/types";
import { WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { TabsList, TabsTrigger } from "./ui/tabs";

type OutboundLifecyclePageProps = {
  outboundDocuments: OutboundDocument[];
  isLoading: boolean;
  routeDocumentId?: number | null;
  onOpenDocuments: () => void;
  onOpenShipmentEditor: (documentId?: number | null) => void;
};

type FulfillmentNodeTone = "document" | "sku" | "container" | "repack" | "warning";

type FulfillmentNodeData = {
  eyebrow: string;
  title: string;
  meta: string[];
  icon: ReactNode;
  tone: FulfillmentNodeTone;
};

type FulfillmentNode = Node<FulfillmentNodeData>;

type FulfillmentSummary = {
  requestedQty: number;
  allocatedQty: number;
  lineCount: number;
  containerCount: number;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "2-digit" });

const FULFILLMENT_NODE_TYPES = {
  fulfillment: FulfillmentFlowNode
};

const HANDLE_STYLE = {
  width: 10,
  height: 10,
  border: "2px solid #64748b",
  background: "#ffffff",
  zIndex: 3
};

export function OutboundLifecyclePage({
  outboundDocuments,
  isLoading,
  routeDocumentId,
  onOpenDocuments,
  onOpenShipmentEditor
}: OutboundLifecyclePageProps) {
  const { t } = useI18n();
  const [searchTerm, setSearchTerm] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(routeDocumentId ?? null);

  const visibleDocuments = useMemo(
    () => outboundDocuments.filter((document) => !document.archivedAt && normalizeDocumentStatus(document.status) !== "DELETED"),
    [outboundDocuments]
  );
  const customerOptions = useMemo(
    () => Array.from(new Map(visibleDocuments.map((document) => [document.customerId, document.customerName || String(document.customerId)]))).sort((left, right) => left[1].localeCompare(right[1])),
    [visibleDocuments]
  );
  const filteredDocuments = useMemo(
    () => visibleDocuments.filter((document) => {
      if (customerFilter !== "all" && String(document.customerId) !== customerFilter) {
        return false;
      }
      if (statusFilter !== "all" && normalizeDocumentStatus(document.status) !== statusFilter) {
        return false;
      }
      const query = searchTerm.trim().toLowerCase();
      if (!query) {
        return true;
      }
      const searchable = [
        document.packingListNo,
        document.orderRef,
        document.customerName,
        document.shipToName,
        document.storages,
        ...document.lines.flatMap((line) => [
          line.itemNumber,
          line.sku,
          line.description,
          ...line.pickAllocations.map((allocation) => allocation.containerNo)
        ])
      ].join(" ").toLowerCase();
      return searchable.includes(query);
    }),
    [customerFilter, searchTerm, statusFilter, visibleDocuments]
  );
  const selectedDocument = useMemo(
    () => filteredDocuments.find((document) => document.id === selectedDocumentId) ?? null,
    [filteredDocuments, selectedDocumentId]
  );
  const selectedSummary = useMemo(
    () => selectedDocument ? summarizeOutboundFulfillment(selectedDocument) : null,
    [selectedDocument]
  );
  const flowModel = useMemo(
    () => selectedDocument ? buildOutboundFulfillmentFlow(selectedDocument, t) : { nodes: [], edges: [] },
    [selectedDocument, t]
  );
  const selectedLineSummaries = useMemo(
    () => selectedDocument ? selectedDocument.lines.map((line) => ({
      line,
      allocatedQty: line.pickAllocations.reduce((sum, allocation) => sum + Math.max(0, allocation.allocatedQty || 0), 0),
      containers: Array.from(new Set(line.pickAllocations.map((allocation) => allocation.containerNo || "-"))).sort()
    })) : [],
    [selectedDocument]
  );

  useEffect(() => {
    if (routeDocumentId && filteredDocuments.some((document) => document.id === routeDocumentId)) {
      setSelectedDocumentId(routeDocumentId);
    }
  }, [filteredDocuments, routeDocumentId]);

  useEffect(() => {
    if (selectedDocumentId && filteredDocuments.some((document) => document.id === selectedDocumentId)) {
      return;
    }
    setSelectedDocumentId(filteredDocuments[0]?.id ?? null);
  }, [filteredDocuments, selectedDocumentId]);

  return (
    <main className="workspace-main">
      <section>
        <article className="workbook-panel workbook-panel--full">
          <div className="tab-strip">
            <WorkspacePanelHeader
              title={t("outboundLifecyclePage")}
              description={t("outboundLifecyclePageDesc")}
              actions={(
                <TabsList>
                  <TabsTrigger onClick={onOpenDocuments}>{t("outboundDocumentsTab")}</TabsTrigger>
                  <TabsTrigger active>{t("outboundLifecycleTab")}</TabsTrigger>
                </TabsList>
              )}
            />
            <div className="filter-bar">
              <label className="min-w-[260px]">
                {t("search")}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    className="pl-9"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder={t("searchOutboundPlaceholder")}
                  />
                </div>
              </label>
              <label>
                {t("customer")}
                <select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)}>
                  <option value="all">{t("allCustomers")}</option>
                  {customerOptions.map(([customerId, customerName]) => (
                    <option key={customerId} value={customerId}>{customerName}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("status")}
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">{t("allStatuses")}</option>
                  <option value="DRAFT">{t("draft")}</option>
                  <option value="CONFIRMED">{t("confirmed")}</option>
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="min-w-0 rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("outboundDocumentsTab")}</div>
                <div className="mt-1 text-sm text-slate-600">{formatNumber(filteredDocuments.length)} {t("documentsView")}</div>
              </div>
              <div className="max-h-[680px] overflow-auto p-2">
                {isLoading ? (
                  <div className="p-6 text-sm text-slate-500">{t("loadingRecords")}</div>
                ) : filteredDocuments.length === 0 ? (
                  <div className="p-6 text-sm text-slate-500">{t("outboundLifecycleNoDocuments")}</div>
                ) : (
                  filteredDocuments.map((document) => {
                    const documentSummary = summarizeOutboundFulfillment(document);
                    const isSelected = document.id === selectedDocumentId;
                    return (
                      <button
                        key={document.id}
                        type="button"
                        className={`w-full rounded-md border p-3 text-left transition ${
                          isSelected
                            ? "border-slate-950 bg-slate-950 text-white"
                            : "border-transparent bg-white text-slate-900 hover:border-slate-200 hover:bg-slate-50"
                        }`}
                        onClick={() => setSelectedDocumentId(document.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0 truncate font-mono text-sm font-semibold">
                            {document.packingListNo || document.orderRef || `#${document.id}`}
                          </span>
                          <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${isSelected ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"}`}>
                            {formatNumber(documentSummary.containerCount)}
                          </span>
                        </div>
                        <div className={`mt-1 truncate text-xs ${isSelected ? "text-slate-200" : "text-slate-500"}`}>
                          {document.customerName || "-"}
                        </div>
                        <div className={`mt-2 flex items-center justify-between text-xs ${isSelected ? "text-slate-200" : "text-slate-500"}`}>
                          <span>{formatNumber(documentSummary.lineCount)} SKU</span>
                          <span>{formatNumber(documentSummary.allocatedQty)} / {formatNumber(documentSummary.requestedQty)}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            <section className="min-w-0 space-y-4">
              {selectedDocument && selectedSummary ? (
                <>
                  <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-semibold text-slate-950">
                          {selectedDocument.packingListNo || selectedDocument.orderRef || `#${selectedDocument.id}`}
                        </h3>
                        <Badge variant="secondary">{formatOutboundTrackingStatusLabel(selectedDocument.trackingStatus, selectedDocument.status, t)}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {[selectedDocument.customerName, selectedDocument.orderRef, formatDate(selectedDocument.actualShipDate || selectedDocument.expectedShipDate)].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <Button type="button" variant="outline" onClick={() => onOpenShipmentEditor(selectedDocument.id)}>
                      <Edit className="h-4 w-4" />
                      {t("edit")}
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-4">
                    <SummaryCard label={t("outboundLifecycleRequestedQty")} value={formatNumber(selectedSummary.requestedQty)} />
                    <SummaryCard label={t("outboundLifecycleAllocatedQty")} value={formatNumber(selectedSummary.allocatedQty)} />
                    <SummaryCard label={t("outboundLifecycleSkuCount")} value={formatNumber(selectedSummary.lineCount)} />
                    <SummaryCard label={t("outboundLifecycleContainerCount")} value={formatNumber(selectedSummary.containerCount)} />
                  </div>

                  <div className="h-[calc(100vh-20rem)] min-h-[620px] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    <ReactFlow
                      nodes={flowModel.nodes}
                      edges={flowModel.edges}
                      nodeTypes={FULFILLMENT_NODE_TYPES}
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

                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-950">{t("outboundLifecycleSkuBreakdown")}</div>
                    <div className="overflow-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3">{t("sku")}</th>
                            <th className="px-4 py-3">{t("description")}</th>
                            <th className="px-4 py-3 text-right">{t("outQty")}</th>
                            <th className="px-4 py-3 text-right">{t("pickQty")}</th>
                            <th className="px-4 py-3">{t("sourceContainer")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedLineSummaries.map(({ line, allocatedQty, containers }) => (
                            <tr key={line.id}>
                              <td className="px-4 py-3 font-mono font-semibold text-slate-950">{line.sku || line.itemNumber || "-"}</td>
                              <td className="px-4 py-3 text-slate-600">{line.description || "-"}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatNumber(line.quantity)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatNumber(allocatedQty)}</td>
                              <td className="px-4 py-3 font-mono text-xs text-slate-600">{containers.join(", ") || t("outboundLifecycleUnallocated")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex min-h-[520px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                  <div>
                    <FileText className="mx-auto h-8 w-8 text-slate-400" />
                    <h3 className="mt-3 text-base font-semibold text-slate-950">{t("outboundLifecycleEmptyTitle")}</h3>
                    <p className="mt-1 max-w-md text-sm text-slate-500">{t("outboundLifecycleEmptyDesc")}</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        </article>
      </section>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{value}</div>
    </div>
  );
}

function buildOutboundFulfillmentFlow(
  document: OutboundDocument,
  t: (key: string, params?: Record<string, string | number>) => string
): { nodes: FulfillmentNode[]; edges: Edge[] } {
  const lineGap = 170;
  const containerGap = 145;
  const lineStartY = 80;
  const containerStartY = 40;
  const containerX = 0;
  const repackX = 320;
  const lineX = 640;
  const documentX = 970;
  const nodes: FulfillmentNode[] = [];
  const edges: Edge[] = [];
  const containerNodes = new Map<string, { id: string; allocation: OutboundPickAllocation; totalQty: number; skuCount: number }>();
  const unallocatedLines: OutboundDocumentLine[] = [];

  document.lines.forEach((line) => {
    if (line.pickAllocations.length === 0) {
      unallocatedLines.push(line);
    }
    line.pickAllocations.forEach((allocation) => {
      const key = buildAllocationContainerKey(allocation);
      const existing = containerNodes.get(key);
      if (existing) {
        existing.totalQty += Math.max(0, allocation.allocatedQty || 0);
        existing.skuCount += 1;
        return;
      }
      containerNodes.set(key, {
        id: `container-${containerNodes.size}`,
        allocation,
        totalQty: Math.max(0, allocation.allocatedQty || 0),
        skuCount: 1
      });
    });
  });

  Array.from(containerNodes.values())
    .sort((left, right) => (left.allocation.containerNo || "").localeCompare(right.allocation.containerNo || ""))
    .forEach((entry, index) => {
      nodes.push(createFlowNode({
        id: entry.id,
        x: containerX,
        y: containerStartY + index * containerGap,
        tone: "container",
        eyebrow: t("sourceContainer"),
        title: entry.allocation.containerNo || "-",
        icon: <ContainerIcon className="h-4 w-4" />,
        meta: [
          `${entry.allocation.locationName || "-"} / ${normalizeStorageSection(entry.allocation.storageSection)}`,
          `${formatNumber(entry.totalQty)} ${t("quantity")} · ${formatNumber(entry.skuCount)} SKU`
        ]
      }));
    });

  unallocatedLines.forEach((line, index) => {
    nodes.push(createFlowNode({
      id: `unallocated-${line.id}`,
      x: containerX,
      y: containerStartY + (containerNodes.size + index) * containerGap,
      tone: "warning",
      eyebrow: t("outboundLifecycleUnallocated"),
      title: line.sku || line.itemNumber || "-",
      icon: <PackageCheck className="h-4 w-4" />,
      meta: [`${formatNumber(line.quantity)} ${t("quantity")}`, t("outboundLifecycleNoPickAllocation")]
    }));
  });

  document.lines.forEach((line, index) => {
    const allocatedQty = line.pickAllocations.reduce((sum, allocation) => sum + Math.max(0, allocation.allocatedQty || 0), 0);
    const lineNodeId = `line-${line.id}`;
    nodes.push(createFlowNode({
      id: lineNodeId,
      x: lineX,
      y: lineStartY + index * lineGap,
      tone: allocatedQty >= line.quantity ? "sku" : "warning",
      eyebrow: t("sku"),
      title: line.sku || line.itemNumber || "-",
      icon: <PackageCheck className="h-4 w-4" />,
      meta: [
        line.description || "-",
        `${t("outQty")}: ${formatNumber(line.quantity)} · ${t("pickQty")}: ${formatNumber(allocatedQty)}`
      ]
    }));

    if (line.pickAllocations.length === 0) {
      edges.push(createFlowEdge(`edge-unallocated-${line.id}`, `unallocated-${line.id}`, lineNodeId, t("outboundLifecycleUnallocated")));
    } else {
      line.pickAllocations.forEach((allocation, allocationIndex) => {
        const containerNode = containerNodes.get(buildAllocationContainerKey(allocation));
        if (!containerNode) {
          return;
        }
        const sourcePallets = getAllocationSourcePallets(allocation);
        const targetPallets = getAllocationTargetPallets(allocation);
        if (sourcePallets > 0 && targetPallets > 0 && sourcePallets !== targetPallets) {
          const repackNodeId = `repack-${line.id}-${allocation.id || allocationIndex}`;
          const allocationOffset = (allocationIndex - (line.pickAllocations.length - 1) / 2) * 88;
          nodes.push(createFlowNode({
            id: repackNodeId,
            x: repackX,
            y: lineStartY + index * lineGap + allocationOffset,
            tone: "repack",
            eyebrow: t("outboundRepackNode"),
            title: `${formatNumber(sourcePallets)} -> ${formatNumber(targetPallets)} ${t("pallets")}`,
            icon: <Repeat2 className="h-4 w-4" />,
            meta: [
              allocation.containerNo || "-",
              `${formatNumber(allocation.allocatedQty)} ${t("quantity")}`
            ]
          }));
          edges.push(createFlowEdge(
            `edge-container-repack-${line.id}-${allocation.id || allocationIndex}`,
            containerNode.id,
            repackNodeId,
            `${formatNumber(sourcePallets)} ${t("pallets")}`
          ));
          edges.push(createFlowEdge(
            `edge-repack-line-${line.id}-${allocation.id || allocationIndex}`,
            repackNodeId,
            lineNodeId,
            `${formatNumber(targetPallets)} ${t("pallets")}`
          ));
          return;
        }
        edges.push(createFlowEdge(
          `edge-allocation-${line.id}-${allocation.id || edges.length}`,
          containerNode.id,
          lineNodeId,
          `${formatNumber(allocation.allocatedQty)}`
        ));
      });
    }
  });

  const documentY = Math.max(lineStartY, lineStartY + (Math.max(1, document.lines.length) - 1) * lineGap / 2);
  const documentNodeId = `document-${document.id}`;
  nodes.push(createFlowNode({
    id: documentNodeId,
    x: documentX,
    y: documentY,
    tone: "document",
    eyebrow: t("outboundLifecycleShipmentNode"),
    title: document.packingListNo || document.orderRef || `#${document.id}`,
    icon: <FileText className="h-4 w-4" />,
    meta: [
      document.customerName || "-",
      `${formatNumber(document.totalQty)} ${t("quantity")} · ${formatNumber(document.totalLines)} SKU`
    ]
  }));

  document.lines.forEach((line) => {
    edges.push(createFlowEdge(`edge-line-document-${line.id}`, `line-${line.id}`, documentNodeId, `${formatNumber(line.quantity)}`));
  });

  return { nodes, edges };
}

function createFlowNode({
  id,
  x,
  y,
  tone,
  eyebrow,
  title,
  icon,
  meta
}: {
  id: string;
  x: number;
  y: number;
  tone: FulfillmentNodeTone;
  eyebrow: string;
  title: string;
  icon: ReactNode;
  meta: string[];
}): FulfillmentNode {
  return {
    id,
    type: "fulfillment",
    position: { x, y },
    data: { eyebrow, title, icon, meta, tone },
    style: {
      width: 250,
      height: 128,
      borderRadius: 12,
      padding: 0,
      overflow: "hidden",
      border: getNodeBorder(tone),
      background: getNodeBackground(tone),
      boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)"
    }
  };
}

function createFlowEdge(id: string, source: string, target: string, label: string): Edge {
  return {
    id,
    source,
    target,
    sourceHandle: "right-source",
    targetHandle: "left-target",
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    label,
    labelBgPadding: [6, 4],
    labelBgBorderRadius: 6,
    style: { stroke: "#64748b", strokeWidth: 1.6 }
  };
}

function FulfillmentFlowNode({ data }: NodeProps<FulfillmentNode>) {
  return (
    <div className="relative h-full w-full">
      <Handle type="target" id="left-target" position={Position.Left} isConnectable={false} style={HANDLE_STYLE} />
      <Handle type="source" id="right-source" position={Position.Right} isConnectable={false} style={HANDLE_STYLE} />
      <div className="flex h-full flex-col gap-2 p-3.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/75 text-slate-700 shadow-sm">{data.icon}</span>
          <span>{data.eyebrow}</span>
        </div>
        <div className="truncate text-base font-semibold text-slate-950">{data.title}</div>
        <div className="space-y-1 text-xs text-slate-600">
          {data.meta.map((line, index) => (
            <div className="truncate" key={`${data.title}-${index}`}>{line}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function summarizeOutboundFulfillment(document: OutboundDocument): FulfillmentSummary {
  const allocations = document.lines.flatMap((line) => line.pickAllocations);
  return {
    requestedQty: document.lines.reduce((sum, line) => sum + Math.max(0, line.quantity || 0), 0),
    allocatedQty: allocations.reduce((sum, allocation) => sum + Math.max(0, allocation.allocatedQty || 0), 0),
    lineCount: document.lines.length,
    containerCount: new Set(allocations.map(buildAllocationContainerKey)).size
  };
}

function buildAllocationContainerKey(allocation: Pick<OutboundPickAllocation, "containerId" | "containerNo" | "locationId" | "storageSection">) {
  const containerKey = allocation.containerId && allocation.containerId > 0
    ? `id:${allocation.containerId}`
    : `no:${(allocation.containerNo || "").trim().toUpperCase()}`;
  return [
    containerKey,
    String(allocation.locationId || 0),
    normalizeStorageSection(allocation.storageSection)
  ].join("|");
}

function formatDate(value: string | null) {
  return formatDateValue(value, dateFormatter);
}

function getNodeBackground(tone: FulfillmentNodeTone) {
  switch (tone) {
    case "document":
      return "#f8fafc";
    case "sku":
      return "#f0fdf4";
    case "container":
      return "#eff6ff";
    case "repack":
      return "#fff7ed";
    case "warning":
      return "#fffbeb";
  }
}

function getNodeBorder(tone: FulfillmentNodeTone) {
  switch (tone) {
    case "document":
      return "1px solid #cbd5e1";
    case "sku":
      return "1px solid #bbf7d0";
    case "container":
      return "1px solid #bfdbfe";
    case "repack":
      return "1px solid #fed7aa";
    case "warning":
      return "1px solid #fde68a";
  }
}

function getAllocationSourcePallets(allocation: Pick<OutboundPickAllocation, "sourcePallets" | "pallets">) {
  return Math.max(0, allocation.sourcePallets ?? allocation.pallets ?? 0);
}

function getAllocationTargetPallets(allocation: Pick<OutboundPickAllocation, "targetPallets" | "pallets">) {
  return Math.max(0, allocation.targetPallets ?? allocation.pallets ?? 0);
}
