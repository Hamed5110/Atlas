"use client";

import {
  CalendarClock,
  Clock,
  FileWarning,
  Globe2,
  HandCoins,
  Inbox,
  MapPin,
  PieChart as PieIcon,
  PlaneTakeoff,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/primitives";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { fmtDate, money, num, statusTone, titleCase } from "@/lib/format";
import { employeeRecordPath, loanRecordPath, ticketDocumentPath } from "@/lib/record-links";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DashboardInsights, NamedCount } from "@/lib/types";

type Insights = DashboardInsights;
type Go = (path: string) => void;
type BadgeVariant = BadgeProps["variant"];

const PALETTE = [
  "var(--color-chart-primary)",
  "var(--color-chart-secondary)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-destructive)",
  "var(--color-muted-foreground)",
];

const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid var(--color-border)",
  background: "var(--color-card)",
  fontSize: 12,
  boxShadow: "var(--shadow-pop)",
};

const AXIS = { tick: { fontSize: 11 }, axisLine: false, tickLine: false } as const;

function monthShort(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "short" });
}

function hours(minutes: number): string {
  return `${num(Math.round((minutes / 60) * 10) / 10)} h`;
}

function Widget({
  title,
  hint,
  icon,
  action,
  className,
  testId,
  children,
}: {
  title: string;
  hint?: string;
  icon: ReactNode;
  action?: ReactNode;
  className?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("flex flex-col", className)} data-testid={testId}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-muted)] text-[var(--color-primary)]">
              {icon}
            </span>
            <div className="min-w-0">
              <CardTitle>{title}</CardTitle>
              {hint ? <CardDescription>{hint}</CardDescription> : null}
            </div>
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">{text}</p>
  );
}

