import type { Me } from "@flolist/shared";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { App } from "./App.tsx";
import { meQuery } from "./features/auth/api.ts";
import { createAppRouter } from "./router.tsx";

export const testMe: Me = {
  id: "0190a000-0000-7000-8000-000000000001",
  name: "Ada Lovelace",
  email: "ada@test.localhost",
  emailVerified: true,
  image: null,
  theme: "system",
  timezone: "UTC",
  weekStart: "system",
  version: 1,
};

/** The URL of a fetch() input, whatever form it took. */
export function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

type Handler = (req: Request) => Response | Promise<Response>;

/**
 * Stubs fetch for the routes a test needs; anything else is a 404 so tests notice.
 * Undo it with `vi.restoreAllMocks()` (not unstubAllGlobals, which drops test-setup's stubs).
 */
export function stubFetch(routes: Record<string, Handler>) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(new URL(urlOf(input), "http://localhost"), init);
    const key = `${req.method} ${new URL(req.url).pathname}`;
    const handler = routes[key];
    return handler ? handler(req) : json({ error: { code: "NOT_FOUND", message: key } }, 404);
  });
  return { spy, json };
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Renders the whole app at `path`, signed in as `me` (or signed out with `null`). */
export function renderApp(
  path: string,
  { me = testMe, width = 1440 }: { me?: Me | null; width?: number } = {},
) {
  window.innerWidth = width;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(meQuery.queryKey, me);
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(<App router={router} queryClient={queryClient} />);
  return { router, queryClient };
}
