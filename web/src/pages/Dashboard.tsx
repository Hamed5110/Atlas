import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  HandCoins,
  Plane,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
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
import { CardsSkeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { forecastMonthLabel, money } from "@/lib/format";
import type { BudgetForecast, Dashboard, Ticket } from "@/lib/types";

export function DashboardPage() {
  const navigate = useNavigate();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard") });
  const forecast = useQuery({
    queryKey: ["forecast-budget"],
    queryFn: () => api<BudgetForecast>("/ai/forecasts/budget"),
  });
  const tickets = useQuery({
    queryKey: ["tickets", "recent"],
    queryFn: () => api<Ticket[]>("/tickets?limit=6&sort_by=travel_date&sort_order=desc"),
  });

  if (dashboard.isError) return <ErrorState error={dashboard.error} onRetry={dashboard.refetch} />;
  const d = dashboard.data;

  const points = (forecast.data?.forecast ?? []).map((p) => ({
    month: forecastMonthLabel(p.month),
    projected: Number(p.amount),
    band: [Number(p.low ?? p.amount), Number(p.high ?? p.amount)] as [number, number],
  }));

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title="Dashboard"
        subtitle="Live picture of airfare entitlements, tickets, and recovery"
      />
      {dashboard.isPending ? (
        <CardsSkeleton />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Employees"
            value={d?.employees ?? 0}
            hint="Active profiles"
            icon={<Users size={22} />}
            tone="primary"
            onClick={() => navigate("/employees")}
          />
          <StatCard
            label="Open tickets"
            value={d?.open_tickets ?? 0}
            hint="Not yet posted"
            icon={<Plane size={22} />}
            tone="accent"
            onClick={() => navigate("/allocation")}
          />
          <StatCard
            label="Active loans"
            value={d?.active_loans ?? 0}
            hint="Excess recovery in progress"
            icon={<HandCoins size={22} />}
            tone="warning"
            onClick={() => navigate("/loans")}
          />
          <StatCard
            label="Outstanding"
            value={money(d?.outstanding_loans ?? 0)}
            hint="Total loan balance"
            icon={<Wallet size={22} />}
            tone="destructive"
            onClick={() => navigate("/loans")}
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Budget forecast</CardTitle>
                <CardDescription>Projected monthly airfare spend (12 months)</CardDescription>
              </div>
              <Badge variant="default">
                <TrendingUp size={12} /> AI
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {forecast.isPending ? (
              <div className="h-64 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-secondary)]" />
            ) : points.length ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <defs>
                      <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(243 75% 59%)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(262 83% 58%)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 91%)" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: "hsl(220 9% 46%)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(220 9% 46%)" }}
                      axisLine={false}
                      tickLine={false}
                      width={70}
                    />
                    <Tooltip
                      formatter={(value) => money(value)}
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid hsl(220 13% 91%)",
                        fontSize: 12,
                        boxShadow: "0 8px 30px -6px hsl(222 47% 11% / 0.18)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="band"
                      stroke="none"
                      fill="hsl(243 75% 59%)"
                      fillOpacity={0.1}
                    />
                    <Area
                      type="monotone"
                      dataKey="projected"
                      stroke="hsl(243 75% 59%)"
                      strokeWidth={2.5}
                      fill="url(#forecastFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-[var(--color-muted-foreground)]">
                Not enough ticket history to forecast yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent tickets</CardTitle>
                <CardDescription>Latest allocation activity</CardDescription>
              </div>
              <Activity size={16} className="text-[var(--color-muted-foreground)]" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(tickets.data ?? []).slice(0, 6).map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-2.5"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-muted)] text-[11px] font-bold text-[var(--color-primary)]">
                  {t.origin_code}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {t.employee_name || t.employee_code || "Employee"}
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {t.origin_code} → {t.destination_code} · {t.travel_date}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{money(t.ticket_cost)}</p>
                  <p className="text-[11px] font-medium capitalize text-[var(--color-muted-foreground)]">
                    {t.status}
                  </p>
                </div>
              </div>
            ))}
            {tickets.data?.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                No tickets issued yet.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
