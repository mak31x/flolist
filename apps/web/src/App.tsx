import { UiProvider } from "@flolist/ui";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
import type { AppRouter } from "./router.tsx";
import { startThemeSync } from "./shell/theme-store.ts";

/** App root: server-state cache, UI primitives (tooltips, toasts, motion) and the router. */
export function App({ router, queryClient }: { router: AppRouter; queryClient: QueryClient }) {
  useEffect(() => startThemeSync(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <UiProvider>
        <RouterProvider router={router} />
      </UiProvider>
    </QueryClientProvider>
  );
}
