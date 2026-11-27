export function Pagination({
  page,
  pageCount,
  onPageChange,
  label = "Pagination"
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  const safeCount = Math.max(pageCount, 1);
  return (
    <nav className="km-pagination" aria-label={label}>
      <button
        type="button"
        className="km-btn km-btn--secondary"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
      >
        Previous
      </button>
      <p className="km-pagination__status">Page {page} of {safeCount}</p>
      <button
        type="button"
        className="km-btn km-btn--secondary"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= safeCount}
      >
        Next
      </button>
    </nav>
  );
}
