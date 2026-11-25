import { workspaceListSchema, type Workspace } from "@flolist/shared";
import { queryOptions } from "@tanstack/react-query";

/** The caller's workspaces: Personal first, then teams (GET /api/v1/workspaces). */
export const workspacesQuery = queryOptions({
  queryKey: ["workspaces"],
  queryFn: async (): Promise<Workspace[]> => {
    const res = await fetch("/api/v1/workspaces", { credentials: "include" });
    if (!res.ok) throw new Error(`GET /api/v1/workspaces failed: ${String(res.status)}`);
    return workspaceListSchema.parse(await res.json()).items;
  },
  staleTime: 5 * 60_000,
});
