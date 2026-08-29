import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({ columns, rows, loading, emptyMessage }: { columns: Column<T>[]; rows: T[]; loading?: boolean; emptyMessage: string }) {
  if (loading) return <LoadingState label="Loading table..." />;
  if (!rows.length) return <EmptyState title="No records" message={emptyMessage} />;

  return (
    <div className="overflow-x-auto rounded-token border border-border bg-surface">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted">
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-muted/60">
              {columns.map((column) => (
                <td key={column.key} className="whitespace-nowrap px-4 py-3 text-text-primary">
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