function Legendary({ items }: { items: { label: string; value: ReactNode; color: string }[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-sm">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
          <span className="min-w-0 flex-1 truncate text-[var(--color-muted-foreground)]">{item.label}</span>
          <span className="font-semibold tabular-nums">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

function Donut({
  data,
  total,
  totalLabel,
  animate,
}: {
  data: NamedCount[];
  total: number;
  totalLabel: string;
  animate: boolean;
}) {
  return (
    <div className="relative h-44">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="name"
            innerRadius="62%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="var(--color-card)"
            strokeWidth={2}
            isAnimationActive={animate}
          >
            {data.map((item, i) => (
              <Cell key={item.name} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-extrabold tabular-nums">{num(total)}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {totalLabel}
        </span>
      </div>
    </div>
  );
}

/** Second KPI row; each card only renders when the user may see its section. */
export function InsightKpis({ data, go }: { data: Insights; go: Go }) {
  const t = useT();
  const { airfare, attendance, people } = data;
  const docs = people?.documents;
  const cards: ReactNode[] = [];
  if (airfare) {
    cards.push(
      <StatCard
        key="spend"
        label={t("ins.spendYtd")}
        value={money(airfare.spend_ytd)}
        hint={t("ins.spendYtdHint")}
        icon={<TrendingUp size={22} />}
        tone="success"
        onClick={() => go("/reports")}
      />
    );
  }
  if (attendance) {
    const latest = attendance.latest;
    cards.push(
      <StatCard
        key="attendance"
        label={t("ins.attendanceToday")}
        value={latest.rate == null ? "—" : `${latest.rate}%`}
        hint={`${fmtDate(latest.date)} · ${num(latest.late)} ${t("ins.late")} · ${num(latest.absent)} ${t("ins.absent")}`}
        icon={<Clock size={22} />}
        tone={latest.rate != null && latest.rate < 85 ? "warning" : "primary"}
        onClick={() => go("/time-tracking")}
      />
    );
  }
  if (docs) {
    cards.push(
      <StatCard
        key="documents"
        label={t("ins.documents")}
        value={num(docs.expired + docs.due)}
        hint={`${num(docs.expired)} ${t("ins.expired")} · ${num(docs.due)} ${t("ins.dueSoon")}`}
        icon={<FileWarning size={22} />}
        tone={docs.expired ? "destructive" : docs.due ? "warning" : "success"}
        onClick={() => go("/employees")}
      />
    );
  }
  if (airfare) {
    cards.push(
      <StatCard
        key="trips"
        label={t("ins.upcomingTrips")}
        value={num(airfare.upcoming_count)}
        hint={t("ins.next30")}
        icon={<PlaneTakeoff size={22} />}
        tone="accent"
        onClick={() => go("/allocation")}
      />
    );
  }
  if (!cards.length) return null;
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="dashboard-insight-kpis">
      {cards}
    </div>
  );
}

export function SpendTrend({ data, animate }: { data: NonNullable<Insights["airfare"]>; animate: boolean }) {
  const t = useT();
  const points = data.monthly.map((m) => ({
    month: monthShort(m.month),
    paid: Number(m.company_paid),
    tickets: m.tickets,
  }));
  const hasData = points.some((p) => p.tickets > 0);
  return (
    <Widget
      title={t("ins.spendTrend")}
      hint={t("ins.spendTrendHint")}
      icon={<TrendingUp size={16} />}
      className="xl:col-span-2"
      testId="widget-spend-trend"
    >
      {hasData ? (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" {...AXIS} />
              <YAxis yAxisId="paid" width={70} {...AXIS} />
              <YAxis yAxisId="tickets" orientation="right" width={32} allowDecimals={false} {...AXIS} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value, name) => (name === t("ins.companyPaid") ? money(value) : num(value))}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar
                yAxisId="paid"
                dataKey="paid"
                name={t("ins.companyPaid")}
                fill="var(--color-chart-primary)"
                radius={[6, 6, 0, 0]}
                maxBarSize={36}
                isAnimationActive={animate}
              />
              <Line
                yAxisId="tickets"
                dataKey="tickets"
                name={t("ins.tickets")}
                type="monotone"
                stroke="var(--color-warning)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "var(--color-warning)" }}
                isAnimationActive={animate}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Empty text={t("ins.noSpend")} />
      )}
    </Widget>
  );
}

export function TicketPipeline({
  data,
  animate,
  go,
}: {
  data: NonNullable<Insights["airfare"]>;
  animate: boolean;
  go: Go;
}) {
  const t = useT();
  const rows = [...data.by_status].sort((a, b) => b.count - a.count);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <Widget
      title={t("ins.pipeline")}
      hint={t("ins.pipelineHint")}
      icon={<PieIcon size={16} />}
      testId="widget-ticket-pipeline"
      action={
        <button
          type="button"
          onClick={() => go("/allocation")}
          className="text-xs font-semibold text-[var(--color-primary)] hover:underline cursor-pointer"
        >
          {t("ins.open")}
        </button>
      }
    >
      {total ? (
        <>
          <Donut
            data={rows.map((r) => ({ name: titleCase(r.status), count: r.count }))}
            total={total}
            totalLabel={t("ins.tickets")}
            animate={animate}
          />
          <div className="mt-3">
            <Legendary
              items={rows.map((r, i) => ({
                label: titleCase(r.status),
                value: (
                  <>
                    {num(r.count)}
                    <span className="ms-2 text-xs font-medium text-[var(--color-muted-foreground)]">
                      {money(r.amount)}
                    </span>
                  </>
                ),
                color: PALETTE[i % PALETTE.length],
              }))}
            />
          </div>
        </>
      ) : (
        <Empty text={t("page.dashboard.noTickets")} />
      )}
    </Widget>
  );
}

export function AttendanceTrend({
  data,
  animate,
}: {
  data: NonNullable<Insights["attendance"]>;
  animate: boolean;
}) {
  const t = useT();
  const points = data.days.map((d) => ({ ...d, day: fmtDate(d.date).slice(0, 6) }));
  const series = [
    { key: "present", label: t("ins.present"), color: "var(--att-present)" },
    { key: "late", label: t("ins.late"), color: "var(--att-late)" },
    { key: "half_day", label: t("ins.halfDay"), color: "var(--att-half-day)" },
    { key: "missing_punch", label: t("ins.missingPunch"), color: "var(--att-missing)" },
    { key: "absent", label: t("ins.absent"), color: "var(--att-absent)" },
  ];
  return (
    <Widget
      title={t("ins.attendanceTrend")}
      hint={t("ins.attendanceTrendHint")}
      icon={<CalendarClock size={16} />}
      className="xl:col-span-2"
      testId="widget-attendance-trend"
      action={
        <div className="hidden gap-4 text-end sm:flex">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              {t("ins.lateWeek")}
            </p>
            <p className="text-sm font-bold tabular-nums">{hours(data.late_minutes_7d)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              {t("ins.overtimeWeek")}
            </p>
            <p className="text-sm font-bold tabular-nums">{hours(data.overtime_minutes_7d)}</p>
          </div>
        </div>
      }
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" {...AXIS} />
            <YAxis width={40} allowDecimals={false} {...AXIS} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--color-muted)" }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="day"
                fill={s.color}
                maxBarSize={28}
                radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined}
                isAnimationActive={animate}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Widget>
  );
}

function DaysChip({ days }: { days: number }) {
  const t = useT();
  const tone = days < 0 ? "destructive" : days <= 30 ? "warning" : "info";
  const text = days < 0 ? `${num(-days)} ${t("ins.daysOverdue")}` : days === 0 ? t("ins.today") : `${num(days)} ${t("ins.daysLeft")}`;
  return <Badge variant={tone}>{text}</Badge>;
}

export function ExpiryWatch({ data, go }: { data: NonNullable<Insights["people"]>; go: Go }) {
  const t = useT();
  const items = data.documents.items;
  return (
    <Widget
      title={t("ins.expiryWatch")}
      hint={t("ins.expiryWatchHint")}
      icon={<FileWarning size={16} />}
      testId="widget-expiry-watch"
    >
      {items.length ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={`${item.employee_id}-${item.document}`}>
              <button
                type="button"
                onClick={() => go(employeeRecordPath(item.employee_id))}
                className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-2.5 text-start transition-colors hover:bg-[var(--color-muted)] cursor-pointer"
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase",
                    item.days < 0
                      ? "bg-[var(--color-destructive-muted)] text-[var(--color-destructive-emphasis)]"
                      : "bg-[var(--color-warning-muted)] text-[var(--color-warning-emphasis)]"
                  )}
                >
                  {item.document === "passport" ? "PP" : "VS"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.employee}</span>
                  <span className="block text-xs text-[var(--color-muted-foreground)]">
                    {t(item.document === "passport" ? "ins.passport" : "ins.visa")} · {fmtDate(item.expires_on)}
                  </span>
                </span>
                <DaysChip days={item.days} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty text={t("ins.noExpiry")} />
      )}
    </Widget>
  );
}

