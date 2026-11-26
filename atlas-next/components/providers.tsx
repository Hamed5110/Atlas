"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useLocaleStore } from "@/lib/i18n";
import { useLocaleSync } from "@/lib/locale-preference";
import { useThemeSync } from "@/lib/theme";
import { Toaster } from "@/components/ui/toast";

function ThemeSync() {
  useThemeSync();
  useLocaleSync();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            retry: 1,
            // ERP screens: refresh stale queries when the operator returns to the tab.
            refetchOnWindowFocus: true,
          },
        },
      })
  );
  const hydrateAuth = useAuth((s) => s.hydrate);
  const hydrateLocale = useLocaleStore((s) => s.hydrate);

  useEffect(() => {
    hydrateAuth();
    hydrateLocale();
  }, [hydrateAuth, hydrateLocale]);

  return (
    <QueryClientProvider client={client}>
      <ThemeSync />
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
