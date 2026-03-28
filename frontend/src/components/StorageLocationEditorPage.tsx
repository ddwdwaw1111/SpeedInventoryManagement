import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import WidgetsOutlinedIcon from "@mui/icons-material/WidgetsOutlined";
import { Button } from "@mui/material";
import { type FormEvent, type RefObject, useMemo, useState } from "react";
import { GridLayout, noCompactor, useContainerWidth, type Layout, type LayoutItem as GridLayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import {
  DEFAULT_STORAGE_SECTION,
  normalizeStorageSection,
  type Location,
  type LocationPayload,
  type StorageLayoutBlock,
  type StorageLayoutBlockType,
  type UserRole
} from "../lib/types";
import { InlineAlert } from "./Feedback";
import { WorkspacePanelHeader } from "./WorkspacePanelChrome";

type StorageLocationEditorPageProps = {
  location: Location | null;
  locationId: number | null;
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onBack: () => void;
};

type LocationFormState = {
  name: string;
  address: string;
  zone: string;
  description: string;
  capacity: number;
  layoutBlocks: StorageLayoutBlock[];
};

const LAYOUT_GRID_SIZE = 44;

function createLayoutBlock(type: StorageLayoutBlockType, index: number): StorageLayoutBlock {
  if (type === "temporary") {
    return {
      id: `temp-area-${Date.now()}-${index}`,
      name: "Temporary Area",
      type,
      x: 0,
      y: 0,
      width: 5,
      height: 4
    };
  }

  if (type === "support") {
    return {
      id: `support-${Date.now()}-${index}`,
      name: `Support ${index + 1}`,
      type,
      x: index * 5,
      y: 5,
      width: 3,
      height: 2
    };
  }

  return {
    id: `section-${Date.now()}-${index}`,
    name: `S${index + 1}`,
    type,
    x: index * 5,
    y: 0,
    width: 4,
    height: 3
  };
}

function buildDefaultLayoutBlocks(sectionNames?: string[]) {
  const normalizedSections = Array.from(
    new Set((sectionNames ?? []).map((sectionName) => normalizeStorageSection(sectionName)).filter(Boolean))
  );

  if (normalizedSections.length === 0) {
    return [createLayoutBlock("temporary", 0)];
  }

  return normalizedSections.map((sectionName, index) => (
    sectionName === DEFAULT_STORAGE_SECTION
      ? { ...createLayoutBlock("temporary", index), id: `layout-${index + 1}` }
      : { ...createLayoutBlock("section", index), id: `layout-${index + 1}`, name: sectionName }
  ));
}

function deriveSectionNames(layoutBlocks: StorageLayoutBlock[]) {
  const sectionNames: string[] = [];
  const seen = new Set<string>();

  for (const block of layoutBlocks) {
    if (block.type === "temporary") {
      if (!seen.has(DEFAULT_STORAGE_SECTION)) {
        seen.add(DEFAULT_STORAGE_SECTION);
        sectionNames.push(DEFAULT_STORAGE_SECTION);
      }
      continue;
    }

    if (block.type !== "section") {
      continue;
    }

    const normalized = block.name.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    sectionNames.push(normalized);
  }

  if (!seen.has(DEFAULT_STORAGE_SECTION)) {
    sectionNames.unshift(DEFAULT_STORAGE_SECTION);
  }

  return sectionNames;
}

function sanitizeLayoutBlocks(layoutBlocks: StorageLayoutBlock[]) {
  const blocks = layoutBlocks.map((block, index) => ({
    ...block,
    id: block.id || `layout-${index + 1}`,
    name: block.type === "temporary"
      ? (block.name.trim() || "Temporary Area")
      : block.type === "support"
        ? (block.name.trim() || `Support ${index + 1}`)
        : (block.name.trim().toUpperCase() || `S${index + 1}`),
    x: Math.max(0, Math.floor(block.x)),
    y: Math.max(0, Math.floor(block.y)),
    width: Math.max(1, Math.floor(block.width)),
    height: Math.max(1, Math.floor(block.height))
  }));

  const hasTemporary = blocks.some((block) => block.type === "temporary");
  return hasTemporary ? blocks : [createLayoutBlock("temporary", 0), ...blocks];
}

function getBlockColorClass(type: StorageLayoutBlockType) {
  switch (type) {
    case "temporary":
      return "storage-layout-canvas__block--temporary";
    case "support":
      return "storage-layout-canvas__block--support";
    default:
      return "storage-layout-canvas__block--section";
  }
}

function createFormFromLocation(location: Location | null): LocationFormState {
  const layoutBlocks = sanitizeLayoutBlocks(
    location?.layoutBlocks?.length ? location.layoutBlocks : buildDefaultLayoutBlocks(location?.sectionNames)
  );

  return {
    name: location?.name ?? "",
    address: location?.address ?? "",
    zone: location?.zone ?? "",
    description: location?.description ?? "",
    capacity: location?.capacity ?? 0,
    layoutBlocks
  };
}

export function StorageLocationEditorPage({
  location,
  locationId,
  currentUserRole,
  isLoading,
  onRefresh,
  onBack
}: StorageLocationEditorPageProps) {
  const { t } = useI18n();
  const canManage = currentUserRole === "admin";
  const [form, setForm] = useState<LocationFormState>(() => createFormFromLocation(location));
  const [selectedBlockId, setSelectedBlockId] = useState<string>(createFormFromLocation(location).layoutBlocks[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const selectedBlock = useMemo(
    () => form.layoutBlocks.find((block) => block.id === selectedBlockId) ?? form.layoutBlocks[0] ?? null,
    [form.layoutBlocks, selectedBlockId]
  );
  const sectionNames = useMemo(() => deriveSectionNames(form.layoutBlocks), [form.layoutBlocks]);
  const layoutCanvasSize = useMemo(() => {
    const maxRight = form.layoutBlocks.reduce((largest, block) => Math.max(largest, block.x + block.width), 8);
    const maxBottom = form.layoutBlocks.reduce((largest, block) => Math.max(largest, block.y + block.height), 6);
    return {
      width: Math.max(12, maxRight) * LAYOUT_GRID_SIZE,
      height: Math.max(8, maxBottom) * LAYOUT_GRID_SIZE
    };
  }, [form.layoutBlocks]);
  const layoutGridColumns = useMemo(
    () => Math.max(12, form.layoutBlocks.reduce((largest, block) => Math.max(largest, block.x + block.width), 10) + 2),
    [form.layoutBlocks]
  );
  const layoutGridItems = useMemo<GridLayoutItem[]>(
    () => form.layoutBlocks.map((block) => ({
      i: block.id,
      x: block.x,
      y: block.y,
      w: block.width,
      h: block.height,
      minW: 2,
      minH: 2
    })),
    [form.layoutBlocks]
  );
  const { width: layoutWidth, containerRef: layoutContainerRef, mounted: layoutMounted } = useContainerWidth({ initialWidth: 860 });
  const temporaryBlockExists = form.layoutBlocks.some((block) => block.type === "temporary");
  const title = location ? t("editStorageLocation") : t("addStorageLocation");
  const permissionNotice = canManage ? "" : t("adminOnlyManageNotice");

  if (!isLoading && locationId !== null && !location) {
    return (
      <main className="workspace-main">
        <section className="workbook-panel workbook-panel--full">
          <div className="tab-strip">
            <WorkspacePanelHeader
              title={t("editStorageLocation")}
              actions={<button className="button button--ghost" type="button" onClick={onBack}>{t("back")}</button>}
              errorMessage={t("recordNotFound")}
            />
          </div>
        </section>
      </main>
    );
  }

  function updateLayoutBlock(blockId: string, patch: Partial<StorageLayoutBlock>) {
    setForm((current) => ({
      ...current,
      layoutBlocks: current.layoutBlocks.map((block) => {
        if (block.id !== blockId) {
          return block;
        }

        const nextType = patch.type ?? block.type;
        const anotherTemporaryExists = nextType === "temporary"
          && current.layoutBlocks.some((existingBlock) => existingBlock.id !== blockId && existingBlock.type === "temporary");
        if (anotherTemporaryExists) {
          setErrorMessage(t("singleTemporaryAreaNotice"));
          return block;
        }

        const nextName = patch.name ?? block.name;

        return {
          ...block,
          ...patch,
          type: nextType,
          name: nextType === "section" ? nextName.toUpperCase() : nextName
        };
      })
    }));
  }

  function syncLayoutBlocks(nextLayout: Layout) {
    setForm((current) => {
      const layoutMap = new Map(nextLayout.map((layoutItem) => [layoutItem.i, layoutItem]));
      return {
        ...current,
        layoutBlocks: current.layoutBlocks.map((block) => {
          const layoutItem = layoutMap.get(block.id);
          if (!layoutItem) {
            return block;
          }
          return {
            ...block,
            x: layoutItem.x,
            y: layoutItem.y,
            width: layoutItem.w,
            height: layoutItem.h
          };
        })
      };
    });
  }

  function addLayoutBlock(type: StorageLayoutBlockType) {
    setForm((current) => {
      if (type === "temporary" && current.layoutBlocks.some((block) => block.type === "temporary")) {
        setErrorMessage(t("singleTemporaryAreaNotice"));
        return current;
      }

      const newBlock = createLayoutBlock(type, current.layoutBlocks.length);
      setSelectedBlockId(newBlock.id);
      return {
        ...current,
        layoutBlocks: [...current.layoutBlocks, newBlock]
      };
    });
  }

  function removeSelectedBlock() {
    if (!selectedBlock) {
      return;
    }

    setForm((current) => {
      const remaining = current.layoutBlocks.filter((block) => block.id !== selectedBlock.id);
      if (remaining.length === 0) {
        return current;
      }
      if (!remaining.some((block) => block.type === "temporary")) {
        setErrorMessage(t("singleTemporaryAreaNotice"));
        return current;
      }
      setSelectedBlockId(remaining[0].id);
      return {
        ...current,
        layoutBlocks: remaining
      };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    setSubmitting(true);
    setErrorMessage("");

    const sanitizedBlocks = sanitizeLayoutBlocks(form.layoutBlocks);
    const payload: LocationPayload = {
      name: form.name,
      address: form.address,
      zone: form.zone,
      description: form.description,
      capacity: form.capacity,
      sectionNames: deriveSectionNames(sanitizedBlocks),
      layoutBlocks: sanitizedBlocks
    };

    try {
      if (location) {
        await api.updateLocation(location.id, payload);
      } else {
        await api.createLocation(payload);
      }
      await onRefresh();
      onBack();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveLocation"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={title}
            actions={canManage ? (
              <div className="sheet-actions">
                <button className="button button--ghost" type="button" onClick={onBack}>
                  {t("cancel")}
                </button>
                <button className="button button--primary" form="storage-location-editor-form" type="submit" disabled={submitting || isLoading}>
                  {submitting ? t("saving") : location ? t("updateLocation") : t("addLocation")}
                </button>
              </div>
            ) : undefined}
            notices={[permissionNotice]}
            errorMessage={errorMessage}
          />
        </div>

        <form id="storage-location-editor-form" className="sheet-form" onSubmit={handleSubmit}>
          <label>{t("storageName")}<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="NJ Warehouse A" required /></label>
          <label>{t("zone")}<input value={form.zone} onChange={(event) => setForm((current) => ({ ...current, zone: event.target.value }))} placeholder="North Wing" required /></label>
          <label className="sheet-form__wide">{t("address")}<input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="1200 Harbor Blvd, North Bergen, NJ" required /></label>
          <label>{t("capacity")}<input type="number" min="0" value={form.capacity} onChange={(event) => setForm((current) => ({ ...current, capacity: Math.max(0, Number(event.target.value || 0)) }))} /></label>

          <div className="sheet-form__wide storage-layout-editor">
            <div className="storage-layout-editor__header">
              <div>
                <strong>{t("warehouseLayout")}</strong>
                <p>{t("warehouseLayoutDesc")}</p>
              </div>
              <div className="storage-layout-editor__actions">
                <Button size="small" variant="outlined" type="button" startIcon={<AddOutlinedIcon />} onClick={() => addLayoutBlock("temporary")} disabled={temporaryBlockExists}>
                  {t("addTemporaryArea")}
                </Button>
                <Button size="small" variant="outlined" type="button" startIcon={<Inventory2OutlinedIcon />} onClick={() => addLayoutBlock("section")}>
                  {t("addSectionArea")}
                </Button>
                <Button size="small" variant="outlined" type="button" startIcon={<WidgetsOutlinedIcon />} onClick={() => addLayoutBlock("support")}>
                  {t("addSupportArea")}
                </Button>
              </div>
            </div>

            <div className="storage-layout-editor__body">
              <div className="storage-layout-canvas-wrap">
                <div className="storage-layout-canvas" ref={layoutContainerRef as RefObject<HTMLDivElement>} style={{ minHeight: layoutCanvasSize.height }}>
                  {layoutMounted ? (
                    <GridLayout
                      className="storage-layout-grid"
                      width={layoutWidth}
                      gridConfig={{
                        cols: layoutGridColumns,
                        rowHeight: LAYOUT_GRID_SIZE,
                        margin: [8, 8],
                        containerPadding: [8, 8]
                      }}
                      dragConfig={{ handle: ".storage-layout-grid__handle" }}
                      resizeConfig={{ handles: ["se"] }}
                      layout={layoutGridItems}
                      compactor={noCompactor}
                      onLayoutChange={syncLayoutBlocks}
                    >
                      {form.layoutBlocks.map((block) => (
                        <div key={block.id} className="storage-layout-grid__cell">
                          <button
                            className={`storage-layout-canvas__block ${getBlockColorClass(block.type)}${selectedBlock?.id === block.id ? " storage-layout-canvas__block--selected" : ""}`}
                            type="button"
                            onClick={() => setSelectedBlockId(block.id)}
                          >
                            <span className="storage-layout-grid__handle">::</span>
                            <strong>{block.name}</strong>
                            <small>{block.type === "temporary" ? t("temporaryAreaShort") : block.type === "support" ? t("supportAreaShort") : t("formalSectionShort")}</small>
                          </button>
                        </div>
                      ))}
                    </GridLayout>
                  ) : null}
                </div>
                <div className="storage-layout-legend">
                  <span className="storage-layout-legend__item"><i className="storage-layout-legend__swatch storage-layout-legend__swatch--temporary" />{t("temporaryArea")}</span>
                  <span className="storage-layout-legend__item"><i className="storage-layout-legend__swatch storage-layout-legend__swatch--section" />{t("formalSection")}</span>
                  <span className="storage-layout-legend__item"><i className="storage-layout-legend__swatch storage-layout-legend__swatch--support" />{t("supportArea")}</span>
                </div>
              </div>

              <div className="storage-layout-editor__panel">
                {selectedBlock ? (
                  <>
                    <div className="storage-layout-editor__panel-header">
                      <strong>{t("selectedArea")}</strong>
                      <button
                        className="button button--danger button--small"
                        type="button"
                        onClick={removeSelectedBlock}
                        disabled={form.layoutBlocks.length <= 1 || (selectedBlock.type === "temporary" && form.layoutBlocks.filter((block) => block.type === "temporary").length === 1)}
                      >
                        {t("removeArea")}
                      </button>
                    </div>
                    <div className="sheet-form">
                      <label>{t("areaType")}
                        <select
                          value={selectedBlock.type}
                          onChange={(event) => updateLayoutBlock(selectedBlock.id, { type: event.target.value as StorageLayoutBlockType })}
                        >
                          <option value="temporary">{t("temporaryArea")}</option>
                          <option value="section">{t("formalSection")}</option>
                          <option value="support">{t("supportArea")}</option>
                        </select>
                      </label>
                      <label>{t("areaName")}
                        <input
                          value={selectedBlock.name}
                          onChange={(event) => updateLayoutBlock(selectedBlock.id, { name: event.target.value })}
                          placeholder={selectedBlock.type === "temporary" ? t("temporaryArea") : t("sectionName")}
                        />
                      </label>
                      <label>{t("layoutPosX")}<input type="number" min="0" value={selectedBlock.x} onChange={(event) => updateLayoutBlock(selectedBlock.id, { x: Math.max(0, Number(event.target.value || 0)) })} /></label>
                      <label>{t("layoutPosY")}<input type="number" min="0" value={selectedBlock.y} onChange={(event) => updateLayoutBlock(selectedBlock.id, { y: Math.max(0, Number(event.target.value || 0)) })} /></label>
                      <label>{t("layoutWidth")}<input type="number" min="1" value={selectedBlock.width} onChange={(event) => updateLayoutBlock(selectedBlock.id, { width: Math.max(1, Number(event.target.value || 1)) })} /></label>
                      <label>{t("layoutHeight")}<input type="number" min="1" value={selectedBlock.height} onChange={(event) => updateLayoutBlock(selectedBlock.id, { height: Math.max(1, Number(event.target.value || 1)) })} /></label>
                    </div>
                    <div className="sheet-note">
                      <strong>{t("inventorySections")}</strong> {sectionNames.join(", ")}
                    </div>
                    {selectedBlock.type === "temporary" ? (
                      <div className="sheet-note">{t("temporaryAreaMapsToTemp")}</div>
                    ) : null}
                  </>
                ) : (
                  <div className="sheet-note">{t("selectAreaToEdit")}</div>
                )}
              </div>
            </div>
          </div>

          <label className="sheet-form__wide">
            {t("notes")}
            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={t("storageNotesPlaceholder")} rows={4} />
          </label>
          {!canManage ? <InlineAlert>{t("adminOnlyManageNotice")}</InlineAlert> : null}
        </form>
      </section>
    </main>
  );
}
