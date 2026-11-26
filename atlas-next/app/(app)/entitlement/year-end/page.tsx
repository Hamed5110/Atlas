"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { appPath } from "@/lib/paths";

/** Old period-end URL — permanently redirect to modern Allocation path. */
export default function YearEndGoneRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(appPath("/allocation"));
  }, [router]);
  return (
    <p className="p-6 text-sm text-[var(--color-muted-foreground)]" data-testid="page-year-end-gone">
      Redirecting to Allocation (modern continuous entitlement)…
    </p>
  );
}
