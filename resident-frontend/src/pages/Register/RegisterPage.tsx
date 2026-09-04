import { FormEvent, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { requestRegistrationOtp, type RegistrationOtpInput } from "../../api/residentAuth";
import { Card } from "../../components/common/Card";
import { ErrorState } from "../../components/common/ErrorState";
import { FormField, SelectField } from "../../components/common/FormField";
import { Button } from "../../components/common/Button";
import { useAuth } from "../../auth/AuthContext";
import { registrationContext, saveVerificationContext } from "../../auth/verificationContext";
import { useInstitutions } from "../../hooks/useInstitutions";
import { usePageTitle } from "../../hooks/usePageTitle";
import { safeAuthError } from "../../utils/errors";

export function RegisterPage() {
  const { isAuthenticated } = useAuth();
  const { institutions, isLoading, error: institutionError } = useInstitutions();
  const navigate = useNavigate();
  const [form, setForm] = useState<RegistrationOtpInput>({
    firstName: "",
    middleName: "",
    lastName: "",
    phone: "",
    email: "",
    institutionCode: "",
    studentId: ""
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLock = useRef(false);
  usePageTitle("Register");

  const options = useMemo(() => institutions.map((item) => ({ value: item.code, label: item.name })), [institutions]);

  if (isAuthenticated) return <Navigate to="/home" replace />;

  function updateField(name: keyof RegistrationOtpInput, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function validate() {
    const nextErrors: Record<string, string> = {};
    if (!form.firstName.trim()) nextErrors.firstName = "First name is required.";
    if (!form.lastName.trim()) nextErrors.lastName = "Last name is required.";
    if (!form.phone.trim()) nextErrors.phone = "Phone number is required.";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) nextErrors.email = "Enter a valid email address.";
    if (!form.institutionCode) nextErrors.institutionCode = "Institution is required.";
    if (!form.studentId.trim()) nextErrors.studentId = "Student ID is required.";
    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    const nextErrors = validate();
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length) return;

    const payload: RegistrationOtpInput = {
      firstName: form.firstName.trim(),
      middleName: form.middleName?.trim() || null,
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      email: form.email?.trim() || null,
      institutionCode: form.institutionCode,
      studentId: form.studentId.trim()
    };

    submitLock.current = true;
    setIsSubmitting(true);
    try {
      const selected = institutions.find((item) => item.code === payload.institutionCode);
      await requestRegistrationOtp(payload);
      saveVerificationContext(registrationContext(payload, selected?.name ?? payload.institutionCode));
      navigate("/verify-otp", { replace: false });
    } catch (error) {
      setSubmitError(safeAuthError(error));
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-2xl">
        <h1 className="text-2xl font-semibold text-text-primary">Resident Registration</h1>
        <p className="mt-2 text-sm text-text-secondary">Create your applicant account after verifying the phone number attached to your student identity.</p>
        {institutionError ? <div className="mt-4"><ErrorState message={institutionError} /></div> : null}
        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
          <FormField label="First name" name="firstName" value={form.firstName} onChange={(event) => updateField("firstName", event.currentTarget.value)} disabled={isSubmitting} error={errors.firstName} autoComplete="given-name" />
          <FormField label="Middle name" name="middleName" value={form.middleName ?? ""} onChange={(event) => updateField("middleName", event.currentTarget.value)} disabled={isSubmitting} autoComplete="additional-name" />
          <FormField label="Last name" name="lastName" value={form.lastName} onChange={(event) => updateField("lastName", event.currentTarget.value)} disabled={isSubmitting} error={errors.lastName} autoComplete="family-name" />
          <FormField label="Phone number" name="phone" value={form.phone} onChange={(event) => updateField("phone", event.currentTarget.value)} disabled={isSubmitting} error={errors.phone} autoComplete="tel" inputMode="tel" />
          <FormField label="Email" name="email" value={form.email ?? ""} onChange={(event) => updateField("email", event.currentTarget.value)} disabled={isSubmitting} error={errors.email} autoComplete="email" inputMode="email" />
          <FormField label="Student ID" name="studentId" value={form.studentId} onChange={(event) => updateField("studentId", event.currentTarget.value)} disabled={isSubmitting} error={errors.studentId} autoComplete="username" />
          <div className="sm:col-span-2">
            <SelectField
              label="Institution"
              name="institutionCode"
              value={form.institutionCode}
              onChange={(event) => updateField("institutionCode", event.currentTarget.value)}
              options={options}
              disabled={isLoading || isSubmitting || Boolean(institutionError) || institutions.length === 0}
              hint={isLoading ? "Loading institutions" : institutions.length === 0 && !institutionError ? "No institutions are available." : undefined}
              error={errors.institutionCode}
            />
          </div>
          {submitError ? <div className="sm:col-span-2"><ErrorState message={submitError} /></div> : null}
          <div className="sm:col-span-2">
            <Button className="w-full" type="submit" disabled={isSubmitting || isLoading || institutions.length === 0}>
              {isSubmitting ? "Sending OTP" : "Start Registration"}
            </Button>
          </div>
        </form>
        <Link to="/login" className="mt-5 inline-block text-sm font-semibold text-primary">Back to login</Link>
      </Card>
    </main>
  );
}
