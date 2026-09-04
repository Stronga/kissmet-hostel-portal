import { useEffect, useState } from "react";
import { Card } from "../../components/common/Card";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { PageHeader } from "../../components/layout/PageHeader";
import { fetchResidentAnnouncement, fetchResidentAnnouncements } from "../../api/resident";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { ResidentAnnouncement } from "../../types/resident";
import { announcementSeverityLabel, announcementSeverityTone, messagePreview } from "../../utils/communications";
import { formatDateTime } from "../../utils/format";

export function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<ResidentAnnouncement[]>([]);
  const [selected, setSelected] = useState<ResidentAnnouncement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  usePageTitle("Announcements");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchResidentAnnouncements();
      setAnnouncements(response.data);
      setSelected(response.data[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load announcements.");
    } finally {
      setLoading(false);
    }
  }

  async function openAnnouncement(id: number) {
    setDetailError(null);
    try {
      const response = await fetchResidentAnnouncement(id);
      setSelected(response.data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Unable to load announcement details.");
    }
  }

  useEffect(() => { void load(); }, []);

  if (loading) return <LoadingState label="Loading announcements" />;

  return (
    <>
      <PageHeader title="Announcements" description="Published Kissmet notices visible to residents." />
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : announcements.length === 0 ? (
        <EmptyState title="No announcements right now." message="Published resident notices will appear here." actionHref="/home" actionLabel="Back to home" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="space-y-3" aria-label="Announcement list">
            {announcements.map((announcement) => (
              <button
                key={announcement.id}
                type="button"
                onClick={() => void openAnnouncement(announcement.id)}
                className={`w-full rounded-token border bg-surface p-4 text-left shadow-token transition hover:border-primary ${selected?.id === announcement.id ? "border-primary" : "border-border"}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <h2 className="break-anywhere text-base font-semibold text-text-primary">{announcement.title}</h2>
                  <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${announcementSeverityTone(announcement.severity)}`}>
                    {announcementSeverityLabel(announcement.severity)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-text-secondary">{messagePreview({ body: announcement.body ?? "" }, 110) || "No announcement details provided."}</p>
                <p className="mt-3 text-xs font-semibold text-text-secondary">Published {formatDateTime(announcement.published_at ?? announcement.starts_at)}</p>
              </button>
            ))}
          </section>
          <Card>
            {detailError ? <ErrorState message={detailError} /> : null}
            {selected ? (
              <article>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-primary">Announcement</p>
                    <h2 className="mt-1 break-anywhere text-xl font-semibold text-text-primary">{selected.title}</h2>
                  </div>
                  <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${announcementSeverityTone(selected.severity)}`}>
                    {announcementSeverityLabel(selected.severity)}
                  </span>
                </div>
                <div className="mt-5 whitespace-pre-wrap text-sm leading-6 text-text-primary">{selected.body || "No announcement details provided."}</div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Detail label="Published" value={formatDateTime(selected.published_at ?? selected.starts_at)} />
                  <Detail label="Expires" value={formatDateTime(selected.expires_at)} />
                </div>
              </article>
            ) : null}
          </Card>
        </div>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 text-sm font-semibold text-text-primary">{value}</p>
    </div>
  );
}
