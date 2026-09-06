"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const router = useRouter();
  const { session, hydrated } = useAuth();

  useEffect(() => {
    if (!hydrated) return;
    router.replace(session ? "/dashboard" : "/login");
  }, [hydrated, session, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
    </div>
  );
}
