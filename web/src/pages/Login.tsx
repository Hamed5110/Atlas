import { Plane, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { login } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await login(username.trim(), password);
      setSession(session);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="gradient-sidebar hidden w-[46%] flex-col justify-between p-12 lg:flex">
        <div className="flex items-center gap-3">
          <div className="gradient-hero flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] shadow-lg">
            <Plane size={22} className="text-white" />
          </div>
          <div>
            <p className="text-lg font-extrabold tracking-tight text-white">ATLAS HCM</p>
            <p className="text-xs font-medium text-[var(--color-sidebar-foreground)]">
              Airfare Management Suite
            </p>
          </div>
        </div>
        <div className="space-y-8">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white">
            Airfare entitlements,
            <br />
            <span className="text-gradient">perfectly managed.</span>
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-[var(--color-sidebar-foreground)]">
            Entitlement calculation, ticket allocation, excess recovery loans, self-service
            approvals, and AI-driven diagnostics — one platform, one database.
          </p>
          <div className="space-y-3">
            {[
              { icon: ShieldCheck, text: "Role-based access with full audit trail" },
              { icon: Sparkles, text: "Self-healing AI diagnostics and budget forecasting" },
              { icon: Plane, text: "End-to-end ticket workflow: issue → approve → post" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(243_75%_59%/0.2)]">
                  <Icon size={15} className="text-[hsl(243_90%_75%)]" />
                </div>
                <span className="text-sm text-[var(--color-sidebar-foreground)]">{text}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-[hsl(220_14%_45%)]">
          Powered by FastAPI · React · Microsoft SQL Server
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm animate-[slide-up_0.35s_cubic-bezier(0.16,1,0.3,1)]">
          <div className="mb-8 lg:hidden">
            <div className="gradient-hero mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)]">
              <Plane size={24} className="text-white" />
            </div>
            <h1 className="text-2xl font-extrabold">ATLAS HCM</h1>
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight">Welcome back</h2>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Sign in to your HCM workspace
          </p>
          <form onSubmit={submit} className="mt-8 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. hamed.khan"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error ? (
              <div className="rounded-[var(--radius-sm)] border border-[hsl(0_72%_51%/0.3)] bg-[hsl(0_72%_97%)] px-3 py-2 text-sm font-medium text-[var(--color-destructive)]">
                {error}
              </div>
            ) : null}
            <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
