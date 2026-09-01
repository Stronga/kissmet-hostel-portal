import { FormEvent, useEffect, useState } from "react";
import { getSettings, updateGeneralSettings, updatePaymentConfirmation } from "../../api/settings";
import { useAuth } from "../../auth/AuthContext";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import type { SettingsOverview } from "../../types/api";
import { formatCurrencyMinor, formatDateTime, formatStatus } from "../../utils/format";
import { parseMoneyToMinorUnits } from "../../utils/money";

type RequirementType = "full" | "fixed" | "percentage";

function blankGeneral() {
  return { organizationName: "", adminPortalTitle: "", residentPortalTitle: "", supportEmail: "", supportPhone: "", addressText: "", defaultCurrency: "GHS" };
}

function blankPayment() {
  return { requirementType: "full" as RequirementType, fixedAmountMajor: "", percentage: "", currency: "GHS" };
}

export function SettingsPage() {
  const { user } = useAuth();
  const canWrite = user?.role === "super_admin";
  const [settings, setSettings] = useState<SettingsOverview | null>(null);
  const [general, setGeneral] = useState(() => blankGeneral());
  const [payment, setPayment] = useState(() => blankPayment());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmPayment, setConfirmPayment] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await getSettings();
      setSettings(result);
      setGeneral({
        organizationName: result.general.organization_name,
        adminPortalTitle: result.general.admin_portal_title,
        residentPortalTitle: result.general.resident_portal_title,
        supportEmail: result.general.support_email ?? "",
        supportPhone: result.general.support_phone ?? "",
        addressText: result.general.address_text ?? "",
        defaultCurrency: result.general.default_currency
      });
      setPayment({
        requirementType: result.paymentConfirmation?.requirement_type ?? "full",
        fixedAmountMajor: result.paymentConfirmation?.fixed_amount_minor ? String(Number(result.paymentConfirmation.fixed_amount_minor) / 100) : "",
        percentage: result.paymentConfirmation?.percentage_basis_points ? String(Number(result.paymentConfirmation.percentage_basis_points) / 100) : "",
        currency: result.paymentConfirmation?.currency ?? "GHS"
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function saveGeneral(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSuccess(null);
    if (!general.organizationName.trim() || !general.adminPortalTitle.trim() || !general.residentPortalTitle.trim()) {
      setFormError("Organization name and portal titles are required.");
      return;
    }
    setSaving(true);
    try {
      await updateGeneralSettings({
        organizationName: general.organizationName,
        adminPortalTitle: general.adminPortalTitle,
        residentPortalTitle: general.residentPortalTitle,
        supportEmail: general.supportEmail || null,
        supportPhone: general.supportPhone || null,
        addressText: general.addressText || null,
        defaultCurrency: general.defaultCurrency
      });
      setSuccess("General settings saved.");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to save general settings.");
    } finally {
      setSaving(false);
    }
  }

  function validatePayment() {
    if (payment.requirementType === "fixed") {
      return { fixedAmountMinor: parseMoneyToMinorUnits(payment.fixedAmountMajor), percentageBasisPoints: null };
    }
    if (payment.requirementType === "percentage") {
      const value = Number(payment.percentage);
      if (!Number.isFinite(value) || value <= 0 || value > 100) throw new Error("Enter a percentage between 0.01 and 100.");
      return { fixedAmountMinor: null, percentageBasisPoints: Math.round(value * 100) };
    }
    return { fixedAmountMinor: null, percentageBasisPoints: null };
  }

  async function savePayment() {
    setSaving(true);
    setFormError(null);
    setSuccess(null);
    try {
      const parsed = validatePayment();
      await updatePaymentConfirmation({ requirementType: payment.requirementType, currency: payment.currency, ...parsed });
      setSuccess("Payment confirmation policy saved.");
      setConfirmPayment(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to save payment settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading settings..." />;
  if (error) return <ErrorState message={error} />;
  if (!settings) return <ErrorState message="Settings are unavailable." />;

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" eyebrow="Administration" description="Manage global Kissmet Hostel configuration and review externally configured services." />
      {success ? <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">{success}</p> : null}
      {formError ? <ErrorState message={formError} /> : null}

      <section className="rounded-token border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-text-primary">General</h2>
        <p className="mt-1 text-sm text-text-secondary">Editable hostel profile and lightweight portal display settings. These values do not rewrite historical financial records.</p>
        <form onSubmit={(event) => void saveGeneral(event)} noValidate className="mt-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Organization name" value={general.organizationName} onChange={(value) => setGeneral((current) => ({ ...current, organizationName: value }))} disabled={!canWrite} required />
            <Field label="Admin portal title" value={general.adminPortalTitle} onChange={(value) => setGeneral((current) => ({ ...current, adminPortalTitle: value }))} disabled={!canWrite} required />
            <Field label="Resident portal title" value={general.residentPortalTitle} onChange={(value) => setGeneral((current) => ({ ...current, residentPortalTitle: value }))} disabled={!canWrite} required />
            <Field label="Support email" type="email" value={general.supportEmail} onChange={(value) => setGeneral((current) => ({ ...current, supportEmail: value }))} disabled={!canWrite} />
            <Field label="Support phone" value={general.supportPhone} onChange={(value) => setGeneral((current) => ({ ...current, supportPhone: value }))} disabled={!canWrite} />
            <Field label="Default currency" value={general.defaultCurrency} onChange={(value) => setGeneral((current) => ({ ...current, defaultCurrency: value.toUpperCase() }))} disabled={!canWrite} required />
          </div>
          <label className="block text-sm font-medium text-text-primary">Address / location text<textarea value={general.addressText} onChange={(event) => setGeneral((current) => ({ ...current, addressText: event.target.value }))} disabled={!canWrite} rows={3} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none disabled:bg-muted" /></label>
          {canWrite ? <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Save General Settings</button> : <ReadOnlyNote />}
        </form>
      </section>

      <section className="rounded-token border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-text-primary">Academic</h2>
        <p className="mt-1 text-sm text-text-secondary">Academic session CRUD remains in the existing Academic Sessions admin area.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Info label="Active session" value={settings.academic.activeSession?.name} />
          <Info label="Code" value={settings.academic.activeSession?.code} />
          <Info label="Dates" value={settings.academic.activeSession ? `${settings.academic.activeSession.starts_on} to ${settings.academic.activeSession.ends_on}` : null} />
          <div><p className="text-xs text-text-secondary">Status</p>{settings.academic.activeSession ? <StatusBadge status={settings.academic.activeSession.status} /> : <p className="font-medium">Not available</p>}</div>
        </div>
      </section>

      <section className="rounded-token border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-text-primary">Payments</h2>
        <p className="mt-1 text-sm text-text-secondary">This determines how much verified payment a booking must have before it becomes eligible for manual confirmation.</p>
        <div className="mt-3 rounded-md border border-border bg-muted p-3 text-sm">
          <p><span className="font-semibold">Current policy:</span> {paymentPolicyLabel(settings.paymentConfirmation)}</p>
          <p className="mt-1 text-text-secondary">Changing this policy does not automatically confirm bookings, alter payments, alter receipts, rewrite booking totals, rewrite room rates, or clear payment-attention states.</p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="block text-sm font-medium text-text-primary">Requirement<select value={payment.requirementType} onChange={(event) => setPayment((current) => ({ ...current, requirementType: event.target.value as RequirementType }))} disabled={!canWrite} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 disabled:bg-muted"><option value="full">Full payment</option><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select></label>
          {payment.requirementType === "fixed" ? <Field label="Fixed amount (GHS)" value={payment.fixedAmountMajor} onChange={(value) => setPayment((current) => ({ ...current, fixedAmountMajor: value }))} disabled={!canWrite} /> : null}
          {payment.requirementType === "percentage" ? <Field label="Percentage" value={payment.percentage} onChange={(value) => setPayment((current) => ({ ...current, percentage: value }))} disabled={!canWrite} /> : null}
          <Field label="Currency" value={payment.currency} onChange={(value) => setPayment((current) => ({ ...current, currency: value.toUpperCase() }))} disabled={!canWrite} />
        </div>
        {canWrite ? <button type="button" onClick={() => setConfirmPayment(true)} disabled={saving} className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Save Payment Policy</button> : <ReadOnlyNote />}
      </section>

      <section className="rounded-token border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-text-primary">Communications</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3"><Info label="SMS Provider" value={settings.communications.smsProvider} /><Info label="Email Provider" value={settings.communications.emailProvider} /><Info label="Secrets" value={settings.communications.secretsManagedIn} /></div>
        <p className="mt-2 text-sm text-text-secondary">Live Ghana SMS/email providers are configured through Cloudflare secrets/environment, not ordinary D1 settings. Secrets are never exposed here.</p>
      </section>

      <section className="rounded-token border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-text-primary">Security / System</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3"><Info label="Runtime" value={settings.system.runtime} /><Info label="Framework" value={settings.system.framework} /><Info label="Database" value={settings.system.database} /><Info label="Document storage" value={settings.system.documentStorage} /><Info label="Authentication" value={settings.system.authentication} /><Info label="Audit logging" value={settings.system.auditLogging} /></div>
        <p className="mt-2 text-sm text-text-secondary">Password hashes, session tokens, OTP values, API keys, Cloudflare tokens, SMS secrets, and R2 credentials are not exposed through settings.</p>
      </section>

      <ConfirmDialog open={confirmPayment} title="Save payment confirmation policy?" description="This affects future manual booking confirmation eligibility checks but does not change existing bookings, payments, receipts, room rates, or payment-attention records." onClose={() => setConfirmPayment(false)}>
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setConfirmPayment(false)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button><button type="button" disabled={saving} onClick={() => void savePayment()} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Confirm Save</button></div>
      </ConfirmDialog>
    </div>
  );
}

function Field({ label, value, onChange, disabled, required, type = "text" }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; required?: boolean; type?: string }) {
  const id = `settings-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return <div><label htmlFor={id} className="block text-sm font-medium text-text-primary">{label}</label><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-muted" /></div>;
}

function Info({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div><p className="text-xs text-text-secondary">{label}</p><p className="font-medium text-text-primary">{value || "Not available"}</p></div>;
}

function ReadOnlyNote() {
  return <p className="mt-3 rounded-md border border-border bg-muted px-3 py-2 text-sm text-text-secondary">Read-only for your role. System-wide settings changes require Super Admin access.</p>;
}

function paymentPolicyLabel(setting: SettingsOverview["paymentConfirmation"]) {
  if (!setting) return "Not available";
  if (setting.requirement_type === "fixed") return `Fixed amount, ${formatCurrencyMinor(setting.fixed_amount_minor, setting.currency)}`;
  if (setting.requirement_type === "percentage") return `Percentage, ${Number(setting.percentage_basis_points ?? 0) / 100}%`;
  return `Full payment (${setting.currency})`;
}
