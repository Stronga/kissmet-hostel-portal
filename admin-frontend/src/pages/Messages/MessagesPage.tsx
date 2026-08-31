import { MessageSquare, Plus, Search } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { archiveMessage, createMessage, getMessage, listMessages, previewMessageTarget, sendMessage, type CreateMessageInput } from "../../api/messages";
import { listResidents } from "../../api/residents";
import { listAllocations } from "../../api/allocations";
import { listRooms } from "../../api/rooms";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import type { Allocation, Message, MessageChannel, MessagePreview, MessageStatus, MessageTargetType, Resident, Room } from "../../types/api";
import { formatDateTime, formatStatus } from "../../utils/format";

const pageSize = 25;
const channels: MessageChannel[] = ["portal", "sms", "email"];
const channelLabels: Record<MessageChannel, string> = { portal: "Portal", sms: "SMS", email: "Email" };
const groups = ["current_residents", "applicants", "active_allocations", "outstanding_balance", "academic_session"];

function blank(): CreateMessageInput {
  return { subject: "", body: "", targetType: "individual_resident", targetIds: [], group: "current_residents", channels: ["portal"] };
}

export function MessagesPage() {
  const { user } = useAuth();
  const permissions = {
    write: hasPermission(user?.role, "message:write"),
    send: hasPermission(user?.role, "message:send"),
    external: hasPermission(user?.role, "message:external_delivery")
  };
  const [messages, setMessages] = useState<Message[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [form, setForm] = useState<CreateMessageInput>(blank);
  const [preview, setPreview] = useState<MessagePreview | null>(null);
  const [selected, setSelected] = useState<Message | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmSend, setConfirmSend] = useState<Message | null>(null);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<MessageStatus | "all">("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function load(nextOffset = offset, nextSearch = submittedSearch) {
    setLoading(true);
    setError(null);
    try {
      const [{ messages: rows }, { residents: residentRows }, { allocations: allocationRows }, roomRows] = await Promise.all([
        listMessages({ limit: pageSize, offset: nextOffset, search: nextSearch || undefined }),
        listResidents({ limit: 100, offset: 0 }),
        listAllocations({ limit: 100, offset: 0 }),
        listRooms()
      ]);
      setMessages(rows);
      setResidents(residentRows);
      setAllocations(allocationRows);
      setRooms(roomRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load messages.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0, ""); }, []);

  const visible = useMemo(() => messages.filter((message) => statusFilter === "all" || message.status === statusFilter), [messages, statusFilter]);
  const stats = useMemo(() => ({ drafts: messages.filter((m) => m.status === "draft").length, sent: messages.filter((m) => m.status === "sent").length, partial: messages.filter((m) => m.status === "partially_failed").length, failed: messages.filter((m) => m.status === "failed").length }), [messages]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch(search.trim());
    await load(0, search.trim());
  }

  async function runPreview(next = form) {
    setMutationError(null);
    try { setPreview(await previewMessageTarget(next)); }
    catch (err) { setPreview(null); setMutationError(err instanceof Error ? err.message : "Unable to preview recipients."); }
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMutationError(null);
    try {
      if (!form.subject.trim() || !form.body.trim() || !form.channels.length) throw new Error("Subject, body, and at least one channel are required.");
      const created = await createMessage({ ...form, subject: form.subject.trim(), body: form.body.trim() });
      setCreateOpen(false);
      setSelected(created);
      await load(0, submittedSearch);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Unable to create message.");
    } finally { setSaving(false); }
  }

  async function mutate(run: () => Promise<Message>) {
    setSaving(true);
    setMutationError(null);
    try {
      const updated = await run();
      setSelected(updated);
      setConfirmSend(null);
      await load(0, submittedSearch);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Request failed.");
    } finally { setSaving(false); }
  }

  async function openDetail(message: Message) {
    try { setSelected(await getMessage(message.id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load message."); }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><PageHeader title="Messaging" eyebrow="Admin" description="Send targeted portal, SMS and email communications." />{permissions.write ? <button type="button" onClick={() => { setForm(blank()); setPreview(null); setCreateOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> New Message</button> : null}</div>
    <div className="grid gap-3 sm:grid-cols-4"><StatCard label="Drafts" value={stats.drafts} /><StatCard label="Sent" value={stats.sent} tone="success" /><StatCard label="Partial Failures" value={stats.partial} tone="warning" /><StatCard label="Failed" value={stats.failed} tone="danger" /></div>
    <section className="rounded-token border border-border bg-surface p-4"><form onSubmit={(event) => void submitSearch(event)} className="flex flex-col gap-3 xl:flex-row xl:items-end"><div className="flex-1"><label htmlFor="message-search" className="block text-sm font-medium">Search messages</label><div className="mt-1 flex rounded-md border border-border bg-white"><Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" /><input id="message-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Subject, target, status, or type" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" /></div></div><label className="text-sm font-medium">Status<select aria-label="Message status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as MessageStatus | "all")} className="mt-1 rounded-md border border-border bg-white px-3 py-2"><option value="all">All statuses</option>{["draft", "queued", "sent", "partially_failed", "failed", "archived"].map((s) => <option key={s} value={s}>{formatStatus(s)}</option>)}</select></label><button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold">Search</button></form><p className="mt-2 text-xs text-text-secondary">Server search covers subject, target label, status, and target type. Contact details are not exposed.</p></section>
    {error ? <ErrorState message={error} /> : null}
    {loading ? <LoadingState label="Loading messages..." /> : visible.length ? <div className="overflow-x-auto rounded-token border border-border bg-surface"><table className="min-w-full divide-y divide-border text-sm"><thead className="bg-muted"><tr>{["Subject", "Target", "Channels", "Recipients", "Sent By", "Status", "Sent", "Actions"].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">{h}</th>)}</tr></thead><tbody className="divide-y divide-border">{visible.map((message) => <tr key={message.id}><td className="px-4 py-3 font-medium">{message.subject}</td><td className="px-4 py-3">{message.target_label ?? formatStatus(message.target_type)}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-1">{message.channels.map((c) => <span key={c} className="rounded border border-border bg-muted px-2 py-1 text-xs">{channelLabels[c]}</span>)}</div></td><td className="px-4 py-3">{message.recipient_count ?? 0}</td><td className="px-4 py-3">{message.sent_by_name ?? "Not sent"}</td><td className="px-4 py-3"><StatusBadge status={message.status} /></td><td className="px-4 py-3">{formatDateTime(message.sent_at)}</td><td className="px-4 py-3"><button type="button" onClick={() => void openDetail(message)} className="rounded-md border border-border px-3 py-1.5 text-sm">View</button></td></tr>)}</tbody></table></div> : <EmptyState title={submittedSearch || statusFilter !== "all" ? "No matching messages" : "No messages"} message="Targeted communication history will appear here." />}
    <ConfirmDialog open={createOpen} title="New Message" onClose={() => { if (!saving) setCreateOpen(false); }}>{createOpen ? <MessageForm form={form} setForm={(next) => { setForm(next); setPreview(null); }} residents={residents} rooms={rooms} allocations={allocations} preview={preview} canExternal={permissions.external} saving={saving} error={mutationError} onPreview={() => void runPreview()} onSubmit={(event) => void saveDraft(event)} /> : null}</ConfirmDialog>
    <ConfirmDialog open={Boolean(selected)} title="Message Details" onClose={() => { setSelected(null); setMutationError(null); }}>{selected ? <MessageDetail message={selected} canSend={permissions.send} saving={saving} error={mutationError} onSend={() => setConfirmSend(selected)} onArchive={() => void mutate(() => archiveMessage(selected.id))} /> : null}</ConfirmDialog>
    <ConfirmDialog open={Boolean(confirmSend)} title="Send Message?" onClose={() => { if (!saving) setConfirmSend(null); }}>{confirmSend ? <div className="space-y-4"><p className="text-sm text-text-secondary">Target: {confirmSend.target_label ?? formatStatus(confirmSend.target_type)}. Recipients: {confirmSend.recipient_count ?? 0}. SMS recipients: delivery count is based on the stored eligibility snapshot. Estimated cost: Not configured.</p>{mutationError ? <ErrorState message={mutationError} /> : null}<div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setConfirmSend(null)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button><button type="button" disabled={saving} onClick={() => void mutate(() => sendMessage(confirmSend.id))} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white">Send Message</button></div></div> : null}</ConfirmDialog>
  </div>;
}

function MessageForm({ form, setForm, residents, rooms, allocations, preview, canExternal, saving, error, onPreview, onSubmit }: { form: CreateMessageInput; setForm: (form: CreateMessageInput) => void; residents: Resident[]; rooms: Room[]; allocations: Allocation[]; preview: MessagePreview | null; canExternal: boolean; saving: boolean; error: string | null; onPreview: () => void; onSubmit: (event: FormEvent) => void }) {
  function toggleChannel(channel: MessageChannel) { setForm({ ...form, channels: form.channels.includes(channel) ? form.channels.filter((c) => c !== channel) : [...form.channels, channel] }); }
  function toggleId(id: number) { const ids = form.targetIds ?? []; setForm({ ...form, targetIds: ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id] }); }
  const targetType = form.targetType;
  return <form onSubmit={onSubmit} className="space-y-4"><label className="block text-sm font-medium">Subject<input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label><label className="block text-sm font-medium">Body<textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required rows={5} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label><p className="text-xs text-text-secondary">SMS length: {form.body.length} characters. Provider pricing: Not configured.</p><label className="block text-sm font-medium">Target type<select value={targetType} onChange={(e) => setForm({ ...form, targetType: e.target.value as MessageTargetType, targetIds: [] })} className="mt-1 w-full rounded-md border border-border px-3 py-2">{["individual_resident", "selected_residents", "room", "selected_rooms", "group", "all_residents", "staff"].map((type) => <option key={type} value={type}>{formatStatus(type)}</option>)}</select></label>{["individual_resident", "selected_residents"].includes(targetType) ? <div className="max-h-44 overflow-auto rounded-md border border-border p-2">{residents.map((r) => <label key={r.id} className="flex items-center gap-2 py-1 text-sm"><input type={targetType === "individual_resident" ? "radio" : "checkbox"} checked={(form.targetIds ?? []).includes(r.id)} onChange={() => setForm({ ...form, targetIds: targetType === "individual_resident" ? [r.id] : (form.targetIds ?? []).includes(r.id) ? (form.targetIds ?? []).filter((v) => v !== r.id) : [...(form.targetIds ?? []), r.id] })} />{r.resident_code} - {r.first_name} {r.last_name} - {r.student_id}</label>)}</div> : null}{["room", "selected_rooms"].includes(targetType) ? <div className="max-h-44 overflow-auto rounded-md border border-border p-2">{rooms.map((r) => <label key={r.id} className="flex items-center gap-2 py-1 text-sm"><input type={targetType === "room" ? "radio" : "checkbox"} checked={(form.targetIds ?? []).includes(r.id)} onChange={() => setForm({ ...form, targetIds: targetType === "room" ? [r.id] : (form.targetIds ?? []).includes(r.id) ? (form.targetIds ?? []).filter((v) => v !== r.id) : [...(form.targetIds ?? []), r.id] })} />{r.room_code} current allocated residents: {allocations.filter((a) => a.status === "active" && a.bed_id).length}</label>)}</div> : null}{targetType === "group" ? <label className="block text-sm font-medium">Group<select value={form.group ?? ""} onChange={(e) => setForm({ ...form, group: e.target.value })} className="mt-1 w-full rounded-md border border-border px-3 py-2">{groups.map((g) => <option key={g} value={g}>{formatStatus(g)}</option>)}</select></label> : null}<fieldset><legend className="text-sm font-medium">Channels</legend><div className="mt-2 flex flex-wrap gap-2">{channels.map((channel) => <label key={channel} className={`rounded-md border border-border px-3 py-2 text-sm ${!canExternal && channel !== "portal" ? "opacity-50" : ""}`}><input type="checkbox" className="mr-2" checked={form.channels.includes(channel)} disabled={!canExternal && channel !== "portal"} onChange={() => toggleChannel(channel)} />{channelLabels[channel]}</label>)}</div></fieldset><button type="button" onClick={onPreview} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Preview Recipients</button>{preview ? <div className="rounded-md border border-border bg-muted p-3 text-sm"><p>Target: {preview.targetLabel}</p><p>Total recipients: {preview.totalRecipients}</p><p>SMS eligible: {preview.smsEligible}</p><p>Email eligible: {preview.emailEligible}</p><p>Portal eligible: {preview.portalEligible}</p></div> : null}{error ? <ErrorState message={error} /> : null}<div className="flex justify-end"><button type="submit" disabled={saving || !preview} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Create Draft</button></div></form>;
}

function MessageDetail({ message, canSend, saving, error, onSend, onArchive }: { message: Message; canSend: boolean; saving: boolean; error: string | null; onSend: () => void; onArchive: () => void }) {
  return <div className="space-y-4"><div className="flex gap-3"><MessageSquare className="mt-1 h-5 w-5 text-primary" /><div><h3 className="text-lg font-semibold">{message.subject}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{message.body}</p></div></div><div className="grid gap-3 sm:grid-cols-2"><Info label="Target" value={message.target_label ?? formatStatus(message.target_type)} /><Info label="Status" value={formatStatus(message.status)} /><Info label="Recipients" value={String(message.recipient_count ?? message.recipients?.length ?? 0)} /><Info label="Sent" value={formatDateTime(message.sent_at)} /></div><div><p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Recipients</p><div className="mt-2 max-h-52 overflow-auto rounded-md border border-border">{message.recipients?.length ? message.recipients.map((r) => <div key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0"><span>{r.display_name} {r.resident_code ? `- ${r.resident_code}` : ""}</span><span className="text-text-secondary">SMS: {r.sms_eligible ? "Eligible" : "Not eligible"} | Email: {r.email_eligible ? "Eligible" : "Not eligible"} | Portal: {r.portal_eligible ? "Eligible" : "Not eligible"}</span></div>) : <p className="p-3 text-sm text-text-secondary">Recipients are shown after sending.</p>}</div></div>{error ? <ErrorState message={error} /> : null}<div className="flex flex-wrap gap-2">{canSend && message.status === "draft" ? <button type="button" disabled={saving} onClick={onSend} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white">Send Draft</button> : null}{message.status !== "archived" ? <button type="button" disabled={saving} onClick={onArchive} className="rounded-md border border-danger/40 px-3 py-2 text-sm font-semibold text-danger">Archive</button> : null}</div></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border bg-muted p-3"><p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}
