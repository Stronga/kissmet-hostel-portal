import { Fragment, useState, type KeyboardEvent, type ReactNode } from "react";
import { EmptyState, LoadingState } from "./States";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  renderExpanded,
  caption,
  emptyTitle = "No records",
  emptyMessage = "Nothing matches this view.",
  loading = false,
  loadingLabel = "Loading table",
  defaultExpandedIds = []
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  renderExpanded?: (row: T) => ReactNode;
  caption?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  loading?: boolean;
  loadingLabel?: string;
  defaultExpandedIds?: string[];
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(defaultExpandedIds.map((id) => [id, true]))
  );
  const expandable = Boolean(renderExpanded);

  function toggle(id: string) {
    setOpen((current) => ({ ...current, [id]: !current[id] }));
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const nextRow = rows[event.key === "ArrowDown" ? index + 1 : index - 1];
    if (!nextRow) return;
    event.preventDefault();
    document.getElementById(`km-row-expand-${getRowId(nextRow)}`)?.focus();
  }

  if (loading) return <LoadingState label={loadingLabel} />;
  if (!rows.length) return <EmptyState title={emptyTitle} message={emptyMessage} />;

  return (
    <div className="km-table-scroll">
      <table className="km-table">
        {caption ? <caption className="km-sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {expandable ? <th scope="col"><span className="km-sr-only">Details</span></th> : null}
            {columns.map((column) => (
              <th key={column.key} scope="col">{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const id = getRowId(row);
            const expanded = Boolean(open[id]);
            const panelId = `km-row-panel-${id}`;
            const label = columns[0] ? String(columns[0].header) : "row";
            const nameSource = columns[0]?.render(row);
            const accessibleName = typeof nameSource === "string" || typeof nameSource === "number"
              ? `${expanded ? "Collapse" : "Expand"} ${nameSource}`
              : `${expanded ? "Collapse" : "Expand"} ${label} ${index + 1}`;
            return (
              <Fragment key={id}>
                <tr>
                  {expandable ? (
                    <td className="km-table__expand" data-label="Details">
                      <button
                        id={`km-row-expand-${id}`}
                        type="button"
                        className="km-btn km-btn--ghost km-btn--icon"
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        onClick={() => toggle(id)}
                        onKeyDown={(event) => moveFocus(event, index)}
                      >
                        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
                        <span className="km-sr-only">{accessibleName}</span>
                      </button>
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td key={column.key} data-label={column.header}>{column.render(row)}</td>
                  ))}
                </tr>
                {expandable && expanded ? (
                  <tr className="km-table__detail">
                    <td id={panelId} className="km-table__detail" colSpan={columns.length + 1}>
                      {renderExpanded?.(row)}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
