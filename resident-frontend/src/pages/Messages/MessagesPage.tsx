import { useEffect, useState } from "react";
import { Card } from "../../components/common/Card";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { PageHeader } from "../../components/layout/PageHeader";
import { fetchResidentMessage, fetchResidentMessages, markResidentMessageRead } from "../../api/resident";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { ResidentMessage } from "../../types/resident";
import { messagePreview, unreadMessageCount } from "../../utils/communications";
import { formatDateTime, statusLabel } from "../../utils/format";

export function MessagesPage() {
  const [messages, setMessages] = useState<ResidentMessage[]>([]);
  const [selected, setSelected] = useState<ResidentMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  usePageTitle("Messages");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchResidentMessages();
      setMessages(response.data);
      setSelected(response.data[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load messages.");
    } finally {
      setLoading(false);
    }
  }

  async function openMessage(id: number) {
    setDetailError(null);
    try {
      let response = await fetchResidentMessage(id);
      if (response.data.status === "unread") response = await markResidentMessageRead(id);
      setSelected(response.data);
      setMessages((current) => current.map((message) => message.id === id ? response.data : message));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Unable to load message details.");
    }
  }

  useEffect(() => { void load(); }, []);

  if (loading) return <LoadingState label="Loading messages" />;

  const unread = unreadMessageCount(messages);

  return (
    <>
      <PageHeader title="Messages" description={unread ? `${unread} unread private message${unread === 1 ? "" : "s"}.` : "Private messages delivered to your resident account."} />
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : messages.length === 0 ? (
        <EmptyState title="You don't have any messages yet." message="Private Kissmet messages delivered to you will appear here." actionHref="/home" actionLabel="Back to home" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="space-y-3" aria-label="Message inbox">
            {messages.map((message) => (
              <button
                key={message.id}
                type="button"
                onClick={() => void openMessage(message.id)}
                className={`w-full rounded-token border bg-surface p-4 text-left shadow-token transition hover:border-primary ${selected?.id === message.id ? "border-primary" : "border-border"} ${message.status === "unread" ? "border-l-4 border-l-primary" : ""}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <h2 className="break-anywhere text-base font-semibold text-text-primary">{message.subject}</h2>
                  <span className="inline-flex w-fit rounded-full bg-muted px-3 py-1 text-xs font-semibold text-text-secondary" aria-label={message.status === "unread" ? "Unread message" : "Read message"}>{message.status === "unread" ? "Unread" : "Read"}</span>
                </div>
                <p className="mt-2 text-sm text-text-secondary">{messagePreview(message) || "No message body provided."}</p>
                <p className="mt-3 text-xs font-semibold text-text-secondary">Sent {formatDateTime(message.sent_at ?? message.delivered_at)}</p>
              </button>
            ))}
          </section>
          <Card>
            {detailError ? <ErrorState message={detailError} /> : null}
            {selected ? (
              <article>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-primary">{selected.sender_label ?? "Kissmet Hostel"}</p>
                    <h2 className="mt-1 break-anywhere text-xl font-semibold text-text-primary">{selected.subject}</h2>
                  </div>
                  <span className="inline-flex w-fit rounded-full bg-muted px-3 py-1 text-xs font-semibold text-text-secondary">{selected.status === "unread" ? "Unread" : "Read"}</span>
                </div>
                <div className="mt-5 whitespace-pre-wrap text-sm leading-6 text-text-primary">{selected.body || "No message body provided."}</div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Detail label="Sent" value={formatDateTime(selected.sent_at ?? selected.delivered_at)} />
                  <Detail label="Read" value={formatDateTime(selected.read_at)} />
                  <Detail label="Delivery" value={statusLabel(selected.message_status)} />
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
