import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import WidgetsOutlinedIcon from "@mui/icons-material/WidgetsOutlined";
import { type FormEvent, type RefObject, useEffect, useMemo, useState } from "react";
import { GridLayout, noCompactor, useContainerWidth, type Layout, type LayoutItem as GridLayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { queuePageFeedback } from "../lib/pageFeedback";
import {
  DEFAULT_STORAGE_SECTION,
  normalizeStorageSection,
  type Location,
  type LocationPayload,
  type StorageLayoutBlock,
  type StorageLayoutBlockType,
  type UserRole
} from "../lib/types";
import { useFeedbackToast } from "./Feedback";

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
  description: string;
  capacity: number;
  layoutBlocks: StorageLayoutBlock[];
};

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const LAYOUT_GRID_SIZE = 44;

const fieldClassName = "tw-input";
const panelClassName = "tw-panel";
const secondaryButtonClass = "tw-btn-secondary";
const actionButtonClass = "tw-btn-tonal";
const dangerButtonClass = "tw-btn-danger";

function createLayoutBlock(type: StorageLayoutBlockType, index: number, t: TranslateFn): StorageLayoutBlock {
  if (type === "temporary") {
    return {
      id: `temp-area-${Date.now()}-${index}`,
      name: t("temporaryArea"),
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
      name: `${t("supportAreaShort")} ${index + 1}`,
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

function buildDefaultLayoutBlocks(sectionNames: string[] | undefined, t: TranslateFn) {
  const normalizedSections = Array.from(
    new Set((sectionNames ?? []).map((sectionName) => normalizeStorageSection(sectionName)).filter(Boolean))
  );

  if (normalizedSections.length === 0) {
    return [createLayoutBlock("temporary", 0, t)];
  }

  return normalizedSections.map((sectionName, index) => (
    sectionName === DEFAULT_STORAGE_SECTION
      ? { ...createLayoutBlock("temporary", index, t), id: `layout-${index + 1}` }
      : { ...createLayoutBlock("section", index, t), id: `layout-${index + 1}`, name: sectionName }
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

function sanitizeLayoutBlocks(layoutBlocks: StorageLayoutBlock[], t: TranslateFn) {
  const blocks = layoutBlocks.map((block, index) => ({
    ...block,
    id: block.id || `layout-${index + 1}`,
    name: block.type === "temporary"
      ? (block.name.trim() || t("temporaryArea"))
      : block.type === "support"
        ? (block.name.trim() || `${t("supportAreaShort")} ${index + 1}`)
        : (block.name.trim().toUpperCase() || `S${index + 1}`),
    x: Math.max(0, Math.floor(block.x)),
    y: Math.max(0, Math.floor(block.y)),
    width: Math.max(1, Math.floor(block.width)),
    height: Math.max(1, Math.floor(block.height))
  }));

  const hasTemporary = blocks.some((block) => block.type === "temporary");
  return hasTemporary ? blocks : [createLayoutBlock("temporary", 0, t), ...blocks];
}

function getBlockTone(type: StorageLayoutBlockType, t: TranslateFn) {
  switch (type) {
    case "temporary":
      return {
        card: "border-amber-300/70 bg-[linear-gradient(180deg,rgba(250,221,171,0.95),rgba(244,206,147,0.96))] text-amber-950",
        swatch: "bg-amber-300",
        label: t("temporaryAreaShort")
      };
    case "support":
      return {
        card: "border-slate-300/70 bg-[linear-gradient(180deg,rgba(223,230,241,0.95),rgba(204,214,229,0.97))] text-slate-900",
        swatch: "bg-slate-300",
        label: t("supportAreaShort")
      };
    default:
      return {
        card: "border-sky-300/70 bg-[linear-gradient(180deg,rgba(194,224,251,0.96),rgba(171,209,244,0.98))] text-sky-950",
        swatch: "bg-sky-300",
        label: t("formalSectionShort")
      };
  }
}

function createFormFromLocation(location: Location | null, t: TranslateFn): LocationFormState {
  const layoutBlocks = sanitizeLayoutBlocks(
    location?.layoutBlocks?.length ? location.layoutBlocks : buildDefaultLayoutBlocks(location?.sectionNames, t),
    t
  );

  return {
    name: location?.name ?? "",
    address: location?.address ?? "",
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
  const { showError, feedbackToast } = useFeedbackToast();
  const canManage = currentUserRole === "admin";
  const [form, setForm] = useState<LocationFormState>(() => createFormFromLocation(location, t));
  const [selectedBlockId, setSelectedBlockId] = useState<string>(createFormFromLocation(location, t).layoutBlocks[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const nextForm = createFormFromLocation(location, t);
    setForm(nextForm);
    setSelectedBlockId(nextForm.layoutBlocks[0]?.id ?? "");
    setErrorMessage("");
  }, [locationId, location, t]);

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
  const layoutSummary = useMemo(() => {
    const temporaryCount = form.layoutBlocks.filter((block) => block.type === "temporary").length;
    const sectionCount = form.layoutBlocks.filter((block) => block.type === "section").length;
    const supportCount = form.layoutBlocks.filter((block) => block.type === "support").length;
    const totalFootprint = form.layoutBlocks.reduce((sum, block) => sum + (block.width * block.height), 0);
    return [
      { label: t("temporaryArea"), value: temporaryCount },
      { label: t("formalSection"), value: sectionCount },
      { label: t("supportArea"), value: supportCount },
      { label: t("gridCells"), value: totalFootprint }
    ];
  }, [form.layoutBlocks, t]);
  const selectedTone = selectedBlock ? getBlockTone(selectedBlock.type, t) : null;
  const selectedAreaStats = selectedBlock ? [
    { label: t("areaType"), value: selectedTone?.label ?? "-" },
    { label: t("areaOrigin"), value: `${selectedBlock.x}, ${selectedBlock.y}` },
    { label: t("areaSize"), value: `${selectedBlock.width} x ${selectedBlock.height}` },
    { label: t("areaFootprint"), value: `${selectedBlock.width * selectedBlock.height} ${t("gridCellsShort")}` }
  ] : [];

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

      const newBlock = createLayoutBlock(type, current.layoutBlocks.length, t);
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

    const sanitizedBlocks = sanitizeLayoutBlocks(form.layoutBlocks, t);
    const payload: LocationPayload = {
      name: form.name,
      address: form.address,
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
      queuePageFeedback({
        severity: "success",
        message: t("locationSavedSuccess")
      });
      await onRefresh();
      onBack();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("couldNotSaveLocation");
      setErrorMessage(message);
      showError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!isLoading && locationId !== null && !location) {
    return (
      <main className="workspace-main">
        <section className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 rounded-[1.25rem] bg-white p-6 shadow-[0_16px_40px_rgba(27,54,93,0.08)] ring-1 ring-slate-950/5">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="tw-kicker">{t("storageManagement")}</p>
              <h1 className="m-0 text-[1.375rem] font-semibold tracking-tight text-slate-950">{t("editStorageLocation")}</h1>
            </div>
            <button className={secondaryButtonClass} type="button" onClick={onBack}>
              <ArrowBackOutlinedIcon fontSize="small" />
              {t("back")}
            </button>
          </div>
          <div className="tw-notice-rose">{t("recordNotFound")}</div>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace-main">
      {feedbackToast}
      <section className="mx-auto flex w-full max-w-[1680px] flex-col gap-6">
        <header className={`${panelClassName} flex flex-col gap-5 px-6 py-6`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="tw-kicker m-0">{t("storageManagement")}</p>
              <div className="space-y-1">
                <h1 className="tw-heading-xl m-0">{title}</h1>
                <p className="tw-body-muted m-0 max-w-3xl">{t("warehouseLayoutDesc")}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button className={secondaryButtonClass} type="button" onClick={onBack}>
                <ArrowBackOutlinedIcon fontSize="small" />
                {t("back")}
              </button>
              {canManage ? (
                <button
                  className="tw-btn-primary"
                  form="storage-location-editor-form"
                  type="submit"
                  disabled={submitting || isLoading}
                >
                  <SaveOutlinedIcon fontSize="small" />
                  {submitting ? t("saving") : location ? t("updateLocation") : t("addLocation")}
                </button>
              ) : null}
            </div>
          </div>

          {permissionNotice ? <div className="tw-notice-amber">{permissionNotice}</div> : null}
          {errorMessage ? <div className="tw-notice-rose">{errorMessage}</div> : null}
        </header>

        <form id="storage-location-editor-form" className="grid gap-6" onSubmit={handleSubmit}>
          <section className={`${panelClassName} grid gap-6 px-6 py-6`}>
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200/80 pb-5">
              <div className="space-y-1">
                <p className="tw-kicker m-0">{t("profile")}</p>
                <h2 className="tw-heading-lg m-0">{t("warehouseProfile")}</h2>
                <p className="tw-body-muted m-0">{t("warehouseProfileDesc")}</p>
              </div>
              <div className="max-w-sm text-sm leading-6 text-slate-500">
                {t("allInventoryDefaultsTemp")}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_180px]">
              <label className="tw-field-label">
                {t("storageName")}
                <input
                  className={fieldClassName}
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder={t("warehouseNamePlaceholder")}
                  required
                />
              </label>
              <label className="tw-field-label xl:col-span-2">
                {t("address")}
                <input
                  className={fieldClassName}
                  value={form.address}
                  onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
                  placeholder={t("warehouseAddressPlaceholder")}
                  required
                />
              </label>
              <label className="tw-field-label">
                {t("capacity")}
                <input
                  className={fieldClassName}
                  type="number"
                  min="0"
                  value={form.capacity}
                  onChange={(event) => setForm((current) => ({ ...current, capacity: Math.max(0, Number(event.target.value || 0)) }))}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {layoutSummary.map((metric) => (
                <article key={metric.label} className="tw-stat-card">
                  <p className="tw-kicker m-0">{metric.label}</p>
                  <strong className="mt-2 block text-[2rem] font-semibold tracking-tight text-slate-950">{metric.value}</strong>
                </article>
              ))}
            </div>
          </section>

          <section className="tw-panel-muted grid gap-5 px-6 py-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="tw-kicker m-0">{t("warehouseLayout")}</p>
                <h2 className="tw-heading-lg m-0">{t("warehouseLayout")}</h2>
                <p className="tw-body-muted m-0">{t("warehouseLayoutGuide")}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button className={actionButtonClass} type="button" onClick={() => addLayoutBlock("temporary")} disabled={temporaryBlockExists}>
                  <AddOutlinedIcon fontSize="small" />
                  {t("addTemporaryArea")}
                </button>
                <button className={actionButtonClass} type="button" onClick={() => addLayoutBlock("section")}>
                  <Inventory2OutlinedIcon fontSize="small" />
                  {t("addSectionArea")}
                </button>
                <button className={actionButtonClass} type="button" onClick={() => addLayoutBlock("support")}>
                  <WidgetsOutlinedIcon fontSize="small" />
                  {t("addSupportArea")}
                </button>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_360px]">
              <div className="grid gap-4">
                <div className="tw-panel grid gap-3 p-3">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 pb-3">
                    <div>
                      <p className="tw-kicker m-0">{t("layoutMap2d")}</p>
                      <h3 className="tw-heading-md m-0 mt-1">{t("warehouseBlockLayout")}</h3>
                    </div>
                    <div className="text-right text-xs leading-5 text-slate-500">
                      <div>{t("layoutColumns", { count: layoutGridColumns })}</div>
                      <div>{t("layoutGridSize", { size: LAYOUT_GRID_SIZE })}</div>
                    </div>
                  </div>

                  <div
                    ref={layoutContainerRef as RefObject<HTMLDivElement>}
                    style={{ minHeight: layoutCanvasSize.height }}
                    className="overflow-auto rounded-xl border border-slate-200 bg-[linear-gradient(to_right,rgba(119,144,176,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(119,144,176,0.08)_1px,transparent_1px)] [background-size:44px_44px]"
                  >
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
                        {form.layoutBlocks.map((block) => {
                          const tone = getBlockTone(block.type, t);
                          const isSelected = selectedBlock?.id === block.id;
                          return (
                            <div key={block.id} className="storage-layout-grid__cell">
                              <button
                                className={`grid h-full w-full content-center justify-items-center gap-1 rounded-xl border px-3 py-3 text-center shadow-[0_12px_28px_rgba(15,34,59,0.12)] transition ${
                                  tone.card
                                } ${
                                  isSelected
                                    ? "ring-2 ring-slate-950/60 ring-offset-2 ring-offset-white"
                                    : "hover:-translate-y-0.5"
                                }`}
                                type="button"
                                onClick={() => setSelectedBlockId(block.id)}
                              >
                                <span className="storage-layout-grid__handle inline-flex cursor-grab items-center justify-center rounded-sm bg-white/70 px-2 py-0.5 text-[11px] font-semibold tracking-[0.14em] text-slate-700 shadow-sm active:cursor-grabbing">
                                  ::
                                </span>
                                <strong className="block text-sm font-extrabold leading-tight">{block.name}</strong>
                                <small className="block text-[11px] font-semibold uppercase tracking-[0.08em] opacity-75">{tone.label}</small>
                              </button>
                            </div>
                          );
                        })}
                      </GridLayout>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 text-sm font-semibold text-slate-600">
                  {(["temporary", "section", "support"] as StorageLayoutBlockType[]).map((type) => {
                    const tone = getBlockTone(type, t);
                    const label = type === "temporary" ? t("temporaryArea") : type === "section" ? t("formalSection") : t("supportArea");
                    return (
                      <span key={type} className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200">
                        <i className={`h-3.5 w-3.5 rounded-sm border border-slate-300 ${tone.swatch}`} />
                        {label}
                      </span>
                    );
                  })}
                </div>

                <div className="tw-panel px-4 py-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="tw-kicker m-0">{t("directory")}</p>
                      <h3 className="tw-heading-md m-0 mt-1">{t("areaDirectory")}</h3>
                      <p className="tw-body-muted m-0 mt-1">{t("areaDirectoryDesc")}</p>
                    </div>
                    <span className="text-xs font-medium text-slate-500">{t("warehouseAreas")}: {form.layoutBlocks.length}</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {form.layoutBlocks.map((block) => {
                      const tone = getBlockTone(block.type, t);
                      const isSelected = selectedBlock?.id === block.id;
                      return (
                        <button
                          key={block.id}
                          type="button"
                          onClick={() => setSelectedBlockId(block.id)}
                          className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-3 text-left transition ${
                            isSelected
                              ? "border-[#1b365d] bg-gradient-to-br from-[#002046] to-[#1b365d] text-white shadow-[0_14px_28px_rgba(27,54,93,0.18)]"
                              : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full border border-black/10 ${isSelected ? "bg-white" : tone.swatch}`} />
                              <strong className="block truncate text-sm font-semibold">{block.name}</strong>
                            </div>
                            <span className={`mt-1 block text-xs ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                              {tone.label} / {block.width} x {block.height}
                            </span>
                          </div>
                          <span className={`shrink-0 text-xs font-medium ${isSelected ? "text-slate-300" : "text-slate-400"}`}>
                            {block.x},{block.y}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <aside className="tw-panel grid gap-4 p-5 xl:sticky xl:top-4 xl:self-start">
                {selectedBlock ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="tw-kicker m-0">{t("selectedArea")}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className={`h-3 w-3 rounded-full border border-black/10 ${selectedTone?.swatch ?? "bg-slate-300"}`} />
                          <h3 className="tw-heading-lg m-0">{selectedBlock.name}</h3>
                        </div>
                        <p className="tw-body-muted m-0 mt-2">{t("selectedAreaConfiguredDesc", { type: selectedTone?.label ?? "-" })}</p>
                      </div>
                      <button
                        className={dangerButtonClass}
                        type="button"
                        onClick={removeSelectedBlock}
                        disabled={form.layoutBlocks.length <= 1 || (selectedBlock.type === "temporary" && form.layoutBlocks.filter((block) => block.type === "temporary").length === 1)}
                      >
                        {t("removeArea")}
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedAreaStats.map((stat) => (
                        <div key={stat.label} className="tw-stat-card">
                          <div className="tw-kicker">{stat.label}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-950">{stat.value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-4 border-t border-slate-200/80 pt-4 sm:grid-cols-2">
                      <label className="tw-field-label">
                        {t("areaType")}
                        <select
                          className="tw-select"
                          value={selectedBlock.type}
                          onChange={(event) => updateLayoutBlock(selectedBlock.id, { type: event.target.value as StorageLayoutBlockType })}
                        >
                          <option value="temporary">{t("temporaryArea")}</option>
                          <option value="section">{t("formalSection")}</option>
                          <option value="support">{t("supportArea")}</option>
                        </select>
                      </label>

                      <label className="tw-field-label">
                        {t("areaName")}
                        <input
                          className={fieldClassName}
                          value={selectedBlock.name}
                          onChange={(event) => updateLayoutBlock(selectedBlock.id, { name: event.target.value })}
                          placeholder={selectedBlock.type === "temporary" ? t("temporaryArea") : t("sectionName")}
                        />
                      </label>

                      <label className="tw-field-label">
                        {t("layoutPosX")}
                        <input
                          className={fieldClassName}
                          type="number"
                          min="0"
                          value={selectedBlock.x}
                          onChange={(event) => updateLayoutBlock(selectedBlock.id, { x: Math.max(0, Number(event.target.value || 0)) })}
                        />
                      </label>

                      <label className="tw-field-label">
                        {t("layoutPosY")}
                        <input
                          className={fieldClassName}
                          type="number"
                          min="0"
                          value={selectedBlock.y}
                          onChange={(event) => updateLayoutBlock(selectedBlock.id, { y: Math.max(0, Number(event.target.value || 0)) })}
                        />
                      </label>

                      <label className="tw-field-label">
                        {t("layoutWidth")}
                        <input
                          className={fieldClassName}
                          type="number"
                          min="1"
                          value={selectedBlock.width}
                          onChange={(event) => updateLayoutBlock(selectedBlock.id, { width: Math.max(1, Number(event.target.value || 1)) })}
                        />
                      </label>

                      <label className="tw-field-label">
                        {t("layoutHeight")}
                        <input
                          className={fieldClassName}
                          type="number"
                          min="1"
                          value={selectedBlock.height}
                          onChange={(event) => updateLayoutBlock(selectedBlock.id, { height: Math.max(1, Number(event.target.value || 1)) })}
                        />
                      </label>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <strong className="font-semibold text-slate-950">{t("inventorySections")}</strong> {sectionNames.join(", ")}
                    </div>

                    {selectedBlock.type === "temporary" ? (
                      <div className="tw-notice-amber">{t("temporaryAreaMapsToTemp")}</div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    {t("selectAreaToEdit")}
                  </div>
                )}
              </aside>
            </div>
          </section>

          <section className={`${panelClassName} grid gap-4 px-6 py-6`}>
            <div className="space-y-1 border-b border-slate-200/80 pb-4">
              <p className="tw-kicker m-0">{t("notes")}</p>
              <h2 className="tw-heading-lg m-0">{t("notes")}</h2>
              <p className="tw-body-muted m-0">{t("storageNotesGuide")}</p>
            </div>
            <label className="tw-field-label">
              {t("notes")}
              <textarea
                className="tw-textarea"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder={t("storageNotesPlaceholder")}
                rows={4}
              />
            </label>
          </section>
        </form>
      </section>
    </main>
  );
}
