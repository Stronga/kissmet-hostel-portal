import { KeyRound, Plus, Search, ShieldCheck, UserCog } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { changeStaffAccountStatus, changeStaffRole, changeStaffStatus, createStaff, getStaff, listRoles, listStaff, resetStaffPassword } from "../../api/staff";
import { useAuth } from "../../auth/AuthContext";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { DataTable } from "../../components/common/DataTable";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import type { CreateStaffInput, RoleCode, Staff } from "../../types/api";
import { formatDateTime, formatStatus } from "../../utils/format";

const pageSize = 25;
const staffStatuses = ["active", "inactive", "archived"] as const;
const accountStatuses = ["active", "inactive", "suspended", "archived"] as const;

type StaffRole = { id: number; code: Exclude<RoleCode, "resident">; name: string };
type StaffStatus = typeof staffStatuses[number];
type AccountStatus = typeof accountStatuses[number];

function staffName(staff: Staff) {
  return staff.display_name || `Staff #${staff.id}`;
}

function currentStaffStatus(staff: Staff) {
  return staff.staff_status ?? staff.status ?? "unknown";
}

function blankForm(): CreateStaffInput {
  return { displayName: "", username: "", email: "", phone: "", roleId: 0, staffCode: "", jobTitle: "", password: "" };
}

