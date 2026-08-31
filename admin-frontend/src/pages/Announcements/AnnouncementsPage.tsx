import { Megaphone, Plus, Search } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { archiveAnnouncement, createAnnouncement, expireAnnouncement, getAnnouncement, getAnnouncementReport, listAnnouncements, publishAnnouncement, updateAnnouncement, type AnnouncementInput } from "../../api/announcements";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import type { Announcement, AnnouncementAudience, AnnouncementChannel, AnnouncementReport, AnnouncementSeverity, AnnouncementStatus } from "../../types/api";
import { formatDateTime, formatStatus } from "../../utils/format";

const pageSize = 25;
const statuses: Array<AnnouncementStatus | "all"> = ["all", "draft", "published", "expired", "archived"];
const severities: AnnouncementSeverity[] = ["normal", "important", "high_alert"];
const audiences: AnnouncementAudience[] = ["all", "residents", "staff"];
const channels: AnnouncementChannel[] = ["resident_portal", "staff_portal", "public_website", "sms", "email"];

const channelLabels: Record<AnnouncementChannel, string> = {
  resident_portal: "Resident Portal",
  staff_portal: "Staff/Admin Portal",
  public_website: "Public Website",
  sms: "SMS",
  email: "Email"
};

function emptyInput(): AnnouncementInput {
  return { title: "", body: "", audience: "all", severity: "normal", channels: ["resident_portal", "staff_portal"], startsAt: "", expiresAt: "" };
}

function toLocalInput(value: string | null | undefined) {
  return value ? value.slice(0, 16) : "";
}

