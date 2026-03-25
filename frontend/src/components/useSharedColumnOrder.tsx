import CloseIcon from "@mui/icons-material/Close";
import DragIndicatorOutlinedIcon from "@mui/icons-material/DragIndicatorOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import type { GridColDef, GridValidRowModel } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";

const DEFAULT_LOCKED_FIELDS = ["actions"];

type SharedColumnOrderOptions<Row extends GridValidRowModel> = {
  preferenceKey: string;
  baseColumns: GridColDef<Row>[];
  canManage: boolean;
  lockedFields?: string[];
  dialogWidth?: string;
  onError?: (message: string) => void;
};

type SharedColumnOrderResult<Row extends GridValidRowModel> = {
  columns: GridColDef<Row>[];
  columnOrderAction: ReactNode;
  columnOrderDialog: ReactNode;
};

export function useSharedColumnOrder<Row extends GridValidRowModel>({
  preferenceKey,
  baseColumns,
  canManage,
  lockedFields = DEFAULT_LOCKED_FIELDS,
  dialogWidth = "min(1360px, 96vw)",
  onError
}: SharedColumnOrderOptions<Row>): SharedColumnOrderResult<Row> {
  const { t } = useI18n();
  const onErrorRef = useRef(onError);
  const tRef = useRef(t);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [draftColumnOrder, setDraftColumnOrder] = useState<string[]>([]);
  const [draggingColumnField, setDraggingColumnField] = useState<string | null>(null);
  const [isColumnOrderModalOpen, setIsColumnOrderModalOpen] = useState(false);
  const [isSavingColumnOrder, setIsSavingColumnOrder] = useState(false);
  const lockedFieldsKey = lockedFields.join("|");
  const normalizedLockedFields = useMemo(() => [...lockedFields], [lockedFieldsKey]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const orderableFields = useMemo(
    () => baseColumns
      .filter((column) => !normalizedLockedFields.includes(column.field))
      .map((column) => column.field),
    [baseColumns, normalizedLockedFields]
  );

  useEffect(() => {
    let isActive = true;

    async function loadColumnOrder() {
      try {
        const preference = await api.getUIPreference<string[]>(preferenceKey);
        if (!isActive) return;
        const nextOrder = Array.isArray(preference.value)
          ? preference.value.filter((value): value is string => typeof value === "string" && !normalizedLockedFields.includes(value))
          : [];

        setColumnOrder((current) => areStringArraysEqual(current, nextOrder) ? current : nextOrder);
      } catch (error) {
        if (!isActive || !onErrorRef.current) return;
        onErrorRef.current(error instanceof Error ? error.message : tRef.current("couldNotLoadReport"));
      }
    }

    void loadColumnOrder();
    return () => {
      isActive = false;
    };
  }, [normalizedLockedFields, preferenceKey]);

  const resolvedColumnOrder = useMemo(() => {
    if (columnOrder.length === 0) {
      return orderableFields;
    }

    const orderedFields = columnOrder.filter((field) => orderableFields.includes(field));
    const remainingFields = orderableFields.filter((field) => !orderedFields.includes(field));
    return [...orderedFields, ...remainingFields];
  }, [columnOrder, orderableFields]);

  const columns = useMemo(() => {
    const baseColumnsByField = new Map(baseColumns.map((column) => [column.field, column] as const));
    const orderedColumns = resolvedColumnOrder
      .map((field) => baseColumnsByField.get(field))
      .filter((column): column is GridColDef<Row> => Boolean(column));
    const fixedColumns = baseColumns.filter((column) => normalizedLockedFields.includes(column.field));
    return [...orderedColumns, ...fixedColumns];
  }, [baseColumns, normalizedLockedFields, resolvedColumnOrder]);

  function openColumnOrderModal() {
    if (!canManage) return;
    setDraftColumnOrder(resolvedColumnOrder);
    setIsColumnOrderModalOpen(true);
  }

  function closeColumnOrderModal() {
    setIsColumnOrderModalOpen(false);
    setDraftColumnOrder([]);
    setIsSavingColumnOrder(false);
    setDraggingColumnField(null);
  }

  function moveDraftColumn(field: string, targetField: string) {
    if (field === targetField) return;

    setDraftColumnOrder((current) => {
      const next = [...current];
      const currentIndex = next.indexOf(field);
      const targetIndex = next.indexOf(targetField);
      if (currentIndex === -1 || targetIndex === -1) {
        return current;
      }

      const [movedField] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, movedField);
      return next;
    });
  }

  async function persistColumnOrder(nextOrder: string[], previousOrder: string[]) {
    try {
      await api.updateUIPreference<string[]>(preferenceKey, nextOrder);
    } catch (error) {
      setColumnOrder(previousOrder);
      if (onError) {
        onError(error instanceof Error ? error.message : t("couldNotSaveSkuMaster"));
      }
    }
  }

  async function saveColumnOrder() {
    if (!canManage) return;
    const nextOrder = [...draftColumnOrder];
    const previousOrder = [...columnOrder];
    setIsSavingColumnOrder(true);
    setColumnOrder(nextOrder);
    await persistColumnOrder(nextOrder, previousOrder);
    setIsSavingColumnOrder(false);
    setIsColumnOrderModalOpen(false);
  }

  const columnOrderAction = canManage ? (
    <Button variant="outlined" startIcon={<TuneOutlinedIcon />} onClick={openColumnOrderModal}>
      {t("columnOrder")}
    </Button>
  ) : null;

  const columnOrderDialog = canManage ? (
    <Dialog
      open={isColumnOrderModalOpen}
      onClose={(_, reason) => {
        if (reason === "backdropClick" || isSavingColumnOrder) return;
        closeColumnOrderModal();
      }}
      fullWidth
      maxWidth={false}
      PaperProps={{
        sx: {
          width: dialogWidth
        }
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        {t("columnOrder")}
        <IconButton aria-label={t("close")} onClick={closeColumnOrderModal} disabled={isSavingColumnOrder} sx={{ position: "absolute", right: 16, top: 16 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <div className="sheet-note sheet-note--readonly">{t("columnOrderSharedNotice")}</div>
        <div className="column-order-board">
          {draftColumnOrder.map((field, index) => {
            const column = baseColumns.find((candidate) => candidate.field === field);
            if (!column) return null;

            return (
              <div
                className={`column-order-card ${draggingColumnField === field ? "column-order-card--dragging" : ""}`}
                key={field}
                draggable={!isSavingColumnOrder}
                onDragStart={() => setDraggingColumnField(field)}
                onDragEnd={() => setDraggingColumnField(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!draggingColumnField) return;
                  moveDraftColumn(draggingColumnField, field);
                  setDraggingColumnField(null);
                }}
              >
                <DragIndicatorOutlinedIcon fontSize="small" />
                <div className="column-order-card__copy">
                  <strong>{column.headerName}</strong>
                  <span>{t("positionLabel", { position: index + 1 })}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="sheet-form__actions" style={{ marginTop: "1rem" }}>
          <button className="button button--primary" type="button" disabled={isSavingColumnOrder} onClick={() => void saveColumnOrder()}>
            {isSavingColumnOrder ? t("saving") : t("saveChanges")}
          </button>
          <button className="button button--ghost" type="button" disabled={isSavingColumnOrder} onClick={() => setDraftColumnOrder(orderableFields)}>
            {t("resetDefault")}
          </button>
          <button className="button button--ghost" type="button" disabled={isSavingColumnOrder} onClick={closeColumnOrderModal}>
            {t("cancel")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  ) : null;

  return {
    columns,
    columnOrderAction,
    columnOrderDialog
  };
}

function areStringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
