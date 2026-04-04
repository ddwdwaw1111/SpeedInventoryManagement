import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import { Button, MenuItem, TextField } from "@mui/material";
import { Canvas } from "@react-three/fiber";
import { Html, MapControls } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";

import { setPendingInventorySummaryContext } from "../lib/inventorySummaryContext";
import { useI18n } from "../lib/i18n";
import type { PageKey } from "../lib/routes";
import { normalizeStorageSection, type Item } from "../lib/types";
import { WorkspacePanelHeader } from "./WorkspacePanelChrome";

type WarehouseMapPageProps = {
  items: Item[];
  isLoading: boolean;
  onNavigate: (page: PageKey) => void;
  onOpenContainerDetail: (containerNo: string) => void;
};

type NodeStatus = "normal" | "low" | "hold" | "damaged" | "mixed";

type ContainerNode = {
  id: string;
  containerNo: string;
  warehouseId: number;
  warehouseName: string;
  sectionName: string;
  items: Item[];
  onHand: number;
  availableQty: number;
  damagedQty: number;
  holdQty: number;
  skuCount: number;
  status: NodeStatus;
};

type SectionNode = {
  id: string;
  warehouseId: number;
  warehouseName: string;
  sectionName: string;
  containers: ContainerNode[];
  onHand: number;
  availableQty: number;
  damagedQty: number;
  holdQty: number;
  skuCount: number;
  containerCount: number;
  status: NodeStatus;
};

type WarehouseNode = {
  id: string;
  warehouseId: number;
  warehouseName: string;
  sections: SectionNode[];
  containers: ContainerNode[];
  onHand: number;
  availableQty: number;
  damagedQty: number;
  holdQty: number;
  skuCount: number;
  sectionCount: number;
  containerCount: number;
  status: NodeStatus;
};

type SceneNode = {
  id: string;
  title: string;
  subtitle: string;
  quantity: number;
  skuCount: number;
  status: NodeStatus;
  width: number;
  depth: number;
  height: number;
  x: number;
  z: number;
};

type ContainerSkuSummary = {
  id: string;
  itemNumber: string;
  sku: string;
  description: string;
  rowCount: number;
  onHand: number;
  availableQty: number;
  damagedQty: number;
  holdQty: number;
  customerSummary: string;
  items: Item[];
};

type WarehouseFilterStatus = "all" | NodeStatus;

const SCENE_CONFIG = {
  warehouse: { width: 3.8, depth: 2.7, spacingX: 5.3, spacingZ: 4.2 },
  section: { width: 3.1, depth: 2.2, spacingX: 4.2, spacingZ: 3.4 },
  container: { width: 2.2, depth: 1.5, spacingX: 3.1, spacingZ: 2.7 }
} as const;

const STATUS_COLOR_MAP: Record<NodeStatus, string> = {
  normal: "#5f8b7f",
  low: "#c79b5d",
  hold: "#53739a",
  damaged: "#bf6d5f",
  mixed: "#7a5fa0"
};

