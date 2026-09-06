"use client";

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
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth, canManage, isAdmin } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { usePrimaryCompany } from "@/lib/branding";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { href: "/allocation", label: "Airfare Allocation", icon: Plane, testId: "nav-airfare-allocation" },
  { href: "/employees", label: "Employees", icon: Users, testId: "nav-employee-master" },
  { href: "/opening-balances", label: "Opening Balances", icon: Scale, testId: "nav-opening-balances" },
  { href: "/loans", label: "Loans", icon: HandCoins, testId: "nav-loans" },
  { href: "/ess", label: "ESS Requests", icon: Inbox, testId: "nav-ess" },
  { href: "/rates", label: "Entitlement Rates", icon: SlidersHorizontal, testId: "nav-rates" },
  { href: "/reports", label: "Reports", icon: BarChart3, testId: "nav-reports" },
  { href: "/ai-insights", label: "AI Insights", icon: Sparkles, testId: "nav-ai-insights" },
] as const;

const HR_NAV = [
  { href: "/offer-letters", label: "Offer Letters", icon: FileText, testId: "nav-offer-letters" },
  { href: "/contracts", label: "Contracts", icon: FileSignature, testId: "nav-contracts" },
] as const;

const ADMIN_NAV = [
  { href: "/settings", label: "Settings", icon: Settings2, testId: "nav-settings" },
  { href: "/lookups", label: "Lookups", icon: ListTree, testId: "nav-companies" },
  { href: "/users", label: "Users & Access", icon: UserCog, testId: "nav-users" },
  { href: "/backups", label: "Backup & Restore", icon: DatabaseBackup, testId: "nav-backups" },
  { href: "/audit", label: "Audit Log", icon: ScrollText, testId: "nav-audit" },
  {
    href: "/entitlement/reconcile",
    label: "Advanced: Ledger reconcile",
    icon: Scale,
    testId: "nav-entitlement-reconcile",
  },
  {
    href: "/entitlement/accounts",
    label: "Advanced: Ledger accounts",
    icon: Scale,
    testId: "nav-entitlement-accounts",
  },
  {
    href: "/entitlement/rules",
    label: "Advanced: Rules (legacy)",
    icon: ListTree,
    testId: "nav-entitlement-rules",
  },
] as const;

function NavItem({
  href,
  label,
  icon: Icon,
  testId,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  testId: string;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cn(
        "group flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-all",
        active
          ? "bg-[hsl(243_75%_59%/0.18)] text-white shadow-[inset_2px_0_0_var(--color-primary)]"
          : "text-[var(--color-sidebar-foreground)] hover:bg-[var(--color-sidebar-accent)] hover:text-white"
      )}
    >
      <Icon size={17} className="shrink-0 opacity-80" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

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
      setCurrent("");
      setNext("");
      setConfirm("");
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, clear } = useAuth();
  const router = useRouter();
  const [passwordOpen, setPasswordOpen] = useState(false);

  const { company, logo } = usePrimaryCompany();
  const companyName = company?.name ?? "";

  const logout = () => {
    clear();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-screen" data-testid="app-shell">
      <aside className="gradient-sidebar fixed inset-y-0 left-0 z-40 flex w-64 flex-col no-print" data-testid="nav-sidebar">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5" data-testid="nav-brand">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt="Company logo"
              className="h-10 w-10 rounded-[var(--radius-md)] bg-white object-contain shadow-lg"
            />
          ) : (
            <div className="gradient-hero flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] shadow-lg">
              <Plane size={20} className="text-white" />
            </div>
          )}
          <div>
            <p className="text-sm font-extrabold tracking-tight text-white">
              {companyName || "ATLAS HCM"}
            </p>
            <p className="text-[11px] font-medium text-[var(--color-sidebar-foreground)]">
              Airfare Management
            </p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3" data-testid="nav-main">
          <p className="px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[hsl(220_14%_50%)]">
            Operations
          </p>
          <div data-testid="nav-operations">
            {NAV.map((item) => (
              <NavItem key={item.href} {...item} />
            ))}
          </div>
          {canManage(me) ? (
            <>
              <p className="px-3 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[hsl(220_14%_50%)]">
                HR Documents
              </p>
              {HR_NAV.map((item) => (
                <NavItem key={item.href} {...item} />
              ))}
              <p className="px-3 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[hsl(220_14%_50%)]">
                Administration
              </p>
              {ADMIN_NAV.filter(
                (item) => !["/users", "/backups", "/audit"].includes(item.href) || isAdmin(me)
              ).map((item) => (
                <NavItem key={item.href} {...item} />
              ))}
            </>
          ) : null}
        </nav>
        <div className="border-t border-[hsl(222_40%_18%)] p-4" data-testid="nav-user-footer">
          <div className="flex items-center gap-3">
            <div className="gradient-hero flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
              {initials(me?.display_name || me?.full_name || me?.username || "?")}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white" data-testid="nav-user-name">
                {me?.display_name || me?.full_name || me?.username}
              </p>
              <p className="truncate text-[11px] text-[var(--color-sidebar-foreground)]" data-testid="nav-user-roles">
                {me?.roles.join(" · ")}
              </p>
            </div>
            <button
              onClick={() => setPasswordOpen(true)}
              title="Change password"
              data-testid="btn-change-password"
              className="rounded-[var(--radius-sm)] p-2 text-[var(--color-sidebar-foreground)] transition-colors hover:bg-[var(--color-sidebar-accent)] hover:text-white cursor-pointer"
            >
              <KeyRound size={16} />
            </button>
            <button
              onClick={logout}
              title="Sign out"
              data-testid="btn-sign-out"
              className="rounded-[var(--radius-sm)] p-2 text-[var(--color-sidebar-foreground)] transition-colors hover:bg-[var(--color-sidebar-accent)] hover:text-white cursor-pointer"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="ml-64 min-h-screen flex-1" data-testid="app-main">
        <div className="mx-auto max-w-[1400px] p-6 lg:p-8">{children}</div>
      </main>
      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
