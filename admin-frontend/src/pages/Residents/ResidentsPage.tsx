import { Plus, Search, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createResident, getResident, listInstitutions, listResidents } from "../../api/residents";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { DataTable } from "../../components/common/DataTable";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import type { CreateResidentInput, Institution, Resident } from "../../types/api";
import { formatStatus } from "../../utils/format";

const pageSize = 25;
const statuses = ["all", "prospect", "applicant", "resident", "past_resident", "suspended", "archived"];

function residentName(resident: Resident) {
  return [resident.first_name, resident.middle_name, resident.last_name].filter(Boolean).join(" ");
}

function institutionName(institutions: Institution[], id: number | null) {
  if (!id) return "Not set";
  const institution = institutions.find((item) => item.id === id);
  return institution ? institution.name : `Institution #${id}`;
}

function blankForm(): CreateResidentInput {
  return {
    displayName: "",
    institutionId: 0,
    studentId: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    gender: "",
    status: "applicant"
  };
}

export function ResidentsPage() {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role, "resident:write");
  const [residents, setResidents] = useState<Resident[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Resident | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateResidentInput>(() => blankForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load(nextOffset = offset, nextSearch = submittedSearch) {
    setLoading(true);
    setError(null);
    try {
      const [residentResult, institutionResult] = await Promise.all([
        listResidents({ limit: pageSize, offset: nextOffset, search: nextSearch || undefined }),
        listInstitutions()
      ]);
      setResidents(residentResult.residents);
      setInstitutions(institutionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load residents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(0, "");
  }, []);

  const visibleResidents = useMemo(() => {
    return statusFilter === "all" ? residents : residents.filter((resident) => resident.status === statusFilter);
  }, [residents, statusFilter]);

  const summary = useMemo(() => ({
    totalOnPage: residents.length,
    activeOnPage: residents.filter((resident) => resident.status === "resident").length,
    applicantsOnPage: residents.filter((resident) => resident.status === "applicant").length
  }), [residents]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch(search.trim());
    await load(0, search.trim());
  }

  async function openDetail(id: number) {
    setDetailLoading(true);
    try {
      setSelected(await getResident(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load resident.");
    } finally {
      setDetailLoading(false);
    }
  }

  function updateForm<K extends keyof CreateResidentInput>(key: K, value: CreateResidentInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!form.firstName.trim() || !form.lastName.trim() || !form.studentId.trim() || !form.institutionId) {
      setFormError("First name, last name, institution, and student ID are required.");
      return;
    }
    setSaving(true);
    try {
      const displayName = form.displayName.trim() || `${form.firstName.trim()} ${form.lastName.trim()}`;
      await createResident({ ...form, displayName, email: form.email || null, phone: form.phone || null, gender: form.gender || null });
      setCreateOpen(false);
      setForm(blankForm());
      await load(0, submittedSearch);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to create resident.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Residents" eyebrow="Admin" description="Manage resident identities, institution links, and Kissmet reference records." />
        {canCreate ? (
          <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            <Plus className="h-4 w-4" /> Add Resident
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Residents On Page" value={summary.totalOnPage} />
        <StatCard label="Active Residents" value={summary.activeOnPage} tone="success" />
        <StatCard label="Applicants" value={summary.applicantsOnPage} />
      </div>

      <section className="rounded-token border border-border bg-surface p-4">
        <form onSubmit={(event) => void submitSearch(event)} className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label htmlFor="resident-search" className="block text-sm font-medium text-text-primary">Search residents</label>
            <div className="mt-1 flex rounded-md border border-border bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" aria-hidden />
              <input id="resident-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, student ID, or resident code" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          <div>
            <label htmlFor="resident-status" className="block text-sm font-medium text-text-primary">Status</label>
            <select id="resident-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              {statuses.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : formatStatus(status)}</option>)}
            </select>
          </div>
          <button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold text-text-primary hover:bg-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">Search</button>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Server search covers resident code, first name, last name, and student ID. Status filtering applies to the current result page.</p>
      </section>

      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading residents..." /> : visibleResidents.length ? (
        <DataTable<Resident>
          rows={visibleResidents}
          emptyMessage="No residents match the current criteria."
          columns={[
            { key: "code", header: "Resident Code", render: (resident) => resident.resident_code },
            { key: "name", header: "Name", render: (resident) => residentName(resident) },
            { key: "student", header: "Student ID", render: (resident) => resident.student_id ?? "Not set" },
            { key: "institution", header: "Institution", render: (resident) => institutionName(institutions, resident.institution_id) },
            { key: "phone", header: "Phone", render: () => "Not exposed" },
            { key: "status", header: "Status", render: (resident) => <StatusBadge status={resident.status} /> },
            { key: "actions", header: "Actions", render: (resident) => <button type="button" onClick={() => void openDetail(resident.id)} className="text-sm font-semibold text-primary hover:underline">View</button> }
          ]}
        />
      ) : (
        <EmptyState title={submittedSearch || statusFilter !== "all" ? "No matching residents" : "No residents"} message={submittedSearch || statusFilter !== "all" ? "No residents match the current search or filter." : "Residents will appear here after they are created."} />
      )}

      <div className="flex items-center justify-between">
        <button type="button" disabled={offset === 0 || loading} onClick={() => { const next = Math.max(0, offset - pageSize); setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Previous</button>
        <p className="text-sm text-text-secondary">Showing {offset + 1}-{offset + residents.length}</p>
        <button type="button" disabled={residents.length < pageSize || loading} onClick={() => { const next = offset + pageSize; setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Next</button>
      </div>

      <ConfirmDialog open={Boolean(selected) || detailLoading} title="Resident Details" onClose={() => setSelected(null)}>
        {detailLoading || !selected ? <LoadingState label="Loading resident..." /> : <ResidentDetail resident={selected} institution={institutionName(institutions, selected.institution_id)} />}
      </ConfirmDialog>

      <ConfirmDialog open={createOpen} title="Add Resident" description="Resident code is generated by the backend after creation." onClose={() => setCreateOpen(false)}>
        <ResidentCreateForm form={form} institutions={institutions} saving={saving} error={formError} onChange={updateForm} onSubmit={submitCreate} onCancel={() => setCreateOpen(false)} />
      </ConfirmDialog>
    </div>
  );
}

function DetailSection({ title, rows }: { title: string; rows: [string, string | number | null | undefined][] }) {
  return (
    <section className="rounded border border-border p-3">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-text-secondary">{label}</dt>
            <dd className="font-medium text-text-primary">{value || "Not available"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ResidentDetail({ resident, institution }: { resident: Resident; institution: string }) {
  return (
    <div className="space-y-3">
      <DetailSection title="Personal information" rows={[["Name", residentName(resident)], ["Gender", formatStatus(resident.gender)], ["Date of birth", resident.date_of_birth]]} />
      <DetailSection title="Kissmet resident information" rows={[["Resident code", resident.resident_code], ["Status", formatStatus(resident.status)], ["Created", resident.created_at]]} />
      <DetailSection title="Institution/student information" rows={[["Institution", institution], ["Student ID", resident.student_id]]} />
      <DetailSection title="Contact information" rows={[["Phone", "Not exposed by current admin resident API"], ["Email", "Not exposed by current admin resident API"], ["Guardian", resident.guardian_name], ["Guardian phone", resident.guardian_phone], ["Emergency contact", resident.emergency_contact_name], ["Emergency phone", resident.emergency_contact_phone], ["Address", resident.address]]} />
      <DetailSection title="Application information" rows={[["Status", "Use Applications page in a later phase"]]} />
      <DetailSection title="Booking information" rows={[["Status", "Use Bookings page in a later phase"]]} />
      <DetailSection title="Current allocation" rows={[["Status", "Use Allocations page in a later phase"]]} />
      <DetailSection title="Documents" rows={[["Identity documents", "Private files are not exposed in this listing"]]} />
    </div>
  );
}

function ResidentCreateForm({
  form,
  institutions,
  saving,
  error,
  onChange,
  onSubmit,
  onCancel
}: {
  form: CreateResidentInput;
  institutions: Institution[];
  saving: boolean;
  error: string | null;
  onChange: <K extends keyof CreateResidentInput>(key: K, value: CreateResidentInput[K]) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name" value={form.firstName} onChange={(value) => onChange("firstName", value)} required />
        <Field label="Last name" value={form.lastName} onChange={(value) => onChange("lastName", value)} required />
        <Field label="Display name" value={form.displayName} onChange={(value) => onChange("displayName", value)} />
        <Field label="Student ID" value={form.studentId} onChange={(value) => onChange("studentId", value)} required />
        <Field label="Email" value={form.email ?? ""} onChange={(value) => onChange("email", value)} />
        <Field label="Phone" value={form.phone ?? ""} onChange={(value) => onChange("phone", value)} />
        <div>
          <label htmlFor="resident-institution" className="block text-sm font-medium text-text-primary">Institution</label>
          <select id="resident-institution" value={form.institutionId || ""} onChange={(event) => onChange("institutionId", Number(event.target.value))} required className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
            <option value="">Select institution</option>
            {institutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="resident-gender" className="block text-sm font-medium text-text-primary">Gender</label>
          <select id="resident-gender" value={form.gender ?? ""} onChange={(event) => onChange("gender", event.target.value)} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
            <option value="">Not specified</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
            <option value="not_specified">Not specified</option>
          </select>
        </div>
      </div>
      {error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button>
        <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Creating..." : "Create Resident"}</button>
      </div>
    </form>
  );
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  const id = `resident-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-text-primary">{label}</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} required={required} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
    </div>
  );
}