export function WarehouseMapPage({ items, isLoading, onNavigate, onOpenContainerDetail }: WarehouseMapPageProps) {
  const { t } = useI18n();
  const [selectedWarehouseFilterId, setSelectedWarehouseFilterId] = useState<string>("all");
  const [selectedCustomerFilterId, setSelectedCustomerFilterId] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<WarehouseFilterStatus>("all");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [selectedContainerSkuId, setSelectedContainerSkuId] = useState<string | null>(null);

  const warehouseOptions = useMemo(
    () =>
      [...new Map(items.map((item) => [item.locationId, item.locationName])).entries()]
        .map(([id, name]) => ({ id: String(id), name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [items]
  );
  const customerOptions = useMemo(
    () =>
      [...new Map(items.map((item) => [item.customerId, item.customerName])).entries()]
        .map(([id, name]) => ({ id: String(id), name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [items]
  );
  const scopedItems = useMemo(() => {
    return items.filter((item) => {
      const warehouseMatch = selectedWarehouseFilterId === "all" || String(item.locationId) === selectedWarehouseFilterId;
      const customerMatch = selectedCustomerFilterId === "all" || String(item.customerId) === selectedCustomerFilterId;
      return warehouseMatch && customerMatch;
    });
  }, [items, selectedCustomerFilterId, selectedWarehouseFilterId]);
  const warehouses = useMemo(
    () => filterWarehouseMapByStatus(buildWarehouseMap(scopedItems, t("noContainer")), selectedStatusFilter),
    [scopedItems, selectedStatusFilter, t]
  );

  const selectedWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.id === selectedWarehouseId) ?? null,
    [warehouses, selectedWarehouseId]
  );
  const selectedSection = useMemo(
    () => selectedWarehouse?.sections.find((section) => section.id === selectedSectionId) ?? null,
    [selectedWarehouse, selectedSectionId]
  );
  const selectedContainer = useMemo(
    () => selectedSection?.containers.find((container) => container.id === selectedContainerId) ?? null,
    [selectedSection, selectedContainerId]
  );
  const selectedContainerSkuRows = useMemo(
    () => buildContainerSkuSummaryRows(selectedContainer?.items ?? []),
    [selectedContainer]
  );
  const selectedContainerSku = useMemo(
    () => selectedContainerSkuRows.find((row) => row.id === selectedContainerSkuId) ?? null,
    [selectedContainerSkuId, selectedContainerSkuRows]
  );

  useEffect(() => {
    if (selectedWarehouseId && !selectedWarehouse) {
      setSelectedWarehouseId(null);
      setSelectedSectionId(null);
      setSelectedContainerId(null);
    }
  }, [selectedWarehouse, selectedWarehouseId]);

  useEffect(() => {
    if (selectedSectionId && !selectedSection) {
      setSelectedSectionId(null);
      setSelectedContainerId(null);
    }
  }, [selectedSection, selectedSectionId]);

  useEffect(() => {
    if (!selectedSection) {
      setSelectedContainerId(null);
      return;
    }
    if (!selectedContainerId || !selectedSection.containers.some((container) => container.id === selectedContainerId)) {
      setSelectedContainerId(selectedSection.containers[0]?.id ?? null);
    }
  }, [selectedSection, selectedContainerId]);

  useEffect(() => {
    if (!selectedContainerSkuRows.length) {
      setSelectedContainerSkuId(null);
      return;
    }
    if (!selectedContainerSkuId || !selectedContainerSkuRows.some((row) => row.id === selectedContainerSkuId)) {
      setSelectedContainerSkuId(selectedContainerSkuRows[0]?.id ?? null);
    }
  }, [selectedContainerSkuId, selectedContainerSkuRows]);

  const sceneNodes = useMemo(() => {
    if (!selectedWarehouse) {
      return createSceneNodes(
        warehouses.map((warehouse) => ({
          id: warehouse.id,
          title: warehouse.warehouseName,
          subtitle: `${warehouse.sectionCount} ${t("sections")} / ${warehouse.containerCount} ${t("containers")}`,
          quantity: warehouse.onHand,
          skuCount: warehouse.skuCount,
          status: warehouse.status
        })),
        SCENE_CONFIG.warehouse
      );
    }
    if (!selectedSection) {
      return createSceneNodes(
        selectedWarehouse.sections.map((section) => ({
          id: section.id,
          title: section.sectionName,
          subtitle: `${section.containerCount} ${t("containers")} / ${section.skuCount} ${t("skuCount")}`,
          quantity: section.onHand,
          skuCount: section.skuCount,
          status: section.status
        })),
        SCENE_CONFIG.section
      );
    }
    return createSceneNodes(
      selectedSection.containers.map((container) => ({
        id: container.id,
        title: container.containerNo,
        subtitle: `${container.skuCount} ${t("skuCount")}`,
        quantity: container.onHand,
        skuCount: container.skuCount,
        status: container.status
      })),
      SCENE_CONFIG.container
    );
  }, [selectedSection, selectedWarehouse, t, warehouses]);

  const sceneMode = !selectedWarehouse ? "warehouse" : !selectedSection ? "section" : "container";
  const totalContainers = useMemo(() => warehouses.reduce((sum, warehouse) => sum + warehouse.containerCount, 0), [warehouses]);
  const totalSections = useMemo(() => warehouses.reduce((sum, warehouse) => sum + warehouse.sectionCount, 0), [warehouses]);
  const totalOnHand = useMemo(() => warehouses.reduce((sum, warehouse) => sum + warehouse.onHand, 0), [warehouses]);

  function handleNodeSelect(nodeId: string) {
    if (sceneMode === "warehouse") {
      setSelectedWarehouseId(nodeId);
      setSelectedSectionId(null);
      setSelectedContainerId(null);
      return;
    }
    if (sceneMode === "section") {
      setSelectedSectionId(nodeId);
      setSelectedContainerId(null);
      return;
    }
    setSelectedContainerId(nodeId);
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full warehouse-map-page">
        <WorkspacePanelHeader
          title={t("warehouseMap")}
          actions={(
            <div className="sheet-actions">
              {selectedWarehouse ? (
                <Button
                  variant="outlined"
                  onClick={() => {
                    setSelectedWarehouseId(null);
                    setSelectedSectionId(null);
                    setSelectedContainerId(null);
                  }}
                >
                  {t("warehouseMapBackWarehouses")}
                </Button>
              ) : null}
              {selectedSection ? (
                <Button
                  variant="outlined"
                  onClick={() => {
                    setSelectedSectionId(null);
                    setSelectedContainerId(null);
                  }}
                >
                  {t("warehouseMapBackSections")}
                </Button>
              ) : null}
            </div>
          )}
        />
        <div className="warehouse-map__filters">
          <TextField
            select
            size="small"
            label={t("warehouseMapWarehouseFilter")}
            value={selectedWarehouseFilterId}
            onChange={(event) => setSelectedWarehouseFilterId(event.target.value)}
          >
            <MenuItem value="all">{t("allWarehouses")}</MenuItem>
            {warehouseOptions.map((option) => (
              <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("warehouseMapCustomerFilter")}
            value={selectedCustomerFilterId}
            onChange={(event) => setSelectedCustomerFilterId(event.target.value)}
          >
            <MenuItem value="all">{t("allCustomers")}</MenuItem>
            {customerOptions.map((option) => (
              <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("warehouseMapExceptionFilter")}
            value={selectedStatusFilter}
            onChange={(event) => setSelectedStatusFilter(event.target.value as WarehouseFilterStatus)}
          >
            <MenuItem value="all">{t("allStatuses")}</MenuItem>
            <MenuItem value="normal">{t("warehouseMapNormal")}</MenuItem>
            <MenuItem value="low">{t("warehouseMapLowStock")}</MenuItem>
            <MenuItem value="hold">{t("warehouseMapOnHold")}</MenuItem>
            <MenuItem value="damaged">{t("warehouseMapDamaged")}</MenuItem>
            <MenuItem value="mixed">{t("warehouseMapMixed")}</MenuItem>
          </TextField>
        </div>
        <div className="warehouse-map__layout">
          <section className="warehouse-map__viewport">
            <div className="warehouse-map__viewport-header">
              <div>
                <strong>
                  {sceneMode === "warehouse"
                    ? t("warehouseMapStageWarehouses")
                    : sceneMode === "section"
                      ? t("warehouseMapStageSections")
                      : t("warehouseMapStageContainers")}
                </strong>
                <span>
                  {sceneMode === "warehouse"
                    ? t("warehouseMapSelectWarehouse")
                    : sceneMode === "section"
                      ? t("warehouseMapSelectSection")
                      : t("warehouseMapSelectContainer")}
                </span>
              </div>
              <div className="warehouse-map__legend">
                {(["normal", "low", "hold", "damaged", "mixed"] as NodeStatus[]).map((status) => (
                  <span key={status}>
                    <i style={{ background: STATUS_COLOR_MAP[status] }} />
                    {getStatusLabel(status, t)}
                  </span>
                ))}
              </div>
            </div>
            <div className="warehouse-map__canvas-shell">
              {isLoading ? (
                <div className="empty-state">{t("loadingRecords")}</div>
              ) : sceneNodes.length === 0 ? (
                <div className="empty-state">{t("noResults")}</div>
              ) : (
                <Canvas camera={{ position: [18, 18, 18], fov: 42 }}>
                  <color attach="background" args={["#f3f6fa"]} />
                  <ambientLight intensity={1.2} />
                  <directionalLight position={[12, 16, 10]} intensity={1.1} />
                  <directionalLight position={[-8, 12, -6]} intensity={0.45} />
                  <gridHelper args={[44, 44, "#d4dde8", "#e8eef4"]} position={[0, 0, 0]} />
                  <MapControls
                    enableRotate
                    enableDamping
                    dampingFactor={0.08}
                    minPolarAngle={Math.PI / 5.6}
                    maxPolarAngle={Math.PI / 2.03}
                  />
                  {sceneNodes.map((node) => (
                    <WarehouseSceneBlock
                      key={node.id}
                      node={node}
                      isSelected={
                        node.id ===
                        (sceneMode === "warehouse"
                          ? selectedWarehouseId
                          : sceneMode === "section"
                            ? selectedSectionId
                            : selectedContainerId)
                      }
                      onSelect={() => handleNodeSelect(node.id)}
                    />
                  ))}
                </Canvas>
              )}
            </div>
          </section>

          <aside className="warehouse-map__panel">
            <div className="warehouse-map__panel-section">
              <div className="warehouse-map__panel-title">
                <ViewInArOutlinedIcon fontSize="small" />
                <strong>{t("warehouseMapSummary")}</strong>
              </div>
              <div className="warehouse-map__summary-grid">
                <div className="warehouse-map__summary-card">
                  <strong>{warehouses.length}</strong>
                  <span>{t("warehouses")}</span>
                </div>
                <div className="warehouse-map__summary-card">
                  <strong>{totalSections}</strong>
                  <span>{t("sections")}</span>
                </div>
                <div className="warehouse-map__summary-card">
                  <strong>{totalContainers}</strong>
                  <span>{t("containers")}</span>
                </div>
                <div className="warehouse-map__summary-card">
                  <strong>{totalOnHand}</strong>
                  <span>{t("onHand")}</span>
                </div>
              </div>
            </div>

            <div className="warehouse-map__panel-section">
              {!selectedWarehouse ? (
                <>
                  <div className="warehouse-map__panel-title">
                    <WarehouseOutlinedIcon fontSize="small" />
                    <strong>{t("warehouseMapStageWarehouses")}</strong>
                  </div>
                  <div className="warehouse-map__entity-list">
                    {warehouses.map((warehouse) => (
                      <button key={warehouse.id} type="button" className="warehouse-map__entity-card" onClick={() => handleNodeSelect(warehouse.id)}>
                        <div>
                          <strong>{warehouse.warehouseName}</strong>
                          <span>{warehouse.sectionCount} {t("sections")} / {warehouse.containerCount} {t("containers")}</span>
                        </div>
                        <div className="warehouse-map__entity-meta">
                          <span className={`warehouse-map__status-badge warehouse-map__status-badge--${warehouse.status}`}>{getStatusLabel(warehouse.status, t)}</span>
                          <strong>{warehouse.onHand}</strong>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {selectedWarehouse && !selectedSection ? (
                <>
                  <div className="warehouse-map__panel-title">
                    <WarehouseOutlinedIcon fontSize="small" />
                    <strong>{selectedWarehouse.warehouseName}</strong>
                  </div>
                  <div className="warehouse-map__detail-meta">
                    <span>{selectedWarehouse.sectionCount} {t("sections")}</span>
                    <span>{selectedWarehouse.containerCount} {t("containers")}</span>
                    <span>{selectedWarehouse.skuCount} {t("skuCount")}</span>
                  </div>
                  <div className="warehouse-map__entity-list">
                    {selectedWarehouse.sections.map((section) => (
                      <button key={section.id} type="button" className="warehouse-map__entity-card" onClick={() => handleNodeSelect(section.id)}>
                        <div>
                          <strong>{section.sectionName}</strong>
                          <span>{section.containerCount} {t("containers")} / {section.skuCount} {t("skuCount")}</span>
                        </div>
                        <div className="warehouse-map__entity-meta">
                          <span className={`warehouse-map__status-badge warehouse-map__status-badge--${section.status}`}>{getStatusLabel(section.status, t)}</span>
                          <strong>{section.onHand}</strong>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {selectedWarehouse && selectedSection ? (
                <>
                  <div className="warehouse-map__panel-title">
                    <WarehouseOutlinedIcon fontSize="small" />
                    <strong>{selectedWarehouse.warehouseName} / {selectedSection.sectionName}</strong>
                  </div>
                  <div className="warehouse-map__detail-meta">
                    <span>{selectedSection.containerCount} {t("containers")}</span>
                    <span>{selectedSection.skuCount} {t("skuCount")}</span>
                    <span className={`warehouse-map__status-badge warehouse-map__status-badge--${selectedSection.status}`}>{getStatusLabel(selectedSection.status, t)}</span>
                  </div>
                  <div className="warehouse-map__entity-list">
                    {selectedSection.containers.map((container) => (
                      <button
                        key={container.id}
                        type="button"
                        className={`warehouse-map__entity-card${selectedContainer?.id === container.id ? " warehouse-map__entity-card--active" : ""}`}
                        onClick={() => handleNodeSelect(container.id)}
                      >
                        <div>
                          <strong>{container.containerNo}</strong>
                          <span>{container.skuCount} {t("skuCount")} / {container.items.length} {t("currentInventoryRows")}</span>
                        </div>
                        <div className="warehouse-map__entity-meta">
                          <span className={`warehouse-map__status-badge warehouse-map__status-badge--${container.status}`}>{getStatusLabel(container.status, t)}</span>
                          <strong>{container.onHand}</strong>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            {selectedContainer ? (
              <div className="warehouse-map__panel-section">
                <div className="warehouse-map__panel-title">
                  <WarehouseOutlinedIcon fontSize="small" />
                  <strong>{selectedContainer.containerNo}</strong>
                </div>
                <div className="warehouse-map__detail-meta">
                  <span>{selectedContainer.warehouseName}</span>
                  <span>{selectedContainer.sectionName}</span>
                  <span className={`warehouse-map__status-badge warehouse-map__status-badge--${selectedContainer.status}`}>{getStatusLabel(selectedContainer.status, t)}</span>
                </div>
                <div className="warehouse-map__summary-grid">
                  <div className="warehouse-map__summary-card"><strong>{selectedContainer.onHand}</strong><span>{t("onHand")}</span></div>
                  <div className="warehouse-map__summary-card"><strong>{selectedContainer.availableQty}</strong><span>{t("availableQty")}</span></div>
                  <div className="warehouse-map__summary-card"><strong>{selectedContainer.damagedQty}</strong><span>{t("damagedQty")}</span></div>
                  <div className="warehouse-map__summary-card"><strong>{selectedContainer.holdQty}</strong><span>{t("holdQty")}</span></div>
                </div>
                <div className="warehouse-map__panel-title"><strong>{t("containerSkuSummary")}</strong></div>
                <div className="container-drawer__sku-grid">
                  {selectedContainerSkuRows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className={`container-drawer__sku-card${selectedContainerSku?.id === row.id ? " container-drawer__sku-card--active" : ""}`}
                      onClick={() => setSelectedContainerSkuId(row.id)}
                    >
                      <div className="container-drawer__sku-card-header">
                        <div>
                          <strong>{row.itemNumber ? `${row.itemNumber} / ${row.sku}` : row.sku}</strong>
                          <span>{row.description || "-"}</span>
                          <span>{row.customerSummary}</span>
                        </div>
                        <span className="container-drawer__sku-card-badge">{row.rowCount} {t("currentInventoryRows")}</span>
                      </div>
                      <div className="container-drawer__sku-card-metrics">
                        <div><span>{t("onHand")}</span><strong>{row.onHand}</strong></div>
                        <div><span>{t("availableQty")}</span><strong>{row.availableQty}</strong></div>
                        <div><span>{t("damagedQty")}</span><strong>{row.damagedQty}</strong></div>
                      </div>
                      <div className="container-drawer__sku-share">
                        <div className="container-drawer__sku-share-bar">
                          <span
                            style={{
                              width: `${selectedContainer.onHand > 0 ? Math.max(8, Math.round((row.onHand / selectedContainer.onHand) * 100)) : 0}%`
                            }}
                          />
                        </div>
                        <small>
                          {t("warehouseMapQuantityShare")}:{" "}
                          {selectedContainer.onHand > 0 ? Math.round((row.onHand / selectedContainer.onHand) * 100) : 0}%
                        </small>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="warehouse-map__panel-title"><strong>{t("containerSkuDetails")}</strong></div>
                {selectedContainerSku ? (
                  <>
                    <div className="warehouse-map__detail-meta">
                      <span>{selectedContainerSku.itemNumber ? `${selectedContainerSku.itemNumber} / ${selectedContainerSku.sku}` : selectedContainerSku.sku}</span>
                      <span>{selectedContainerSku.customerSummary}</span>
                    </div>
                    <div className="warehouse-map__summary-grid">
                      <div className="warehouse-map__summary-card"><strong>{selectedContainerSku.onHand}</strong><span>{t("onHand")}</span></div>
                      <div className="warehouse-map__summary-card"><strong>{selectedContainerSku.availableQty}</strong><span>{t("availableQty")}</span></div>
                      <div className="warehouse-map__summary-card"><strong>{selectedContainerSku.holdQty}</strong><span>{t("holdQty")}</span></div>
                      <div className="warehouse-map__summary-card"><strong>{selectedContainerSku.rowCount}</strong><span>{t("currentInventoryRows")}</span></div>
                    </div>
                    <div className="warehouse-map__item-list">
                      {selectedContainerSku.items
                        .slice()
                        .sort((left, right) => `${left.customerName}-${left.locationName}-${left.storageSection}`.localeCompare(`${right.customerName}-${right.locationName}-${right.storageSection}`))
                        .map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="warehouse-map__item-row warehouse-map__item-row--action"
                            onClick={() => {
                              const normalizedContainerNo = selectedContainer.containerNo.trim();
                              if (normalizedContainerNo) {
                                onOpenContainerDetail(normalizedContainerNo);
                                return;
                              }

                              setPendingInventorySummaryContext({
                                searchTerm: item.sku,
                                customerId: item.customerId,
                                locationId: item.locationId
                              });
                              onNavigate("inventory-summary");
                            }}
                          >
                            <div>
                              <strong>{item.customerName}</strong>
                              <span>{item.locationName} / {item.storageSection || "-"}</span>
                              <span>{item.description || item.name || "-"}</span>
                            </div>
                            <div className="warehouse-map__item-metrics">
                              <span>{t("onHand")}: {item.quantity}</span>
                              <span>{t("availableQty")}: {item.availableQty}</span>
                            </div>
                          </button>
                        ))}
                    </div>
                  </>
                ) : (
                  <div className="sheet-note">{t("selectContainerSkuDetail")}</div>
                )}
              </div>
            ) : (
              <div className="warehouse-map__panel-section">
                <div className="sheet-note">{t("warehouseMapHint")}</div>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

function buildWarehouseMap(items: Item[], noContainerLabel: string) {
  const warehouseMap = new Map<number, WarehouseNode>();

  for (const item of items) {
    const warehouseId = item.locationId;
    const sectionName = normalizeStorageSection(item.storageSection);
    const containerNo = item.containerNo?.trim() || noContainerLabel;
    let warehouse = warehouseMap.get(warehouseId);

    if (!warehouse) {
      warehouse = {
        id: `warehouse-${warehouseId}`,
        warehouseId,
        warehouseName: item.locationName,
        sections: [],
        containers: [],
        onHand: 0,
        availableQty: 0,
        damagedQty: 0,
        holdQty: 0,
        skuCount: 0,
        sectionCount: 0,
        containerCount: 0,
        status: "normal"
      };
      warehouseMap.set(warehouseId, warehouse);
    }

    let section = warehouse.sections.find((entry) => entry.sectionName === sectionName);
    if (!section) {
      section = {
        id: `section-${warehouseId}-${sectionName}`,
        warehouseId,
        warehouseName: warehouse.warehouseName,
        sectionName,
        containers: [],
        onHand: 0,
        availableQty: 0,
        damagedQty: 0,
        holdQty: 0,
        skuCount: 0,
        containerCount: 0,
        status: "normal"
      };
      warehouse.sections.push(section);
    }

    let container = section.containers.find((entry) => entry.containerNo === containerNo);
    if (!container) {
      container = {
        id: `container-${warehouseId}-${sectionName}-${containerNo}`,
        containerNo,
        warehouseId,
        warehouseName: warehouse.warehouseName,
        sectionName,
        items: [],
        onHand: 0,
        availableQty: 0,
        damagedQty: 0,
        holdQty: 0,
        skuCount: 0,
        status: "normal"
      };
      section.containers.push(container);
      warehouse.containers.push(container);
    }

    container.items.push(item);
    container.onHand += item.quantity;
    container.availableQty += item.availableQty;
    container.damagedQty += item.damagedQty;
    container.holdQty += item.holdQty;
  }

  return [...warehouseMap.values()]
    .map((warehouse) => {
      warehouse.sections = warehouse.sections
        .map((section) => {
          section.containers = section.containers
            .map((container) => ({
              ...container,
              skuCount: new Set(container.items.map((item) => item.sku)).size,
              status: deriveNodeStatus(container.items)
            }))
            .sort((left, right) => left.containerNo.localeCompare(right.containerNo));
          section.onHand = section.containers.reduce((sum, container) => sum + container.onHand, 0);
          section.availableQty = section.containers.reduce((sum, container) => sum + container.availableQty, 0);
          section.damagedQty = section.containers.reduce((sum, container) => sum + container.damagedQty, 0);
          section.holdQty = section.containers.reduce((sum, container) => sum + container.holdQty, 0);
          section.skuCount = new Set(section.containers.flatMap((container) => container.items.map((item) => item.sku))).size;
          section.containerCount = section.containers.length;
          section.status = deriveAggregateStatus(section.containers.map((container) => container.status));
          return section;
        })
        .sort((left, right) => left.sectionName.localeCompare(right.sectionName));

      warehouse.containers = warehouse.sections.flatMap((section) => section.containers);
      warehouse.onHand = warehouse.sections.reduce((sum, section) => sum + section.onHand, 0);
      warehouse.availableQty = warehouse.sections.reduce((sum, section) => sum + section.availableQty, 0);
      warehouse.damagedQty = warehouse.sections.reduce((sum, section) => sum + section.damagedQty, 0);
      warehouse.holdQty = warehouse.sections.reduce((sum, section) => sum + section.holdQty, 0);
      warehouse.skuCount = new Set(warehouse.containers.flatMap((container) => container.items.map((item) => item.sku))).size;
      warehouse.sectionCount = warehouse.sections.length;
      warehouse.containerCount = warehouse.containers.length;
      warehouse.status = deriveAggregateStatus(warehouse.sections.map((section) => section.status));
      return warehouse;
    })
    .sort((left, right) => left.warehouseName.localeCompare(right.warehouseName));
}

function buildContainerSkuSummaryRows(items: Item[]) {
  const skuMap = new Map<string, Omit<ContainerSkuSummary, "customerSummary"> & { customerNames: Set<string> }>();

  for (const item of items) {
    const key = item.sku;
    let summary = skuMap.get(key);

    if (!summary) {
      summary = {
        id: key,
        itemNumber: item.itemNumber || "",
        sku: item.sku,
        description: item.description || item.name || "",
        rowCount: 0,
        onHand: 0,
        availableQty: 0,
        damagedQty: 0,
        holdQty: 0,
        items: [],
        customerNames: new Set<string>()
      };
      skuMap.set(key, summary);
    }

    summary.itemNumber ||= item.itemNumber || "";
    summary.description ||= item.description || item.name || "";
    summary.rowCount += 1;
    summary.onHand += item.quantity;
    summary.availableQty += item.availableQty;
    summary.damagedQty += item.damagedQty;
    summary.holdQty += item.holdQty;
    summary.items.push(item);
    if (item.customerName) {
      summary.customerNames.add(item.customerName);
    }
  }

  return [...skuMap.values()]
    .map((summary) => {
      const customerNames = [...summary.customerNames].sort();
      let customerSummary = "-";
      if (customerNames.length === 1) {
        customerSummary = customerNames[0];
      } else if (customerNames.length === 2) {
        customerSummary = `${customerNames[0]} / ${customerNames[1]}`;
      } else if (customerNames.length > 2) {
        customerSummary = `${customerNames[0]} +${customerNames.length - 1}`;
      }

      return {
        id: summary.id,
        itemNumber: summary.itemNumber,
        sku: summary.sku,
        description: summary.description,
        rowCount: summary.rowCount,
        onHand: summary.onHand,
        availableQty: summary.availableQty,
        damagedQty: summary.damagedQty,
        holdQty: summary.holdQty,
        customerSummary,
        items: summary.items
      };
    })
    .sort((left, right) => left.sku.localeCompare(right.sku));
}

function filterWarehouseMapByStatus(warehouses: WarehouseNode[], status: WarehouseFilterStatus) {
  if (status === "all") {
    return warehouses;
  }

  return warehouses
    .map((warehouse) => {
      const sections = warehouse.sections
        .map((section) => {
          const containers = section.containers.filter((container) => container.status === status);
          if (!containers.length) {
            return null;
          }

          return {
            ...section,
            containers,
            onHand: containers.reduce((sum, container) => sum + container.onHand, 0),
            availableQty: containers.reduce((sum, container) => sum + container.availableQty, 0),
            damagedQty: containers.reduce((sum, container) => sum + container.damagedQty, 0),
            holdQty: containers.reduce((sum, container) => sum + container.holdQty, 0),
            skuCount: new Set(containers.flatMap((container) => container.items.map((item) => item.sku))).size,
            containerCount: containers.length,
            status: deriveAggregateStatus(containers.map((container) => container.status))
          };
        })
        .filter(Boolean) as SectionNode[];

      if (!sections.length) {
        return null;
      }

      const containers = sections.flatMap((section) => section.containers);
      return {
        ...warehouse,
        sections,
        containers,
        onHand: sections.reduce((sum, section) => sum + section.onHand, 0),
        availableQty: sections.reduce((sum, section) => sum + section.availableQty, 0),
        damagedQty: sections.reduce((sum, section) => sum + section.damagedQty, 0),
        holdQty: sections.reduce((sum, section) => sum + section.holdQty, 0),
        skuCount: new Set(containers.flatMap((container) => container.items.map((item) => item.sku))).size,
        sectionCount: sections.length,
        containerCount: containers.length,
        status: deriveAggregateStatus(sections.map((section) => section.status))
      };
    })
    .filter(Boolean) as WarehouseNode[];
}

function deriveNodeStatus(items: Item[]): NodeStatus {
  if (items.length === 0) {
    return "normal";
  }

  const customerCount = new Set(items.map((item) => item.customerId)).size;
  const skuCount = new Set(items.map((item) => item.sku)).size;
  const hasDamaged = items.some((item) => item.damagedQty > 0);
  const hasHold = items.some((item) => item.holdQty > 0);
  const hasLowStock = items.some((item) => item.reorderLevel > 0 && item.availableQty <= item.reorderLevel);
  const hasMixedStock = customerCount > 1 || skuCount > 1;
  const activeFlags = [hasDamaged, hasHold, hasLowStock, hasMixedStock].filter(Boolean).length;

  if (activeFlags > 1) return "mixed";
  if (hasDamaged) return "damaged";
  if (hasHold) return "hold";
  if (hasLowStock) return "low";
  if (hasMixedStock) return "mixed";
  return "normal";
}

function deriveAggregateStatus(statuses: NodeStatus[]): NodeStatus {
  const unique = [...new Set(statuses)];
  if (unique.length === 0) return "normal";
  if (unique.length === 1) return unique[0];
  if (unique.includes("mixed")) return "mixed";
  const nonNormal = unique.filter((status) => status !== "normal");
  if (nonNormal.length === 1) {
    return nonNormal[0];
  }
  return "mixed";
}

function createSceneNodes(
  nodes: Array<{ id: string; title: string; subtitle: string; quantity: number; skuCount: number; status: NodeStatus }>,
  config: { width: number; depth: number; spacingX: number; spacingZ: number }
) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const rows = Math.max(1, Math.ceil(nodes.length / columns));

  return nodes.map((node, index): SceneNode => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = (col - (columns - 1) / 2) * config.spacingX;
    const z = (row - (rows - 1) / 2) * config.spacingZ;
    return { ...node, width: config.width, depth: config.depth, height: getNodeHeight(node.quantity), x, z };
  });
}

function getNodeHeight(quantity: number) {
  if (quantity <= 0) {
    return 0.55;
  }
  return Math.max(0.65, Math.min(3.8, 0.85 + Math.log10(quantity + 1) * 1.05));
}

function getStatusLabel(status: NodeStatus, t: (key: string) => string) {
  switch (status) {
    case "low":
      return t("warehouseMapLowStock");
    case "hold":
      return t("warehouseMapOnHold");
    case "damaged":
      return t("warehouseMapDamaged");
    case "mixed":
      return t("warehouseMapMixed");
    default:
      return t("warehouseMapNormal");
  }
}

function WarehouseSceneBlock({
  node,
  isSelected,
  onSelect
}: {
  node: SceneNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <group position={[node.x, 0, node.z]}>
      <mesh
        position={[0, node.height / 2, 0]}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        <boxGeometry args={[node.width, node.height, node.depth]} />
        <meshStandardMaterial color={isSelected ? "#1f4f86" : STATUS_COLOR_MAP[node.status]} roughness={0.4} metalness={0.05} />
      </mesh>
      <Html position={[0, node.height + 0.42, 0]} center distanceFactor={10} transform={false}>
        <div className={`warehouse-map__label${isSelected ? " warehouse-map__label--active" : ""}`}>
          <strong>{node.title}</strong>
          <span>{node.subtitle}</span>
          <small>{node.quantity} / {node.skuCount} SKU</small>
        </div>
      </Html>
    </group>
  );
}