export function Headcount({ data, animate }: { data: NonNullable<Insights["people"]>; animate: boolean }) {
  const t = useT();
  const rows = data.by_department;
  return (
    <Widget
      title={t("ins.headcount")}
      hint={t("ins.headcountHint")}
      icon={<Users size={16} />}
      testId="widget-headcount"
    >
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        {[
          { label: t("ins.active"), value: data.active },
          { label: t("ins.newJoiners"), value: data.new_joiners },
          { label: t("ins.inactive"), value: data.inactive },
        ].map((item) => (
          <div key={item.label} className="rounded-[var(--radius-sm)] bg-[var(--color-muted)] px-2 py-2">
            <p className="text-lg font-extrabold tabular-nums">{num(item.value)}</p>
            <p className="text-[11px] font-medium text-[var(--color-muted-foreground)]">{item.label}</p>
          </div>
        ))}
      </div>
      {rows.length ? (
        <div style={{ height: rows.length * 30 + 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={110} {...AXIS} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--color-muted)" }} />
              <Bar
                dataKey="count"
                name={t("ins.employees")}
                fill="var(--color-chart-primary)"
                radius={[0, 6, 6, 0]}
                barSize={16}
                label={{ position: "right", fontSize: 11, fill: "var(--color-muted-foreground)" }}
                isAnimationActive={animate}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Empty text={t("ins.noData")} />
      )}
    </Widget>
  );
}

export function NationalityMix({ data, animate }: { data: NonNullable<Insights["people"]>; animate: boolean }) {
  const t = useT();
  const rows = data.by_nationality;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <Widget
      title={t("ins.nationality")}
      hint={t("ins.nationalityHint")}
      icon={<Globe2 size={16} />}
      testId="widget-nationality"
    >
      {total ? (
        <>
          <Donut data={rows} total={total} totalLabel={t("ins.employees")} animate={animate} />
          <div className="mt-3">
            <Legendary
              items={rows.map((r, i) => ({
                label: r.name,
                value: `${num(r.count)} · ${Math.round((r.count * 100) / total)}%`,
                color: PALETTE[i % PALETTE.length],
              }))}
            />
          </div>
        </>
      ) : (
        <Empty text={t("ins.noData")} />
      )}
    </Widget>
  );
}

