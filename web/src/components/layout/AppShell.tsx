import {
  BarChart3,
  DatabaseBackup,
  FileSignature,
  FileText,
  HandCoins,
  KeyRound,
  LayoutDashboard,
  ListTree,
  LogOut,
  Plane,
  Scale,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  UserCog,
  Users,
  Inbox,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth, canManage, isAdmin } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Toaster, toast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/allocation", label: "Airfare Allocation", icon: Plane },
  { to: "/employees", label: "Employees", icon: Users },
  { to: "/opening-balances", label: "Opening Balances", icon: Scale },
  { to: "/loans", label: "Loans", icon: HandCoins },
  { to: "/ess", label: "ESS Requests", icon: Inbox },
  { to: "/rates", label: "Entitlement Rates", icon: SlidersHorizontal },
  { to: "/offer-letters", label: "Offer Letters", icon: FileText },
  { to: "/contracts", label: "Contracts", icon: FileSignature },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/ai", label: "AI Insights", icon: Sparkles },
] as const;

const ADMIN_NAV = [
  { to: "/preferences", label: "Preferences & Settings", icon: Settings2 },
  { to: "/lookups", label: "Lookups", icon: ListTree },
  { to: "/users", label: "Users & Access", icon: UserCog },
  { to: "/backups", label: "Backup & Restore", icon: DatabaseBackup },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
] as const;

function NavItem({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-all",
          isActive
            ? "bg-[hsl(243_75%_59%/0.18)] text-white shadow-[inset_2px_0_0_var(--color-primary)]"
            : "text-[var(--color-sidebar-foreground)] hover:bg-[var(--color-sidebar-accent)] hover:text-white"
        )
      }
    >
      <Icon size={17} className="shrink-0 opacity-80" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const submit = async () => {
    if (next.length < 12) {
      toast.warning("Password too short", "Use at least 12 characters.");
      return;
    }
    if (next !== confirm) {
      toast.warning("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      toast.success("Password changed", "Use your new password next time you sign in.");
      reset();
      onClose();
    } catch (error) {
      toast.error(
        "Could not change password",
        error instanceof ApiError ? error.detail : "Unexpected error."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change password"
      description="Minimum 12 characters. You will stay signed in on this device."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !current || !next || !confirm}>
            {busy ? "Saving…" : "Change password"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="New password" hint="At least 12 characters">
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

export function AppShell() {
  const { me, clear } = useAuth();
  const navigate = useNavigate();
  const [passwordOpen, setPasswordOpen] = useState(false);

  const logout = () => {
    clear();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="gradient-sidebar fixed inset-y-0 left-0 z-40 flex w-64 flex-col">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <div className="gradient-hero flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] shadow-lg">
            <Plane size={20} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-extrabold tracking-tight text-white">ATLAS HCM</p>
            <p className="text-[11px] font-medium text-[var(--color-sidebar-foreground)]">
              Airfare Management
            </p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
          <p className="px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[hsl(220_14%_50%)]">
            Operations
          </p>
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
          {canManage(me) ? (
            <>
              <p className="px-3 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[hsl(220_14%_50%)]">
                Administration
              </p>
              {ADMIN_NAV.filter(
                (item) => !["/users", "/backups", "/audit"].includes(item.to) || isAdmin(me)
              ).map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </>
          ) : null}
        </nav>
        <div className="border-t border-[hsl(222_40%_18%)] p-4">
          <div className="flex items-center gap-3">
            <div className="gradient-hero flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
              {initials(me?.full_name || me?.username || "?")}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {me?.full_name || me?.username}
              </p>
              <p className="truncate text-[11px] text-[var(--color-sidebar-foreground)]">
                {me?.roles.join(" · ")}
              </p>
            </div>
            <button
              onClick={() => setPasswordOpen(true)}
              title="Change password"
              className="rounded-[var(--radius-sm)] p-2 text-[var(--color-sidebar-foreground)] transition-colors hover:bg-[var(--color-sidebar-accent)] hover:text-white cursor-pointer"
            >
              <KeyRound size={16} />
            </button>
            <button
              onClick={logout}
              title="Sign out"
              className="rounded-[var(--radius-sm)] p-2 text-[var(--color-sidebar-foreground)] transition-colors hover:bg-[var(--color-sidebar-accent)] hover:text-white cursor-pointer"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <main className="ml-64 min-h-screen flex-1">
        <div className="mx-auto max-w-[1400px] p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
      <Toaster />
    </div>
  );
}
