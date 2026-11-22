import { Eye, EyeOff } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { changePassword } from "../../api/auth";
import { useAuth } from "../../auth/AuthContext";
import { passwordProblems } from "../../utils/passwordPolicy";

/**
 * Self-service staff password change. When the account is flagged (bootstrap temporary password,
 * administrative reset, or a newly created account) this is the only screen available and the
 * backend rejects every other staff route until the password is changed.
 */
export function ChangePasswordPage() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const forced = Boolean(user?.mustChangePassword);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const problems = useMemo(() => passwordProblems(newPassword, { email: user?.email ?? null }), [newPassword, user?.email]);
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!currentPassword) return setError("Enter your current password.");
    if (problems.length) return setError("The new password does not meet the requirements below.");
    if (newPassword !== confirmPassword) return setError("The new passwords do not match.");
    if (newPassword === currentPassword) return setError("The new password must be different from the current password.");
    setSaving(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setDone(result.revokedOtherSessions);
      await refreshUser();
      if (forced) navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-md rounded-token border border-border bg-surface p-6 shadow-token">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">Kissmet Hostel Portal</p>
          <h1 className="mt-2 text-2xl font-semibold text-text-primary">{forced ? "Set a new password" : "Change password"}</h1>
          {forced ? (
            <p role="status" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Your password was issued by an administrator. You must choose a new password before you can use the admin portal.
            </p>
          ) : (
            <p className="mt-1 text-sm text-text-secondary">Changing your password signs out your other sessions.</p>
          )}
        </div>
        {done != null && !forced ? (
          <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            Password changed. {done === 1 ? "1 other session was" : `${done} other sessions were`} signed out.
          </p>
        ) : null}
        <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="current-password" className="block text-sm font-medium text-text-primary">Current password</label>
            <input id="current-password" type={show ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" className={inputClass} />
          </div>
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-text-primary">New password</label>
            <input id="new-password" type={show ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
          </div>
          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-text-primary">Confirm new password</label>
            <input id="confirm-password" type={show ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
            {mismatch ? <p className="mt-1 text-xs text-red-700">Passwords do not match.</p> : null}
          </div>
          <button type="button" onClick={() => setShow((v) => !v)} className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {show ? "Hide passwords" : "Show passwords"}
          </button>
          <ul aria-label="Password requirements" className="space-y-1 text-xs">
            {newPassword && problems.length === 0 ? <li className="text-green-700">Meets the password policy.</li> : null}
            {(newPassword ? problems : passwordProblems("")).map((p) => <li key={p} className="text-text-secondary">• {p}</li>)}
          </ul>
          {error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <button type="submit" disabled={saving} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70">
            {saving ? "Saving..." : "Change password"}
          </button>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          {forced ? <span /> : <Link to="/dashboard" className="text-primary hover:underline">Back to dashboard</Link>}
          <button type="button" onClick={() => void logout()} className="text-text-secondary hover:text-text-primary">Log out</button>
        </div>
      </section>
    </main>
  );
}