export function TopDestinations({ data }: { data: NonNullable<Insights["airfare"]> }) {
  const t = useT();
  const rows = data.top_destinations;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Widget
      title={t("ins.destinations")}
      hint={t("ins.destinationsHint")}
      icon={<MapPin size={16} />}
      testId="widget-destinations"
    >
      {rows.length ? (
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={r.code}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="font-bold tracking-wide">{r.code}</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {num(r.count)} {t("ins.trips")} · {money(r.amount)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--color-muted)]">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${(r.count * 100) / max}%`, background: PALETTE[i % PALETTE.length] }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty text={t("ins.noDestinations")} />
      )}
    </Widget>
  );
}

export function LoanRecovery({
  data,
  animate,
  go,
}: {
  data: NonNullable<Insights["loans"]>;
  animate: boolean;
  go: Go;
}) {
  const t = useT();
  const principal = Number(data.principal);
  const share = principal > 0 ? Math.min(100, Math.round((Number(data.recovered) * 100) / principal)) : 0;
  const points = data.monthly_recovery.map((m) => ({ month: monthShort(m.month), amount: Number(m.amount) }));
  return (
    <Widget
      title={t("ins.loanRecovery")}
      hint={t("ins.loanRecoveryHint")}
      icon={<HandCoins size={16} />}
      testId="widget-loan-recovery"
      action={
        <button
          type="button"
          onClick={() => go("/loans")}
          className="text-xs font-semibold text-[var(--color-primary)] hover:underline cursor-pointer"
        >
          {t("ins.open")}
        </button>
      }
    >
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            {t("ins.recovered")}
          </p>
          <p className="text-xl font-extrabold tabular-nums">{share}%</p>
        </div>
        <p className="text-end text-xs text-[var(--color-muted-foreground)]">
          {money(data.recovered)} / {money(data.principal)}
          <br />
          {num(data.open)} {t("ins.openLoans")}
        </p>
      </div>
      <div
        className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--color-muted)]"
        role="progressbar"
        aria-valuenow={share}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("ins.recovered")}
      >
        <div className="h-full rounded-full bg-[var(--color-success)] transition-[width] duration-700" style={{ width: `${share}%` }} />
      </div>
      <p className="mt-4 text-xs font-semibold text-[var(--color-muted-foreground)]">{t("ins.monthlyRecovery")}</p>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="month" {...AXIS} />
            <YAxis hide />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => money(value)} cursor={{ fill: "var(--color-muted)" }} />
            <Bar
              dataKey="amount"
              name={t("ins.recovered")}
              fill="var(--color-success)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={animate}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Widget>
  );
}

