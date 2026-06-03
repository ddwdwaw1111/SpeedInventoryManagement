import type { ReactNode, TdHTMLAttributes } from "react";

export type SheetTableColumn = {
  key: string;
  header: ReactNode;
  className?: string;
};

type SheetTableProps = {
  columns: SheetTableColumn[];
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
  emptyState?: ReactNode;
  wrapClassName?: string;
};

type SheetTableCellProps = TdHTMLAttributes<HTMLTableCellElement> & {
  label: string;
};

export function SheetTable({
  columns,
  children,
  ariaLabel,
  className = "",
  emptyState,
  wrapClassName = ""
}: SheetTableProps) {
  return (
    <div className={["sheet-table-wrap", wrapClassName].filter(Boolean).join(" ")}>
      <table className={["sheet-table", className].filter(Boolean).join(" ")} aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={column.className} key={column.key}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
          {emptyState ? (
            <tr>
              <td colSpan={columns.length}>{emptyState}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function SheetTableCell({ label, children, ...props }: SheetTableCellProps) {
  return (
    <td data-label={label} {...props}>
      {children}
    </td>
  );
}
