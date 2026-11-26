"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { appPath } from "@/lib/paths";
import {
  clearSessionActivity,
  startSessionIdleWatcher,
  touchSessionActivity,
} from "@/lib/session-idle";
import type { Me } from "@/lib/types";
import { toast } from "@/components/ui/toast";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, me, hydrated, setMe, clear } = useAuth();
  const router = useRouter();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/auth/me"),
    enabled: hydrated && Boolean(session),
    retry: false,
  });

  useEffect(() => {
    if (hydrated && !session) router.replace(appPath("/login"));
  }, [hydrated, session, router]);

  useEffect(() => {
    if (meQuery.data) setMe(meQuery.data);
  }, [meQuery.data, setMe]);

  useEffect(() => {
    if (meQuery.isError) {
      clear();
      router.replace(appPath("/login"));
    }
  }, [meQuery.isError, clear, router]);

  useEffect(() => {
    if (!hydrated || !session) return;
    touchSessionActivity();
    return startSessionIdleWatcher(() => {
      clearSessionActivity();
      clear();
      toast.warning("Signed out", "Idle for 20 minutes — please sign in again.");
      router.replace(appPath("/login"));
    });
  }, [hydrated, session, clear, router]);

  if (!hydrated || !session || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
          <p className="text-sm text-[var(--color-muted-foreground)]">Loading your workspace…</p>
        </div>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
