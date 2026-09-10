import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Me } from "@/lib/types";
import { useEffect } from "react";
import { LoginPage } from "@/pages/Login";
import { DashboardPage } from "@/pages/Dashboard";
import { AllocationPage } from "@/pages/Allocation";
import { EmployeesPage } from "@/pages/Employees";
import { OpeningBalancesPage } from "@/pages/OpeningBalances";
import { LoansPage } from "@/pages/Loans";
import { EssPage } from "@/pages/Ess";
import { RatesPage } from "@/pages/Rates";
import { ReportsPage } from "@/pages/Reports";
import { AiInsightsPage } from "@/pages/AiInsights";
import { OfferLettersPage } from "@/pages/OfferLetters";
import { ContractsPage } from "@/pages/Contracts";
import { PreferencesPage } from "@/pages/Preferences";
import { LookupsPage } from "@/pages/Lookups";
import { UsersPage } from "@/pages/Users";
import { BackupsPage } from "@/pages/Backups";
import { AuditPage } from "@/pages/Audit";

function Boot({ children }: { children: React.ReactNode }) {
  const { session, me, setMe, clear } = useAuth();
  const location = useLocation();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/auth/me"),
    enabled: Boolean(session),
    retry: false,
  });

  useEffect(() => {
    if (meQuery.data) setMe(meQuery.data);
  }, [meQuery.data, setMe]);

  useEffect(() => {
    if (meQuery.isError) clear();
  }, [meQuery.isError, clear]);

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!me && meQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="gradient-hero flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] shadow-lg">
            <span className="text-xl font-extrabold text-white">A</span>
          </div>
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Boot>
            <AppShell />
          </Boot>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/allocation" element={<AllocationPage />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/opening-balances" element={<OpeningBalancesPage />} />
        <Route path="/loans" element={<LoansPage />} />
        <Route path="/ess" element={<EssPage />} />
        <Route path="/rates" element={<RatesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/ai" element={<AiInsightsPage />} />
        <Route path="/offer-letters" element={<OfferLettersPage />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/preferences" element={<PreferencesPage />} />
        <Route path="/lookups" element={<LookupsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/backups" element={<BackupsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