function fromLocalInput(value: string | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

export function AnnouncementsPage() {
  const { user } = useAuth();
  const permissions = {
    write: hasPermission(user?.role, "announcement:write"),
    publish: hasPermission(user?.role, "announcement:publish"),
    externalDelivery: hasPermission(user?.role, "announcement:external_delivery")
  };
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [report, setReport] = useState<AnnouncementReport | null>(null);
  const [selected, setSelected] = useState<Announcement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState<AnnouncementInput>(emptyInput);
  const [confirmPublish, setConfirmPublish] = useState<Announcement | null>(null);
  const [statusFilter, setStatusFilter] = useState<AnnouncementStatus | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<AnnouncementSeverity | "all">("all");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function load(nextOffset = offset, nextSearch = submittedSearch) {
    setLoading(true);
    setError(null);
    try {
      const [{ announcements: rows }, metrics] = await Promise.all([
        listAnnouncements({ limit: pageSize, offset: nextOffset, search: nextSearch || undefined }),
        getAnnouncementReport()
      ]);
      setAnnouncements(rows);
      setReport(metrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load announcements.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0, ""); }, []);

  const visible = useMemo(() => announcements.filter((item) => (statusFilter === "all" || item.status === statusFilter) && (severityFilter === "all" || item.severity === severityFilter)), [announcements, severityFilter, statusFilter]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch(search.trim());
    await load(0, search.trim());
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyInput());
    setCreateOpen(true);
    setMutationError(null);
  }

  function openEdit(item: Announcement) {
    setEditing(item);
    setForm({ title: item.title, body: item.body, audience: item.audience, severity: item.severity, channels: item.channels, startsAt: toLocalInput(item.starts_at), expiresAt: toLocalInput(item.expires_at) });
    setMutationError(null);
  }

  async function saveForm(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMutationError(null);
    try {
      const payload = { ...form, title: form.title.trim(), body: form.body.trim(), startsAt: fromLocalInput(form.startsAt), expiresAt: fromLocalInput(form.expiresAt) };
      if (!payload.title || !payload.body || !payload.channels.length) throw new Error("Title, message, and at least one channel are required.");
      const saved = editing ? await updateAnnouncement(editing.id, payload) : await createAnnouncement(payload);
      setSelected(saved);
      setEditing(null);
      setCreateOpen(false);
      await load(0, submittedSearch);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Unable to save announcement.");
    } finally {
      setSaving(false);
    }
  }

  async function mutate(run: () => Promise<Announcement>) {
    setSaving(true);
    setMutationError(null);
    try {
      const updated = await run();
      setSelected(updated);
      setConfirmPublish(null);
      await load(0, submittedSearch);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(item: Announcement) {
    setMutationError(null);
    try { setSelected(await getAnnouncement(item.id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load announcement."); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Announcements" eyebrow="Admin" description="Publish broadcast notices across Kissmet channels." />
        {permissions.write ? <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"><Plus className="h-4 w-4" /> New Announcement</button> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-4"><StatCard label="Published" value={report?.published ?? 0} tone="success" /><StatCard label="Drafts" value={report?.drafts ?? 0} /><StatCard label="High Alerts" value={report?.high_alerts ?? 0} tone="danger" /><StatCard label="Expiring Soon" value={report?.expiring_soon ?? 0} tone="warning" /></div>
      <section className="rounded-token border border-border bg-surface p-4">
        <form onSubmit={(event) => void submitSearch(event)} className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1"><label htmlFor="announcement-search" className="block text-sm font-medium">Search announcements</label><div className="mt-1 flex rounded-md border border-border bg-white"><Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" /><input id="announcement-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title, audience, severity, or status" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" /></div></div>
          <label className="text-sm font-medium">Status<select aria-label="Announcement status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AnnouncementStatus | "all")} className="mt-1 rounded-md border border-border bg-white px-3 py-2">{statuses.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : formatStatus(status)}</option>)}</select></label>
          <label className="text-sm font-medium">Severity<select aria-label="Announcement severity filter" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as AnnouncementSeverity | "all")} className="mt-1 rounded-md border border-border bg-white px-3 py-2"><option value="all">All severities</option>{severities.map((severity) => <option key={severity} value={severity}>{formatStatus(severity)}</option>)}</select></label>
          <button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold">Search</button>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Server search covers title, audience, status, and severity. SMS and email are explicit selected channels only.</p>
      </section>
      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading announcements..." /> : visible.length ? (
        <div className="overflow-x-auto rounded-token border border-border bg-surface"><table className="min-w-full divide-y divide-border text-sm"><thead className="bg-muted"><tr>{["Title", "Severity", "Audience", "Channels", "Status", "Publish Window", "Actions"].map((head) => <th key={head} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">{head}</th>)}</tr></thead><tbody className="divide-y divide-border">{visible.map((item) => <tr key={item.id} className="hover:bg-muted/60"><td className="px-4 py-3 font-medium">{item.title}</td><td className="px-4 py-3"><StatusBadge status={item.severity} /></td><td className="px-4 py-3">{formatStatus(item.audience)}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-1">{item.channels.map((channel) => <span key={channel} className="rounded border border-border bg-muted px-2 py-1 text-xs">{channelLabels[channel]}</span>)}</div></td><td className="px-4 py-3"><StatusBadge status={item.status} /></td><td className="px-4 py-3 text-text-secondary">{formatDateTime(item.starts_at ?? item.published_at)}<br />Expires {formatDateTime(item.expires_at)}</td><td className="px-4 py-3"><button type="button" onClick={() => void openDetail(item)} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium">View</button></td></tr>)}</tbody></table></div>
      ) : <EmptyState title={submittedSearch || statusFilter !== "all" || severityFilter !== "all" ? "No matching announcements" : "No announcements"} message="Draft and published notices will appear here." />}
      <div className="flex items-center justify-between"><button type="button" disabled={offset === 0 || loading} onClick={() => { const next = Math.max(0, offset - pageSize); setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Previous</button><p className="text-sm text-text-secondary">Showing {offset + 1}-{offset + announcements.length}</p><button type="button" disabled={announcements.length < pageSize || loading} onClick={() => { const next = offset + pageSize; setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Next</button></div>

      <ConfirmDialog open={Boolean(selected)} title="Announcement Details" onClose={() => { setSelected(null); setMutationError(null); }}>{selected ? <div className="space-y-4"><div className="flex items-start gap-3"><Megaphone className="mt-1 h-5 w-5 text-primary" /><div><h3 className="text-lg font-semibold">{selected.title}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{selected.body}</p></div></div><div className="grid gap-3 sm:grid-cols-2"><Info label="Severity" value={formatStatus(selected.severity)} /><Info label="Audience" value={formatStatus(selected.audience)} /><Info label="Status" value={formatStatus(selected.status)} /><Info label="Starts" value={formatDateTime(selected.starts_at)} /><Info label="Published" value={formatDateTime(selected.published_at)} /><Info label="Expires" value={formatDateTime(selected.expires_at)} /><Info label="SMS Recipients" value={String(selected.recipient_counts?.sms ?? 0)} /><Info label="Email Recipients" value={String(selected.recipient_counts?.email ?? 0)} /></div><div><p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Channels</p><div className="mt-2 flex flex-wrap gap-2">{selected.channels.map((channel) => <span key={channel} className="rounded border border-border bg-muted px-2 py-1 text-xs">{channelLabels[channel]}</span>)}</div></div>{mutationError ? <ErrorState message={mutationError} /> : null}<div className="flex flex-wrap gap-2">{permissions.write && selected.status === "draft" ? <button type="button" onClick={() => { openEdit(selected); setSelected(null); }} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Edit Draft</button> : null}{permissions.publish && selected.status === "draft" ? <button type="button" onClick={() => setConfirmPublish(selected)} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white">Publish</button> : null}{permissions.publish && selected.status === "published" ? <button type="button" onClick={() => void mutate(() => expireAnnouncement(selected.id))} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Expire</button> : null}{permissions.write && selected.status !== "archived" ? <button type="button" onClick={() => void mutate(() => archiveAnnouncement(selected.id))} disabled={saving} className="rounded-md border border-danger/40 px-3 py-2 text-sm font-semibold text-danger">Archive</button> : null}</div></div> : null}</ConfirmDialog>
      <ConfirmDialog open={Boolean(editing) || createOpen} title={editing ? "Edit Announcement" : "New Announcement"} onClose={() => { if (!saving) { setEditing(null); setCreateOpen(false); setMutationError(null); } }}>{(editing || createOpen) && permissions.write ? <AnnouncementForm form={form} setForm={setForm} saving={saving} error={mutationError} externalDelivery={permissions.externalDelivery} onSubmit={(event) => void saveForm(event)} /> : null}</ConfirmDialog>
      <ConfirmDialog open={Boolean(confirmPublish)} title={confirmPublish?.severity === "high_alert" ? "Publish High Alert?" : "Publish Announcement?"} onClose={() => { if (!saving) setConfirmPublish(null); }}>{confirmPublish ? <div className="space-y-4"><p className="text-sm text-text-secondary">{confirmPublish.severity === "high_alert" ? "This high alert will be published to the selected broadcast channels. SMS or email will only send if those channels were selected." : "This announcement will become visible on the selected portal channels."}</p>{mutationError ? <ErrorState message={mutationError} /> : null}<div className="flex justify-end gap-2"><button type="button" onClick={() => setConfirmPublish(null)} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button><button type="button" onClick={() => void mutate(() => publishAnnouncement(confirmPublish.id, confirmPublish.severity === "high_alert"))} disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white">Publish</button></div></div> : null}</ConfirmDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border bg-muted p-3"><p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}

function AnnouncementForm({ form, setForm, saving, error, externalDelivery, onSubmit }: { form: AnnouncementInput; setForm: (input: AnnouncementInput) => void; saving: boolean; error: string | null; externalDelivery: boolean; onSubmit: (event: FormEvent) => void }) {
  function toggle(channel: AnnouncementChannel) {
    const exists = form.channels.includes(channel);
    setForm({ ...form, channels: exists ? form.channels.filter((item) => item !== channel) : [...form.channels, channel] });
  }
  return <form onSubmit={onSubmit} className="space-y-4"><label className="block text-sm font-medium">Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={180} required className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label><label className="block text-sm font-medium">Message<textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} rows={5} maxLength={5000} required className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Severity<select value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value as AnnouncementSeverity })} className="mt-1 w-full rounded-md border border-border px-3 py-2">{severities.map((severity) => <option key={severity} value={severity}>{formatStatus(severity)}</option>)}</select></label><label className="text-sm font-medium">Audience<select value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value as AnnouncementAudience })} className="mt-1 w-full rounded-md border border-border px-3 py-2">{audiences.map((audience) => <option key={audience} value={audience}>{formatStatus(audience)}</option>)}</select></label><label className="text-sm font-medium">Start datetime<input type="datetime-local" value={form.startsAt ?? ""} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label><label className="text-sm font-medium">Expiry datetime<input type="datetime-local" value={form.expiresAt ?? ""} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label></div><fieldset><legend className="text-sm font-medium">Channels</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{channels.map((channel) => <label key={channel} className={`flex items-center gap-2 rounded-md border border-border p-2 text-sm ${!externalDelivery && (channel === "sms" || channel === "email") ? "opacity-50" : ""}`}><input type="checkbox" checked={form.channels.includes(channel)} disabled={!externalDelivery && (channel === "sms" || channel === "email")} onChange={() => toggle(channel)} />{channelLabels[channel]}</label>)}</div></fieldset>{error ? <ErrorState message={error} /> : null}<div className="flex justify-end"><button type="submit" disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save Draft"}</button></div></form>;
}
