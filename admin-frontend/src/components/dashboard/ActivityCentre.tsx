import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listActivity, markActivityRead, type ActivityView, type StaffTaskItem } from "../../api/activity";
import { ActivityItem } from "../../design-system/react/ActivityItem";
import { EmptyState, ErrorState, LoadingState } from "../../design-system/react/States";
import { formatStatus } from "../../utils/format";

const pageSize = 20;
const views: Array<{ id: ActivityView; label: string }> = [
  { id: "action_required", label: "Action required" },
  { id: "all", label: "All activity" },
  { id: "completed", label: "Completed" }
];

export function ActivityCentre({ onCollapse }: { onCollapse?: () => void }) {
  const navigate = useNavigate();
  const [view, setView] = useState<ActivityView>("action_required");
  const [items, setItems] = useState<StaffTaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listActivity({ view, limit: pageSize, offset: 0 })
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setTotal(page.pagination.total);
        setOffset(page.items.length);
      })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : "Unable to load activity."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [view]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await listActivity({ view, limit: pageSize, offset });
      setItems((current) => [...current, ...page.items]);
      setTotal(page.pagination.total);
      setOffset((current) => current + page.items.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load more activity.");
    } finally {
      setLoadingMore(false);
    }
  }

  function openItem(item: StaffTaskItem) {
    void markActivityRead(item.id).catch(() => undefined);
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, unread: false } : row));
    navigate(item.href);
  }

  return (
    <section aria-label="Activity and action centre" data-testid="activity-centre">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Activity & Action Centre</h2>
          <p className="text-xs text-text-secondary">Unread is separate from unresolved work.</p>
        </div>
        {onCollapse ? <button type="button" className="km-btn km-btn--ghost" onClick={onCollapse} aria-expanded="true">Collapse</button> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Activity views">
        {views.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={view === entry.id} className={view === entry.id ? "km-btn km-btn--primary" : "km-btn km-btn--secondary"} onClick={() => setView(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {loading ? <LoadingState label="Loading activity" /> : null}
        {error ? <ErrorState title="Activity is unavailable" message={error} /> : null}
        {!loading && !error && !items.length ? <EmptyState title="Nothing in this view" message="Open work from applications, bookings, payments, maintenance, and internet provisioning will appear here." /> : null}
        {!loading && !error ? items.map((item) => (
          <ActivityItem
            key={item.id}
            title={item.title}
            detail={item.unavailableReason ?? item.detail}
            unread={item.unread}
            unresolved={item.unresolved}
            meta={`${formatStatus(item.priority)} priority`}
            onClick={() => openItem(item)}
          />
        )) : null}
      </div>
      {!loading && items.length < total ? (
        <button type="button" className="km-btn km-btn--secondary mt-3" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}
