import { type CSSProperties, type ReactNode, useMemo, useState } from "react";

import { cn } from "../../lib/utils";

export type GridRowId = number | string;
export type GridValidRowModel = Record<string, any>;

export type GridRenderCellParams<Row extends GridValidRowModel = GridValidRowModel> = {
  field: string;
  id: GridRowId;
  row: Row;
  value: any;
};

export type GridRowParams<Row extends GridValidRowModel = GridValidRowModel> = {
  id: GridRowId;
  row: Row;
};

export type GridColDef<Row extends GridValidRowModel = GridValidRowModel> = {
  align?: "center" | "left" | "right";
  disableReorder?: boolean;
  editable?: boolean;
  field: string;
  filterable?: boolean;
  flex?: number;
  headerAlign?: "center" | "left" | "right";
  headerName?: string;
  minWidth?: number;
  renderCell?: (params: GridRenderCellParams<Row>) => ReactNode;
  sortable?: boolean;
  type?: "number" | "string" | string;
  valueFormatter?: (value: any, row?: Row) => ReactNode;
  valueGetter?: (value: any, row: Row) => any;
  valueSetter?: (value: any, row: Row) => Row;
  width?: number;
};

type DataGridProps<Row extends GridValidRowModel = GridValidRowModel> = {
  autoHeight?: boolean;
  columns: GridColDef<Row>[];
  disableRowSelectionOnClick?: boolean;
  editMode?: string;
  getRowClassName?: (params: GridRowParams<Row>) => string;
  getRowHeight?: (params: GridRowParams<Row>) => number | string;
  getRowId?: (row: Row) => GridRowId;
  hideFooter?: boolean;
  initialState?: {
    pagination?: {
      paginationModel?: {
        page?: number;
        pageSize?: number;
      };
    };
  };
  loading?: boolean;
  onProcessRowUpdateError?: (error: unknown) => void;
  onRowClick?: (params: GridRowParams<Row>) => void;
  pageSizeOptions?: number[];
  pagination?: boolean;
  processRowUpdate?: (newRow: Row, oldRow: Row) => Row | Promise<Row>;
  rows: Row[];
  slots?: {
    loadingOverlay?: () => ReactNode;
    noResultsOverlay?: () => ReactNode;
    noRowsOverlay?: () => ReactNode;
  };
  sx?: unknown;
};

