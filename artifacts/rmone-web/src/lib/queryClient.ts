import { QueryClient } from "@tanstack/react-query";

/**
 * Shared React Query client. Extracted into its own module (rather than living
 * in App.tsx) so the auth flow can import and clear it on sign-in / sign-out
 * WITHOUT creating a circular import (App.tsx imports AuthProvider).
 *
 * Why clearing matters: query keys here are NOT tenant-scoped (e.g. ["pmm"],
 * ["opm"], ["resource-allocations"]) and staleTime is 10 minutes. If a user
 * switches tenant/user inside the same SPA runtime, React Query would otherwise
 * serve the PREVIOUS tenant's data as "fresh" — a cross-tenant data leak. The
 * auth boundary calls `queryClient.clear()` to guarantee isolation.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep fetched data fresh for 10 minutes so navigating between
      // Home / Projects / Resources / Chat etc. renders instantly from
      // cache instead of refiring the "Loading live data…" overlay every
      // time. gcTime keeps it in memory for 30 minutes after the last
      // observer unmounts.
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
