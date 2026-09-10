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
import { LanguageSwitcher } from "@/components/language-switcher";
import { useT } from "@/lib/i18n";

const NAV = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { href: "/allocation", labelKey: "nav.allocation", icon: Plane, testId: "nav-airfare-allocation" },
  { href: "/employees", labelKey: "nav.employees", icon: Users, testId: "nav-employee-master" },
  { href: "/opening-balances", labelKey: "nav.openingBalances", icon: Scale, testId: "nav-opening-balances" },
  { href: "/loans", labelKey: "nav.loans", icon: HandCoins, testId: "nav-loans" },
  { href: "/finance", labelKey: "nav.finance", icon: Scale, testId: "nav-finance-ledger" },
  { href: "/ess", labelKey: "nav.ess", icon: Inbox, testId: "nav-ess" },
  { href: "/rates", labelKey: "nav.rates", icon: SlidersHorizontal, testId: "nav-rates" },
  { href: "/reports", labelKey: "nav.reports", icon: BarChart3, testId: "nav-reports" },
  { href: "/ai-insights", labelKey: "nav.aiInsights", icon: Sparkles, testId: "nav-ai-insights" },
] as const;

const HR_NAV = [
  { href: "/offer-letters", labelKey: "nav.offerLetters", icon: FileText, testId: "nav-offer-letters" },
  { href: "/contracts", labelKey: "nav.contracts", icon: FileSignature, testId: "nav-contracts" },
] as const;

const ADMIN_NAV = [
  { href: "/settings", labelKey: "nav.settings", icon: Settings2, testId: "nav-settings" },
  { href: "/lookups", labelKey: "nav.lookups", icon: ListTree, testId: "nav-companies" },
  { href: "/users", labelKey: "nav.users", icon: UserCog, testId: "nav-users" },
  { href: "/backups", labelKey: "nav.backups", icon: DatabaseBackup, testId: "nav-backups" },
  { href: "/audit", labelKey: "nav.audit", icon: ScrollText, testId: "nav-audit" },
  {
    href: "/entitlement/reconcile",
    labelKey: "nav.reconcile",
    icon: Scale,
    testId: "nav-entitlement-reconcile",
  },
  {
    href: "/entitlement/accounts",
    labelKey: "nav.accounts",
    icon: Scale,
    testId: "nav-entitlement-accounts",
  },
  {
    href: "/entitlement/rules",
    labelKey: "nav.rules",
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
          ? "bg-[hsl(243_75%_59%/0.18)] text-white ring-1 ring-inset ring-[var(--color-primary)]"
          : "text-[var(--color-sidebar-foreground)] hover:bg-[var(--color-sidebar-accent)] hover:text-white"
      )}
    >
      <Icon size={17} className="shrink-0 opacity-80" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (next.length < 12) {
      toast.warning("Password too short", t("password.hint"));
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
      toast.success(t("password.submit"), "Use your new password next time you sign in.");
      setCurrent("");
      setNext("");
      setConfirm("");
      onClose();
    } catch (error) {
      toast.error(
        t("password.title"),
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
      title={t("password.title")}
      description={t("password.description")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("action.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !current || !next || !confirm}>
            {busy ? "…" : t("password.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("password.current")}>
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label={t("password.next")} hint={t("password.hint")}>
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label={t("password.confirm")}>
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
  const t = useT();

  const { company, logo } = usePrimaryCompany();
  const companyName = company?.name ?? "";

  const logout = () => {
    clear();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-screen" data-testid="app-shell">
      <aside
        className="gradient-sidebar fixed inset-y-0 start-0 z-40 flex w-64 flex-col no-print"
        data-testid="nav-sidebar"
      >
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
              {t("brand.subtitle")}
            </p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3" data-testid="nav-main">
          <p className="px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[hsl(220_14%_50%)]">
            {t("nav.section.operations")}
          </p>
          <div data-testid="nav-operations">
            {NAV.map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                label={t(item.labelKey)}
                icon={item.icon}
                testId={item.testId}
              />
            ))}
          </div>
          {canManage(me) ? (
            <>
              <p className="px-3 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[hsl(220_14%_50%)]">
                {t("nav.section.hr")}
              </p>
              {HR_NAV.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={t(item.labelKey)}
                  icon={item.icon}
                  testId={item.testId}
                />
              ))}
              <p className="px-3 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[hsl(220_14%_50%)]">
                {t("nav.section.admin")}
              </p>
              {ADMIN_NAV.filter(
                (item) => !["/users", "/backups", "/audit"].includes(item.href) || isAdmin(me)
              ).map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={t(item.labelKey)}
                  icon={item.icon}
                  testId={item.testId}
                />
              ))}
            </>
          ) : null}
        </nav>
        <div className="border-t border-[hsl(222_40%_18%)] p-4" data-testid="nav-user-footer">
          <div className="mb-3 flex justify-center">
            <LanguageSwitcher className="border-[hsl(222_40%_22%)] bg-[hsl(222_40%_14%)]" />
          </div>
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
              title={t("action.changePassword")}
              data-testid="btn-change-password"
              className="rounded-[var(--radius-sm)] p-2 text-[var(--color-sidebar-foreground)] transition-colors hover:bg-[var(--color-sidebar-accent)] hover:text-white cursor-pointer"
            >
              <KeyRound size={16} />
            </button>
            <button
              onClick={logout}
              title={t("action.signOut")}
              data-testid="btn-sign-out"
              className="rounded-[var(--radius-sm)] p-2 text-[var(--color-sidebar-foreground)] transition-colors hover:bg-[var(--color-sidebar-accent)] hover:text-white cursor-pointer"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="ms-64 min-h-screen flex-1" data-testid="app-main">
        <div className="mx-auto max-w-[1400px] p-6 lg:p-8">{children}</div>
      </main>
      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