export function UpcomingTravel({ data, go }: { data: NonNullable<Insights["airfare"]>; go: Go }) {
  const t = useT();
  return (
    <Widget
      title={t("ins.upcomingTravel")}
      hint={t("ins.upcomingTravelHint")}
      icon={<PlaneTakeoff size={16} />}
      testId="widget-upcoming-travel"
    >
      {data.upcoming.length ? (
        <ul className="space-y-2">
          {data.upcoming.map((trip) => (
            <li key={trip.id}>
              <button
                type="button"
                onClick={() => go(ticketDocumentPath(trip.id))}
                className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-2.5 text-start transition-colors hover:bg-[var(--color-muted)] cursor-pointer"
              >
                <span className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
                  <span className="text-sm font-extrabold leading-none tabular-nums">{trip.travel_date.slice(8, 10)}</span>
                  <span className="text-[9px] font-bold uppercase leading-none">{monthShort(trip.travel_date.slice(0, 7))}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{trip.employee}</span>
                  <span className="block text-xs text-[var(--color-muted-foreground)]">
                    → {trip.destination}
                    {trip.ticket_code ? ` · ${trip.ticket_code}` : ""}
                  </span>
                </span>
                <Badge variant={statusTone(trip.status) as BadgeVariant}>
                  {trip.days === 0 ? t("ins.today") : `${num(trip.days)} ${t("ins.days")}`}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty text={t("ins.noTravel")} />
      )}
    </Widget>
  );
}

export function OpenLoans({ data, go }: { data: NonNullable<Insights["loans"]>; go: Go }) {
  const t = useT();
  const rows = data.open_loans ?? [];
  return (
    <Widget
      title={t("ins.openLoansTitle")}
      hint={t("ins.openLoansHint")}
      icon={<Wallet size={16} />}
      testId="widget-open-loans"
      action={
        <button
          type="button"
          onClick={() => go("/loans")}
          className="text-xs font-semibold text-[var(--color-primary)] hover:underline cursor-pointer"
        >
          {t("ins.open")}
        </button>
      }
    >
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((loan) => (
            <li key={loan.id}>
              <button
                type="button"
                onClick={() => go(loanRecordPath(loan.id))}
                data-testid={`open-loan-${loan.employee_code}`}
                className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-2.5 text-start transition-colors hover:bg-[var(--color-muted)] cursor-pointer"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{loan.employee}</span>
                  <span className="block text-xs text-[var(--color-muted-foreground)]">
                    {loan.loan_code || loan.employee_code} · {titleCase(loan.status)}
                  </span>
                </span>
                <span className="text-sm font-bold tabular-nums">{money(loan.outstanding)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty text={t("ins.noOpenLoans")} />
      )}
    </Widget>
  );
}

export function EssStatus({ data, go }: { data: NonNullable<Insights["ess"]>; go: Go }) {
  const t = useT();
  const max = Math.max(1, ...data.by_status.map((r) => r.count));
  return (
    <Widget
      title={t("ins.ess")}
      hint={t("ins.essHint")}
      icon={<Inbox size={16} />}
      testId="widget-ess"
      action={
        <button
          type="button"
          onClick={() => go("/ess")}
          className="text-xs font-semibold text-[var(--color-primary)] hover:underline cursor-pointer"
        >
          {t("ins.open")}
        </button>
      }
    >
      {data.total ? (
        <ul className="space-y-3">
          {data.by_status.map((row) => (
            <li key={row.status} className="flex items-center gap-3">
              <Badge variant={statusTone(row.status) as BadgeVariant} className="w-24 justify-center">
                {titleCase(row.status)}
              </Badge>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-muted)]">
                <div
                  className="h-full rounded-full bg-[var(--color-chart-primary)]"
                  style={{ width: `${(row.count * 100) / max}%` }}
                />
              </div>
              <span className="w-8 text-end text-sm font-bold tabular-nums">{num(row.count)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty text={t("ins.noEss")} />
      )}
    </Widget>
  );
}