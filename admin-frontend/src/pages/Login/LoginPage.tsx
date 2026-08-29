import { Eye, EyeOff } from "lucide-react";
import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";

export function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();

  if (user) return <Navigate to="/dashboard" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!identifier.trim() || !password) {
      setError("Enter your email or username and password.");
      return;
    }
    setLoading(true);
    try {
      await login(identifier.trim(), password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid credentials");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-md rounded-token border border-border bg-surface p-6 shadow-token">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">Kissmet Hostel Portal</p>
          <h1 className="mt-2 text-2xl font-semibold text-text-primary">Staff sign in</h1>
          <p className="mt-1 text-sm text-text-secondary">Use your staff email or username to access the admin portal.</p>
        </div>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <div>
            <label htmlFor="identifier" className="block text-sm font-medium text-text-primary">Email or username</label>
            <input id="identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-text-primary">Password</label>
            <div className="mt-1 flex rounded-md border border-border bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" />
              <button type="button" onClick={() => setShowPassword((value) => !value)} className="px-3 text-text-secondary hover:text-text-primary" aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <button type="submit" disabled={loading} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
