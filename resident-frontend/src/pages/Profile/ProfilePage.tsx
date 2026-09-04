import { FormEvent, useEffect, useRef, useState } from "react";
import { fetchResidentProfile, updateResidentProfile } from "../../api/resident";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { ErrorState } from "../../components/common/ErrorState";
import { FormField } from "../../components/common/FormField";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { ResidentProfile } from "../../types/resident";
import { safeAuthError } from "../../utils/errors";
import { formatDateTime } from "../../utils/format";

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 break-anywhere text-sm font-semibold text-text-primary">{value || "Not available"}</p>
    </div>
  );
}

export function ProfilePage() {
  const [profile, setProfile] = useState<ResidentProfile | null>(null);
  const [form, setForm] = useState({ firstName: "", middleName: "", lastName: "", email: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const submitLock = useRef(false);
  usePageTitle("Profile");

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const result = (await fetchResidentProfile()).data;
      setProfile(result);
      setForm({
        firstName: result.first_name ?? "",
        middleName: result.middle_name ?? "",
        lastName: result.last_name ?? "",
        email: result.email ?? ""
      });
    } catch (err) {
      setError(safeAuthError(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    setSuccess(null);
    setFormError(null);
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setFormError("First name and last name are required.");
      return;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setFormError("Enter a valid email address.");
      return;
    }
    submitLock.current = true;
    setIsSaving(true);
    try {
      const result = (await updateResidentProfile({
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || null,
        lastName: form.lastName.trim(),
        email: form.email.trim() || null
      })).data;
      setProfile(result);
      setSuccess("Profile updated.");
    } catch (err) {
      setFormError(safeAuthError(err));
    } finally {
      submitLock.current = false;
      setIsSaving(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading your profile" />;
  if (error || !profile) {
    return <ErrorState message={error ?? "Unable to load your profile."} onRetry={() => void load()} />;
  }

  const fullName = [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(" ");

  return (
    <>
      <PageHeader title="Profile" description="Your resident profile is scoped to your authenticated Kissmet account." />
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">{fullName || "Resident"}</h2>
              <p className="mt-1 text-sm text-text-secondary">{profile.institution_name ?? "Institution not available"}</p>
            </div>
            <StatusBadge status={profile.status} />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Detail label="Kissmet resident code" value={profile.resident_code} />
            <Detail label="Student ID" value={profile.student_id} />
            <Detail label="Phone" value={profile.phone} />
            <Detail label="Email" value={profile.email} />
            <Detail label="Institution code" value={profile.institution_code} />
            <Detail label="Phone verified" value={formatDateTime(profile.phone_verified_at)} />
          </div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-text-primary">Edit Profile</h2>
          <p className="mt-1 text-sm text-text-secondary">You may update only the fields currently supported by the backend: name and email.</p>
          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <FormField label="First name" name="firstName" autoComplete="given-name" value={form.firstName} onChange={(event) => { const value = event.currentTarget.value; setForm((current) => ({ ...current, firstName: value })); }} disabled={isSaving} />
            <FormField label="Middle name" name="middleName" autoComplete="additional-name" value={form.middleName} onChange={(event) => { const value = event.currentTarget.value; setForm((current) => ({ ...current, middleName: value })); }} disabled={isSaving} />
            <FormField label="Last name" name="lastName" autoComplete="family-name" value={form.lastName} onChange={(event) => { const value = event.currentTarget.value; setForm((current) => ({ ...current, lastName: value })); }} disabled={isSaving} />
            <FormField label="Email" value={form.email} onChange={(event) => { const value = event.currentTarget.value; setForm((current) => ({ ...current, email: value })); }} disabled={isSaving} inputMode="email" autoComplete="email" />
            {formError ? <ErrorState message={formError} /> : null}
            {success ? <p className="rounded-token bg-muted p-3 text-sm font-semibold text-success">{success}</p> : null}
            <Button type="submit" disabled={isSaving}>{isSaving ? "Saving" : "Save profile"}</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