export function DataGrid<Row extends GridValidRowModel>({
  columns,
  getRowClassName,
  getRowId,
  hideFooter,
  initialState,
  loading,
  onProcessRowUpdateError,
  onRowClick,
  pageSizeOptions = [10, 25, 50],
  pagination,
  processRowUpdate,
  rows,
  slots
}: DataGridProps<Row>) {
  const initialPageSize = initialState?.pagination?.paginationModel?.pageSize ?? pageSizeOptions[0] ?? 25;
  const initialPage = initialState?.pagination?.paginationModel?.page ?? 0;
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const boundedPage = Math.min(page, pageCount - 1);
  const visibleRows = useMemo(() => {
    if (!pagination) return rows;
    const start = boundedPage * pageSize;
    return rows.slice(start, start + pageSize);
  }, [boundedPage, pageSize, pagination, rows]);

  const gridMinWidth = columns.reduce((sum, column) => sum + (column.width ?? column.minWidth ?? 140), 0);

  if (loading) {
    const LoadingOverlay = slots?.loadingOverlay;
    return (
      <div className="data-grid-compat data-grid-compat--overlay">
        {LoadingOverlay ? <LoadingOverlay /> : <div className="data-grid-compat__state">Loading...</div>}
      </div>
    );
  }

  if (rows.length === 0) {
    const EmptyOverlay = slots?.noRowsOverlay ?? slots?.noResultsOverlay;
    return (
      <div className="data-grid-compat data-grid-compat--overlay">
        {EmptyOverlay ? <EmptyOverlay /> : <div className="data-grid-compat__state">No rows</div>}
      </div>
    );
  }

  return (
    <div className="data-grid-compat">
      <div className="data-grid-compat__scroller">
        <table className="data-grid-compat__table" style={{ minWidth: gridMinWidth }}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.field}
                  style={columnStyle(column)}
                  className={cn(column.align === "right" || column.type === "number" ? "data-grid-compat__cell--numeric" : "")}
                >
                  {column.headerName ?? column.field}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => {
              const id = resolveRowId(row, index, getRowId);
              const rowClassName = getRowClassName?.({ id, row });
              return (
                <tr
                  className={cn(onRowClick ? "data-grid-compat__row--clickable" : "", rowClassName)}
                  key={id}
                  onClick={(event) => {
                    if (!onRowClick || isInteractiveTarget(event.target)) return;
                    onRowClick({ id, row });
                  }}
                >
                  {columns.map((column) => (
                    <td
                      key={column.field}
                      style={columnStyle(column)}
                      className={cn(column.align === "right" || column.type === "number" ? "data-grid-compat__cell--numeric" : "")}
                    >
                      {renderCell({ column, id, onProcessRowUpdateError, processRowUpdate, row })}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!hideFooter && pagination ? (
        <div className="data-grid-compat__footer">
          <span>{rows.length} rows</span>
          <label>
            Rows
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(0);
              }}
            >
              {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <div className="data-grid-compat__pager">
            <button type="button" disabled={boundedPage <= 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Prev</button>
            <span>{boundedPage + 1} / {pageCount}</span>
            <button type="button" disabled={boundedPage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderCell<Row extends GridValidRowModel>({
  column,
  id,
  onProcessRowUpdateError,
  processRowUpdate,
  row
}: {
  column: GridColDef<Row>;
  id: GridRowId;
  onProcessRowUpdateError?: (error: unknown) => void;
  processRowUpdate?: (newRow: Row, oldRow: Row) => Row | Promise<Row>;
  row: Row;
}) {
  const rawValue = column.valueGetter
    ? column.valueGetter(row[column.field], row)
    : row[column.field];
  const params: GridRenderCellParams<Row> = { field: column.field, id, row, value: rawValue };

  if (column.editable && processRowUpdate) {
    return (
      <input
        className="data-grid-compat__edit"
        defaultValue={rawValue == null ? "" : String(rawValue)}
        inputMode={column.type === "number" ? "decimal" : undefined}
        onBlur={(event) => {
          const inputValue = event.target.value;
          const originalInputValue = rawValue == null ? "" : String(rawValue);
          if (inputValue === originalInputValue) return;
          const value = column.type === "number" ? Number(inputValue) : inputValue;
          const nextRow = column.valueSetter ? column.valueSetter(value, row) : ({ ...row, [column.field]: value } as Row);
          if (rowsAreShallowEqual(nextRow, row)) return;
          void Promise.resolve(processRowUpdate(nextRow, row)).catch(onProcessRowUpdateError);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  if (column.renderCell) return column.renderCell(params);

  if (column.valueFormatter) return column.valueFormatter(rawValue, row);
  if (rawValue == null || rawValue === "") return "-";
  return String(rawValue);
}

function rowsAreShallowEqual<Row extends GridValidRowModel>(nextRow: Row, row: Row) {
  const keys = new Set([...Object.keys(row), ...Object.keys(nextRow)]);
  for (const key of keys) {
    if (!Object.is(nextRow[key], row[key])) return false;
  }
  return true;
}

function resolveRowId<Row extends GridValidRowModel>(row: Row, index: number, getRowId?: (row: Row) => GridRowId): GridRowId {
  if (getRowId) return getRowId(row);
  const rowId = row.id;
  return typeof rowId === "string" || typeof rowId === "number" ? rowId : index;
}

function columnStyle<Row extends GridValidRowModel>(column: GridColDef<Row>): CSSProperties {
  const width = column.width ?? column.minWidth;
  return {
    minWidth: column.minWidth,
    textAlign: column.align,
    width: width ? `${width}px` : undefined
  };
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("a,button,input,select,textarea,[role='button'],[data-no-row-click]"));
}