export function StaffPage() {
  const { user } = useAuth();
  const canManage = user?.role === "super_admin";
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Staff | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateStaffInput>(() => blankForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description?: string; action: () => Promise<void> } | null>(null);

  async function load(nextOffset = offset, nextSearch = submittedSearch) {
    setLoading(true);
    setError(null);
    try {
      const [staffResult, roleRows] = await Promise.all([listStaff({ limit: pageSize, offset: nextOffset, search: nextSearch || undefined }), listRoles()]);
      setStaff(staffResult.staff);
      setRoles(roleRows as StaffRole[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load staff.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0, ""); }, []);

  const summary = useMemo(() => {
    const active = staff.filter((item) => currentStaffStatus(item) === "active" && item.user_status === "active");
    const roleCount = (role: string) => active.filter((item) => item.role_code === role).length;
    return { active: active.length, managers: roleCount("manager"), reception: roleCount("reception"), accounts: roleCount("accounts"), maintenance: roleCount("maintenance") };
  }, [staff]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    const nextSearch = search.trim();
    setSubmittedSearch(nextSearch);
    setOffset(0);
    await load(0, nextSearch);
  }

  async function openDetail(id: number) {
    setDetailLoading(true);
    setError(null);
    try {
      setSelected(await getStaff(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load staff member.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshSelected() {
    if (selected) setSelected(await getStaff(selected.id));
    await load(offset, submittedSearch);
  }

  async function withSave(action: () => Promise<void>) {
    setSaving(true);
    setFormError(null);
    try {
      await action();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSaving(false);
    }
  }

  function updateForm<K extends keyof CreateStaffInput>(key: K, value: CreateStaffInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!form.displayName.trim() || !form.username.trim() || !form.email.trim() || !form.staffCode.trim() || !form.roleId) {
      setFormError("Name, username, email, staff code, and role are required.");
      return;
    }
    await withSave(async () => {
      const result = await createStaff({
        ...form,
        phone: form.phone || null,
        jobTitle: form.jobTitle || null,
        password: form.password || undefined
      });
      setOneTimePassword(result.initialPassword);
      setCreateOpen(false);
      setForm(blankForm());
      await load(0, submittedSearch);
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Staff" eyebrow="Admin" description="Manage staff identities, login accounts, roles, and account access." />
        {canManage ? <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"><Plus className="h-4 w-4" /> Add Staff</button> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        <StatCard label="Active Staff" value={summary.active} tone="success" />
        <StatCard label="Managers" value={summary.managers} />
        <StatCard label="Reception" value={summary.reception} />
        <StatCard label="Accounts" value={summary.accounts} />
        <StatCard label="Maintenance" value={summary.maintenance} />
      </div>

      <section className="rounded-token border border-border bg-surface p-4">
        <form onSubmit={(event) => void submitSearch(event)} className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label htmlFor="staff-search" className="block text-sm font-medium text-text-primary">Search staff</label>
            <div className="mt-1 flex rounded-md border border-border bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" aria-hidden />
              <input id="staff-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, staff code, username, email, role, or status" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          <button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold text-text-primary hover:bg-border">Search</button>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Server search covers staff code, name, username, email, role, staff status, and account status.</p>
      </section>

      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading staff..." /> : staff.length ? (
        <DataTable<Staff>
          rows={staff}
          emptyMessage="No staff match the current criteria."
          columns={[
            { key: "code", header: "Staff Code", render: (item) => item.staff_code },
            { key: "name", header: "Name", render: staffName },
            { key: "username", header: "Username", render: (item) => item.username ?? "Not set" },
            { key: "email", header: "Email", render: (item) => item.email ?? "Not set" },
            { key: "role", header: "Role", render: (item) => item.role_name ?? formatStatus(item.role_code) },
            { key: "staffStatus", header: "Staff Status", render: (item) => <StatusBadge status={currentStaffStatus(item)} /> },
            { key: "accountStatus", header: "Account Status", render: (item) => <StatusBadge status={item.user_status ?? "unknown"} /> },
            { key: "created", header: "Created", render: (item) => formatDateTime(item.created_at) },
            { key: "actions", header: "Actions", render: (item) => <button type="button" onClick={() => void openDetail(item.id)} className="text-sm font-semibold text-primary hover:underline">View</button> }
          ]}
        />
      ) : <EmptyState title={submittedSearch ? "No matching staff" : "No staff"} message={submittedSearch ? "No staff match the current search." : "Staff accounts will appear here after they are created."} />}

      <div className="flex items-center justify-between">
        <button type="button" disabled={offset === 0 || loading} onClick={() => { const next = Math.max(0, offset - pageSize); setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Previous</button>
        <p className="text-sm text-text-secondary">Showing {staff.length ? offset + 1 : 0}-{offset + staff.length}</p>
        <button type="button" disabled={staff.length < pageSize || loading} onClick={() => { const next = offset + pageSize; setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Next</button>
      </div>

      <ConfirmDialog open={Boolean(selected) || detailLoading} title="Staff Details" onClose={() => { setSelected(null); setFormError(null); }}>
        {detailLoading || !selected ? <LoadingState label="Loading staff member..." /> : (
          <StaffDetail
            staff={selected}
            roles={roles}
            canManage={canManage}
            currentStaffId={user?.staffId ?? null}
            saving={saving}
            error={formError}
            onRole={(roleId) => setConfirm({ title: "Change staff role?", description: "Active sessions for this staff member will be revoked after the role change.", action: () => withSave(async () => { await changeStaffRole(selected.id, roleId); await refreshSelected(); setConfirm(null); }) })}
            onStaffStatus={(status) => setConfirm({ title: `Change staff status to ${formatStatus(status)}?`, description: status === "active" ? undefined : "Active sessions for this staff member will be revoked.", action: () => withSave(async () => { await changeStaffStatus(selected.id, status); await refreshSelected(); setConfirm(null); }) })}
            onAccountStatus={(status) => setConfirm({ title: `Change account status to ${formatStatus(status)}?`, description: status === "active" ? undefined : "Active sessions for this user account will be revoked.", action: () => withSave(async () => { await changeStaffAccountStatus(selected.id, status); await refreshSelected(); setConfirm(null); }) })}
            onResetPassword={() => setConfirm({ title: "Reset staff password?", description: "A temporary password will be shown once and active sessions will be revoked.", action: () => withSave(async () => { const result = await resetStaffPassword(selected.id); setOneTimePassword(result.temporaryPassword); await refreshSelected(); setConfirm(null); }) })}
          />
        )}
      </ConfirmDialog>

      <ConfirmDialog open={createOpen} title="Add Staff" description="Staff code is currently supplied by admins; passwords are hashed by the backend." onClose={() => setCreateOpen(false)}>
        <StaffCreateForm form={form} roles={roles} saving={saving} error={formError} onChange={updateForm} onSubmit={submitCreate} onCancel={() => setCreateOpen(false)} />
      </ConfirmDialog>

      <ConfirmDialog open={Boolean(oneTimePassword)} title="Temporary Password" description="Show this password to the staff member now. It is not stored or shown again by the portal." onClose={() => setOneTimePassword(null)}>
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted px-4 py-3 font-mono text-sm">{oneTimePassword}</div>
          <div className="flex justify-end"><button type="button" onClick={() => setOneTimePassword(null)} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white">Done</button></div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog open={Boolean(confirm)} title={confirm?.title ?? "Confirm change"} description={confirm?.description} onClose={() => setConfirm(null)}>
        {formError ? <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirm(null)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button>
          <button type="button" disabled={saving} onClick={() => void confirm?.action()} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Confirm</button>
        </div>
      </ConfirmDialog>
    </div>
  );
}

function StaffDetail({ staff, roles, canManage, currentStaffId, saving, error, onRole, onStaffStatus, onAccountStatus, onResetPassword }: { staff: Staff; roles: StaffRole[]; canManage: boolean; currentStaffId: number | null; saving: boolean; error: string | null; onRole: (roleId: number) => void; onStaffStatus: (status: StaffStatus) => void; onAccountStatus: (status: AccountStatus) => void; onResetPassword: () => void }) {
  const isSelf = currentStaffId === staff.id;
  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailSection title="Staff" icon={<UserCog className="h-4 w-4" />} rows={[["Staff code", staff.staff_code], ["Name", staffName(staff)], ["Job title", staff.job_title], ["Staff status", formatStatus(currentStaffStatus(staff))], ["Created", formatDateTime(staff.created_at)]]} />
        <DetailSection title="Login Account" icon={<KeyRound className="h-4 w-4" />} rows={[["Username", staff.username], ["Email", staff.email], ["Phone", staff.phone], ["Account status", formatStatus(staff.user_status)], ["Account created", formatDateTime(staff.user_created_at)]]} />
        <DetailSection title="Access" icon={<ShieldCheck className="h-4 w-4" />} rows={[["Role", staff.role_name ?? formatStatus(staff.role_code)], ["Permission model", roleSummary(staff.role_code)], ["Session behavior", "Role, status, account, and password changes revoke active sessions"]]} />
      </div>
      {canManage ? (
        <section className="rounded border border-border p-3">
          <h3 className="text-sm font-semibold text-text-primary">Actions</h3>
          {isSelf ? <p className="mt-2 text-xs text-text-secondary">Self-deactivation is blocked by the backend to avoid invalidating your current access.</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="text-sm font-medium text-text-primary">Role<select aria-label="Change role" value={staff.role_id} disabled={saving} onChange={(event) => onRole(Number(event.target.value))} className="ml-2 rounded-md border border-border bg-white px-3 py-2 text-sm">{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
            {staffStatuses.map((status) => <button key={status} type="button" disabled={saving || currentStaffStatus(staff) === status} onClick={() => onStaffStatus(status)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Staff {formatStatus(status)}</button>)}
            {accountStatuses.map((status) => <button key={status} type="button" disabled={saving || staff.user_status === status} onClick={() => onAccountStatus(status)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Account {formatStatus(status)}</button>)}
            <button type="button" disabled={saving} onClick={onResetPassword} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Reset Password</button>
          </div>
        </section>
      ) : <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-text-secondary">You can view staff records, but staff management actions require Super Admin access.</p>}
    </div>
  );
}

function DetailSection({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: [string, string | number | null | undefined][] }) {
  return (
    <section className="rounded border border-border p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">{icon}{title}</h3>
      <dl className="mt-3 grid gap-2 text-sm">
        {rows.map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="font-medium text-text-primary">{value || "Not available"}</dd></div>)}
      </dl>
    </section>
  );
}

function roleSummary(role?: string) {
  if (role === "super_admin") return "Full administrative access";
  if (role === "manager") return "Operational management access with staff read-only";
  if (role === "accounts") return "Finance, payments, receipts, and finance reports";
  if (role === "reception") return "Resident, application, booking, allocation, and communication operations";
  if (role === "maintenance") return "Maintenance work management and communication";
  return "Role permissions are enforced by the backend";
}

function StaffCreateForm({ form, roles, saving, error, onChange, onSubmit, onCancel }: { form: CreateStaffInput; roles: StaffRole[]; saving: boolean; error: string | null; onChange: <K extends keyof CreateStaffInput>(key: K, value: CreateStaffInput[K]) => void; onSubmit: (event: FormEvent) => void; onCancel: () => void }) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Display name" value={form.displayName} onChange={(value) => onChange("displayName", value)} required />
        <Field label="Username" value={form.username} onChange={(value) => onChange("username", value)} required />
        <Field label="Email" type="email" value={form.email} onChange={(value) => onChange("email", value)} required />
        <Field label="Phone" value={form.phone ?? ""} onChange={(value) => onChange("phone", value)} />
        <Field label="Staff code" value={form.staffCode} onChange={(value) => onChange("staffCode", value)} required />
        <Field label="Job title" value={form.jobTitle ?? ""} onChange={(value) => onChange("jobTitle", value)} />
        <div>
          <label htmlFor="staff-role" className="block text-sm font-medium text-text-primary">Role</label>
          <select id="staff-role" value={form.roleId || ""} onChange={(event) => onChange("roleId", Number(event.target.value))} required className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
            <option value="">Select role</option>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
        </div>
        <Field label="Initial password" type="password" value={form.password ?? ""} onChange={(value) => onChange("password", value)} />
      </div>
      <p className="text-xs text-text-secondary">Leave the password blank to let the backend generate a temporary password. The frontend never sends or receives password hashes.</p>
      {error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button>
        <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Creating..." : "Create Staff"}</button>
      </div>
    </form>
  );
}

function Field({ label, value, onChange, required, type = "text" }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string }) {
  const id = `staff-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-text-primary">{label}</label>
      <input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
    </div>
  );
}
