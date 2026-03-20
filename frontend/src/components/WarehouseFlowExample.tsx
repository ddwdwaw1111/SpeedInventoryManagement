import CloseIcon from "@mui/icons-material/Close";
import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  type NodeMouseHandler,
  ReactFlow,
  useNodesState
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { Item, Location } from "../lib/types";

type WarehouseFlowExampleProps = {
  locations: Location[];
  items: Item[];
};

type WarehouseDetailRow = {
  id: string;
  sku: string;
  customerName: string;
  quantity: number;
  locationName: string;
  sectionName: string;
};

type FlowData = {
  label: ReactNode;
  detailsTitle?: string;
  detailsSubtitle?: string;
  detailRows?: WarehouseDetailRow[];
};

type SubZone = {
  name: string;
  label: string;
  shortLabel: string;
  totalUnits: number;
  items: Item[];
};

const numberFormatter = new Intl.NumberFormat("en-US");
const STORAGE_LAYOUT_KEY = "sim-warehouse-flow-layout-v1";

export function WarehouseFlowExample({ locations, items }: WarehouseFlowExampleProps) {
  const { nodes: initialNodes, edges } = useMemo(() => buildWarehouseMap(locations, items), [items, locations]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [activeDetails, setActiveDetails] = useState<FlowData | null>(null);

  useEffect(() => {
    const savedLayout = loadSavedLayout();
    setNodes(applySavedLayout(initialNodes, savedLayout));
  }, [initialNodes, setNodes]);

  useEffect(() => {
    saveLayout(nodes);
  }, [nodes]);

  const handleNodeClick: NodeMouseHandler<Node<FlowData>> = (_, node) => {
    if (!node.data.detailRows || node.data.detailRows.length === 0) {
      return;
    }

    setActiveDetails(node.data);
  };

  if (nodes.length === 0) {
    return <div className="empty-state">No storage layout available yet.</div>;
  }

  return (
    <div className="warehouse-flow warehouse-flow--map">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        minZoom={0.4}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
      >
        <MiniMap pannable zoomable nodeColor={(node) => resolveMiniMapColor(node.id)} />
        <Controls showInteractive={false} />
        <Background gap={28} size={1} color="rgba(16, 32, 51, 0.08)" />
      </ReactFlow>

      <Dialog
        open={Boolean(activeDetails)}
        onClose={() => setActiveDetails(null)}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {activeDetails?.detailsTitle ?? "Inventory details"}
          {activeDetails?.detailsSubtitle ? (
            <span className="warehouse-flow-dialog__subtitle">{activeDetails.detailsSubtitle}</span>
          ) : null}
          <IconButton aria-label="close" onClick={() => setActiveDetails(null)} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {activeDetails?.detailRows?.length ? (
            <div className="sheet-table-wrap warehouse-flow-dialog__table-wrap">
              <table className="sheet-table warehouse-flow-dialog__table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Customer</th>
                    <th>Quantity</th>
                    <th>Warehouse</th>
                    <th>Section</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDetails.detailRows.map((row) => (
                    <tr key={row.id}>
                      <td className="cell--mono">{row.sku}</td>
                      <td>{row.customerName}</td>
                      <td className="cell--mono">{numberFormatter.format(row.quantity)}</td>
                      <td>{row.locationName}</td>
                      <td>{row.sectionName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">No SKU data in this area.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function buildWarehouseMap(locations: Location[], items: Item[]): { nodes: Array<Node<FlowData>>; edges: Edge[] } {
  const nodes: Array<Node<FlowData>> = [];
  const visibleLocations = locations.slice(0, 4);

  visibleLocations.forEach((location, locationIndex) => {
    const locationItems = items.filter((item) => item.locationId === location.id);
    const sectionNames = Array.from(new Set([
      ...location.sectionNames.filter(Boolean),
      ...locationItems.map((item) => item.storageSection || "A")
    ])).sort((left, right) => left.localeCompare(right));

    const sectionRows = Math.max(Math.ceil(Math.max(sectionNames.length, 1) / 2), 1);
    const locationWidth = 560;
    const locationHeight = Math.max(360, 120 + sectionRows * 188);
    const locationNodeID = `location-${location.id}`;
    const baseX = (locationIndex % 2) * 620;
    const baseY = Math.floor(locationIndex / 2) * 520;

    nodes.push({
      id: locationNodeID,
      position: { x: baseX, y: baseY },
      draggable: false,
      style: {
        width: locationWidth,
        height: locationHeight,
        borderRadius: 28,
        border: "1px solid rgba(16, 32, 51, 0.1)",
        padding: 18
      },
      className: "warehouse-flow__node-shell warehouse-flow__node-shell--location warehouse-flow__node-shell--map-location",
      data: {
        label: (
          <div className="warehouse-flow-node warehouse-flow-node--location">
            <div className="warehouse-flow-node__eyebrow">
              <WarehouseOutlinedIcon fontSize="inherit" />
              <span>Warehouse</span>
            </div>
            <strong>{location.name}</strong>
            <span>{location.zone}</span>
            <small>
              {numberFormatter.format(locationItems.reduce((sum, item) => sum + item.quantity, 0))} units
              {" · "}
              {numberFormatter.format(locationItems.length)} SKU
            </small>
          </div>
        ),
        detailsTitle: location.name,
        detailsSubtitle: `${location.zone} · Warehouse summary`,
        detailRows: locationItems.map((item) => ({
          id: `location-${location.id}-item-${item.id}`,
          sku: item.sku,
          customerName: item.customerName,
          quantity: item.quantity,
          locationName: item.locationName,
          sectionName: item.storageSection || "A"
        }))
      }
    });

    sectionNames.forEach((sectionName, sectionIndex) => {
      const sectionItems = locationItems
        .filter((item) => (item.storageSection || "A") === sectionName)
        .sort((left, right) => right.quantity - left.quantity);

      const sectionNodeID = `${locationNodeID}-section-${sectionName}`;
      const sectionColumn = sectionIndex % 2;
      const sectionRow = Math.floor(sectionIndex / 2);
      const subZones = createSubZones(sectionItems, sectionName);
      const subZoneRows = Math.max(Math.ceil(subZones.length / 2), 1);
      const sectionHeight = Math.max(168, 78 + subZoneRows * 58);

      nodes.push({
        id: sectionNodeID,
        parentId: locationNodeID,
        extent: "parent",
        draggable: true,
        position: {
          x: 18 + sectionColumn * 262,
          y: 92 + sectionRow * 176
        },
        style: {
          width: 246,
          height: sectionHeight,
          borderRadius: 22,
          padding: 12
        },
        className: `warehouse-flow__node-shell warehouse-flow__node-shell--section warehouse-flow__node-shell--map-section${sectionItems.length === 0 ? " warehouse-flow__node-shell--empty" : ""}`,
        data: {
          label: (
            <div className="warehouse-flow-node warehouse-flow-node--section">
              <div className="warehouse-flow-node__eyebrow">
                <GridViewOutlinedIcon fontSize="inherit" />
                <span>Section</span>
              </div>
              <strong>{sectionName}</strong>
              <span>{numberFormatter.format(sectionItems.length)} SKU</span>
              <small>{numberFormatter.format(sectionItems.reduce((sum, item) => sum + item.quantity, 0))} units</small>
            </div>
          ),
          detailsTitle: `${location.name} / Section ${sectionName}`,
          detailsSubtitle: `${numberFormatter.format(sectionItems.length)} SKU in this section`,
          detailRows: sectionItems.map((item) => ({
            id: `section-${sectionNodeID}-item-${item.id}`,
            sku: item.sku,
            customerName: item.customerName,
            quantity: item.quantity,
            locationName: item.locationName,
            sectionName: item.storageSection || sectionName
          }))
        }
      });

      subZones.forEach((subZone, subZoneIndex) => {
        const subZoneColumn = subZoneIndex % 2;
        const subZoneRow = Math.floor(subZoneIndex / 2);
        const subZoneID = `${sectionNodeID}-bin-${subZoneIndex + 1}`;

        nodes.push({
          id: subZoneID,
          parentId: sectionNodeID,
          extent: "parent",
          draggable: true,
          position: {
            x: 12 + subZoneColumn * 110,
            y: 58 + subZoneRow * 50
          },
          style: {
            width: 104,
            height: 42,
            borderRadius: 14,
            padding: 8
          },
          className: `warehouse-flow__node-shell warehouse-flow__node-shell--bin warehouse-flow__node-shell--map-bin${subZone.totalUnits === 0 ? " warehouse-flow__node-shell--empty" : ""}`,
          data: {
            label: (
              <div className="warehouse-flow-node warehouse-flow-node--bin">
                <div className="warehouse-flow-node__row">
                  <strong>{subZone.name}</strong>
                  <span className="warehouse-flow-node__dot" />
                </div>
                <span className="warehouse-flow-node__bin-qty">
                  <Inventory2OutlinedIcon fontSize="inherit" />
                  {subZone.totalUnits > 0 ? numberFormatter.format(subZone.totalUnits) : "0"}
                </span>
                <small title={subZone.label}>{subZone.shortLabel}</small>
              </div>
            ),
            detailsTitle: `${location.name} / ${subZone.name}`,
            detailsSubtitle: `${numberFormatter.format(subZone.totalUnits)} units in this bin`,
            detailRows: subZone.items.map((item) => ({
              id: `bin-${subZoneID}-item-${item.id}`,
              sku: item.sku,
              customerName: item.customerName,
              quantity: item.quantity,
              locationName: item.locationName,
              sectionName: item.storageSection || sectionName
            }))
          }
        });
      });
    });
  });

  return { nodes, edges: [] };
}

function createSubZones(sectionItems: Item[], sectionName: string): SubZone[] {
  if (sectionItems.length === 0) {
    return [{ name: `${sectionName}-01`, label: "No stock assigned", shortLabel: "Empty", totalUnits: 0, items: [] }];
  }

  const buckets = [sectionItems.slice(0, 2), sectionItems.slice(2, 4), sectionItems.slice(4, 6), sectionItems.slice(6, 8)]
    .filter((bucket) => bucket.length > 0);

  return buckets.map((bucket, index) => ({
    name: `${sectionName}-${`${index + 1}`.padStart(2, "0")}`,
    label: bucket.map((item) => `${item.sku} (${numberFormatter.format(item.quantity)})`).join(" | "),
    shortLabel: bucket.map((item) => item.sku).join(", "),
    totalUnits: bucket.reduce((sum, item) => sum + item.quantity, 0),
    items: bucket
  }));
}

function resolveMiniMapColor(nodeID: string) {
  if (nodeID.includes("-bin-")) return "rgba(34, 113, 74, 0.6)";
  if (nodeID.includes("-section-")) return "rgba(31, 110, 175, 0.7)";
  return "rgba(16, 32, 51, 0.85)";
}

function saveLayout(nodes: Array<Node<FlowData>>) {
  const layout = nodes.map((node) => ({
    id: node.id,
    position: node.position
  }));

  window.localStorage.setItem(STORAGE_LAYOUT_KEY, JSON.stringify(layout));
}

function loadSavedLayout(): Record<string, { x: number; y: number }> {
  try {
    const raw = window.localStorage.getItem(STORAGE_LAYOUT_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Array<{ id: string; position: { x: number; y: number } }>;
    return Object.fromEntries(parsed.map((entry) => [entry.id, entry.position]));
  } catch {
    return {};
  }
}

function applySavedLayout(nodes: Array<Node<FlowData>>, savedLayout: Record<string, { x: number; y: number }>) {
  return nodes.map((node) => {
    const savedPosition = savedLayout[node.id];
    if (!savedPosition || !node.draggable) {
      return node;
    }

    return {
      ...node,
      position: savedPosition
    };
  });
}
