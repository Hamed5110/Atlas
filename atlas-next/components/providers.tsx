"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useLocaleStore } from "@/lib/i18n";
import { Toaster } from "@/components/ui/toast";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            retry: 1,
            refetchOnWindowFocus: false,
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
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
