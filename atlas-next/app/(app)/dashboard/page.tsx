"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  HandCoins,
  Plane,
  RefreshCw,
  Scale,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  AttendanceTrend,
  EssStatus,
  ExpiryWatch,
  Headcount,
  InsightKpis,
  LoanRecovery,
  OpenLoans,
  NationalityMix,
  SpendTrend,
  TicketPipeline,
  TopDestinations,
  UpcomingTravel,
} from "@/components/dashboard/insight-widgets";
import { LeaveCountBar } from "@/components/dashboard/leave-count-bar";
import {
  LEAVE_RANGE_STORAGE_KEY,
  LEAVE_RANGES,
  LEAVE_TRACKER_KEY,
  LeaveTracker,
  type LeaveFilter,
  type LeaveRangeKey,
} from "@/components/dashboard/leave-tracker";
import { PendingTicketCountBar } from "@/components/dashboard/pending-ticket-count-bar";
import {
  PENDING_RANGE_STORAGE_KEY,
  PENDING_RANGES,
  PENDING_TICKET_KEY,
  PendingTicketTracker,
  type PendingFilter,
  type PendingRangeKey,
} from "@/components/dashboard/pending-ticket-tracker";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { appPath } from "@/lib/paths";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, PageHeader, StatCard } from "@/components/ui/primitives";
import { CardsSkeleton, ChartSkeleton, ListSkeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { canManage, useAuth } from "@/lib/auth";
import { fmtDate, forecastMonthLabel, money } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";
import { useDashboardInsights } from "@/lib/dashboard-insights";
import { ticketDocumentPath } from "@/lib/record-links";
import type { BudgetForecast, Dashboard, Ticket } from "@/lib/types";

function DashboardPage() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useAuth((s) => s.me);
  const staffDesk = canManage(me);
  const reducedMotion = useReducedMotion();
  const [leaveFilter, setLeaveFilter] = useState<LeaveFilter>("open");
  const [leaveRange, setLeaveRange] = useState<LeaveRangeKey>("recent");
  const [leaveRangeReady, setLeaveRangeReady] = useState(false);
  const [pendingFilter, setPendingFilter] = useState<PendingFilter>("open");
  const [pendingRange, setPendingRange] = useState<PendingRangeKey>("12m");
  const [pendingRangeReady, setPendingRangeReady] = useState(false);
  useEffect(() => {
    const saved = window.localStorage.getItem(LEAVE_RANGE_STORAGE_KEY);
    if (saved && saved in LEAVE_RANGES) setLeaveRange(saved as LeaveRangeKey);
    setLeaveRangeReady(true);
    const pendingSaved = window.localStorage.getItem(PENDING_RANGE_STORAGE_KEY);
    if (pendingSaved && pendingSaved in PENDING_RANGES) {
      setPendingRange(pendingSaved as PendingRangeKey);
    }
    setPendingRangeReady(true);
  }, []);
  const changeLeaveRange = (next: LeaveRangeKey) => {
    setLeaveRange(next);
    window.localStorage.setItem(LEAVE_RANGE_STORAGE_KEY, next);
  };
  const changePendingRange = (next: PendingRangeKey) => {
    setPendingRange(next);
    window.localStorage.setItem(PENDING_RANGE_STORAGE_KEY, next);
  };
  const navigate = (p: string) => router.push(appPath(p));
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/dashboard"),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const forecast = useQuery({
    queryKey: ["forecast-budget"],
    queryFn: () => api<BudgetForecast>("/ai/forecasts/budget"),
    staleTime: 30_000,
    refetchOnMount: "always",
  });
  const tickets = useQuery({
    // "Latest allocation activity" = most recently issued, not highest travel date
    // (a new ticket with an earlier travel date was invisible in the top 6).
    queryKey: ["tickets", "recent", "created_at"],
    queryFn: () => api<Ticket[]>("/tickets?limit=6&sort_by=created_at&sort_order=desc"),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const insights = useDashboardInsights();
  // Live Total Available Funds — exclude Bahraini (locals are not on airfare entitlement).
  const amountBalance = useQuery({
    queryKey: ["dashboard-amount-balance", "excl-bahraini"],
    queryFn: async () => {
      const detail = await api<{ columns: string[]; rows: unknown[][] }>(
        "/reports/detail/airfare-amount-balance?bahraini=exclude"
      );
      const idx = detail.columns.indexOf("Total Available Funds");
      if (idx < 0) return null;
      const total = detail.rows.reduce((sum, row) => sum + Number(row[idx] ?? 0), 0);
      return Number.isFinite(total) ? total : null;
    },
    staleTime: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: 1,
  });

  if (dashboard.isError) return <ErrorState error={dashboard.error} onRetry={dashboard.refetch} />;
  const d = dashboard.data;
  const ins = insights.data;
  const animate = !reducedMotion;
  const balanceValue =
    amountBalance.data != null
      ? amountBalance.data
      : ins?.airfare?.amount_balance != null
        ? Number(ins.airfare.amount_balance)
        : null;
  const refreshing =
    dashboard.isFetching || insights.isFetching || amountBalance.isFetching;
  const refresh = () => {
    void dashboard.refetch();
    void insights.refetch();
    void tickets.refetch();
    void amountBalance.refetch();
    void queryClient.invalidateQueries({ queryKey: LEAVE_TRACKER_KEY });
    void queryClient.invalidateQueries({ queryKey: PENDING_TICKET_KEY });
  };

  const points = (forecast.data?.forecast ?? []).map((p) => ({
    month: forecastMonthLabel(p.month),
    projected: Number(p.amount),
    band: [Number(p.low ?? p.amount), Number(p.high ?? p.amount)] as [number, number],
  }));

  return (
    <div className="min-w-0 animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title={t("page.dashboard.title")}
        subtitle={t("page.dashboard.subtitle")}
        actions={
          <>
            {ins ? (
              <span
                className="inline-flex max-w-full shrink items-center gap-2 truncate rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1 text-xs font-semibold text-[var(--color-muted-foreground)]"
                data-testid="dashboard-as-of"
              >
                <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-success)]" />
                {t("ins.asOf")} {fmtDate(ins.as_of)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              aria-label={t("ins.refresh")}
              title={t("ins.refresh")}
              data-testid="btn-dashboard-refresh"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-primary)] disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw size={14} aria-hidden="true" className={cn(refreshing && "animate-spin")} />
            </button>
          </>
        }
      />
      {staffDesk ? (
        <div
          className="mb-4 grid gap-4 sm:grid-cols-2"
          data-testid="dashboard-pulse-row"
        >
          <LeaveCountBar
            filter={leaveFilter}
            onFilter={setLeaveFilter}
            range={leaveRange}
            rangeReady={leaveRangeReady}
          />
          <PendingTicketCountBar
            filter={pendingFilter}
            onFilter={setPendingFilter}
            range={pendingRange}
            rangeReady={pendingRangeReady}
          />
        </div>
      ) : null}
      {dashboard.isPending ? (
        <CardsSkeleton label={t("state.loading")} />
      ) : (
        <div className="stat-grid min-w-0 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            label={t("ins.amountBalance")}
            value={
              amountBalance.isPending && balanceValue == null
                ? "…"
                : balanceValue == null
                  ? "—"
                  : money(balanceValue)
            }
            hint={t("ins.amountBalanceHint")}
            icon={<Scale size={22} />}
            tone="success"
            onClick={() =>
              navigate("/reports/?report=airfare-amount-balance&bahraini=exclude")
            }
            data-testid="dashboard-amount-balance"
          />
          <StatCard
            label={t("page.dashboard.employees")}
            value={d?.employees ?? 0}
            hint={t("page.dashboard.employeesHint")}
            icon={<Users size={22} />}
            tone="primary"
            onClick={() => navigate("/employees")}
          />
          <StatCard
            label={t("page.dashboard.openTickets")}
            value={d?.open_tickets ?? 0}
            hint={t("page.dashboard.openTicketsHint")}
            icon={<Plane size={22} />}
            tone="accent"
            onClick={() => navigate("/allocation")}
          />
          <StatCard
            label={t("page.dashboard.activeLoans")}
            value={d?.active_loans ?? 0}
            hint={t("page.dashboard.activeLoansHint")}
            icon={<HandCoins size={22} />}
            tone="warning"
            onClick={() => navigate("/loans")}
          />
          <StatCard
            label={t("page.dashboard.outstanding")}
            value={money(d?.outstanding_loans ?? 0)}
            hint={t("page.dashboard.outstandingHint")}
            icon={<Wallet size={22} />}
            tone="destructive"
            onClick={() => navigate("/loans")}
          />
        </div>
      )}
      {ins ? <InsightKpis data={ins} go={navigate} /> : null}

      {staffDesk ? (
        <>
          <LeaveTracker
            filter={leaveFilter}
            onFilterChange={setLeaveFilter}
            range={leaveRange}
            onRangeChange={changeLeaveRange}
            rangeReady={leaveRangeReady}
          />
          <PendingTicketTracker
            filter={pendingFilter}
            onFilterChange={setPendingFilter}
            range={pendingRange}
            onRangeChange={changePendingRange}
            rangeReady={pendingRangeReady}
          />
        </>
      ) : null}

      {insights.isPending ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-3">
          <Card className="p-5 xl:col-span-2">
            <ChartSkeleton label={t("state.loading")} />
          </Card>
          <Card className="p-5">
            <ListSkeleton items={5} label={t("state.loading")} />
          </Card>
        </div>
      ) : ins?.airfare ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-3">
          <SpendTrend data={ins.airfare} animate={animate} />
          <TicketPipeline data={ins.airfare} animate={animate} go={navigate} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("page.dashboard.forecast")}</CardTitle>
                <CardDescription>{t("page.dashboard.forecastHint")}</CardDescription>
              </div>
              <Badge variant="default">
                <TrendingUp size={12} /> AI
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {forecast.isPending ? (
              <ChartSkeleton label={t("state.loading")} />
            ) : points.length ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <defs>
                      <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" style={{ stopColor: "var(--color-chart-primary)" }} stopOpacity={0.35} />
                        <stop offset="100%" style={{ stopColor: "var(--color-chart-secondary)" }} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={70}
                    />
                    <Tooltip
                      formatter={(value) => money(value)}
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid var(--color-border)",
                        fontSize: 12,
                        boxShadow: "var(--shadow-pop)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="band"
                      stroke="none"
                      style={{ fill: "var(--color-chart-primary)" }}
                      fillOpacity={0.1}
                      isAnimationActive={!reducedMotion}
                    />
                    <Area
                      type="monotone"
                      dataKey="projected"
                      style={{ stroke: "var(--color-chart-primary)" }}
                      strokeWidth={2.5}
                      fill="url(#forecastFill)"
                      isAnimationActive={!reducedMotion}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-[var(--color-muted-foreground)]">
                {t("page.dashboard.noForecast")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("page.dashboard.recentTickets")}</CardTitle>
                <CardDescription>{t("page.dashboard.recentTicketsHint")}</CardDescription>
              </div>
              <Activity size={16} className="text-[var(--color-muted-foreground)]" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {tickets.isPending ? (
              <ListSkeleton items={6} label={t("state.loading")} />
            ) : (
              <>
                {(tickets.data ?? []).slice(0, 6).map((ticket) => (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => navigate(ticketDocumentPath(ticket.id))}
                    data-testid={`recent-ticket-${ticket.id}`}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-2.5 text-start transition-colors hover:bg-[var(--color-muted)] cursor-pointer"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-muted)] text-[11px] font-bold text-[var(--color-primary)]">
                      {ticket.origin_code}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {ticket.employee_name || ticket.employee_code || "Employee"}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {ticket.origin_code} → {ticket.destination_code} · {ticket.travel_date}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{money(ticket.ticket_cost)}</p>
                      <p className="text-[11px] font-medium capitalize text-[var(--color-muted-foreground)]">
                        {ticket.status}
                      </p>
                    </div>
                  </button>
                ))}
                {tickets.data?.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                    {t("page.dashboard.noTickets")}
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {ins && (ins.attendance || ins.people) ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-3">
          {ins.attendance ? <AttendanceTrend data={ins.attendance} animate={animate} /> : null}
          {ins.people ? (
            <ExpiryWatch data={ins.people} go={navigate} />
          ) : null}
        </div>
      ) : null}

      {ins && (ins.people || ins.airfare) ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ins.people ? <Headcount data={ins.people} animate={animate} /> : null}
          {ins.people ? <NationalityMix data={ins.people} animate={animate} /> : null}
          {ins.airfare ? <TopDestinations data={ins.airfare} /> : null}
        </div>
      ) : null}

      {ins && (ins.loans || ins.airfare || ins.ess) ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ins.loans ? <LoanRecovery data={ins.loans} animate={animate} go={navigate} /> : null}
          {ins.loans ? <OpenLoans data={ins.loans} go={navigate} /> : null}
          {ins.airfare ? <UpcomingTravel data={ins.airfare} go={navigate} /> : null}
          {ins.ess ? <EssStatus data={ins.ess} go={navigate} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export default DashboardPage;
