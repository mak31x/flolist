import {
  meSchema,
  publicConfigSchema,
  type Me,
  type PublicConfig,
  type UpdateMe,
} from "@flolist/shared";
import { queryOptions } from "@tanstack/react-query";

/** The signed-in user, or `null` when signed out (401). */
export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async (): Promise<Me | null> => {
    const res = await fetch("/api/v1/me", { credentials: "include" });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`GET /api/v1/me failed: ${String(res.status)}`);
    return meSchema.parse(await res.json());
  },
  staleTime: 5 * 60_000,
  retry: false,
});

export const publicConfigQuery = queryOptions({
  queryKey: ["public-config"],
  queryFn: async (): Promise<PublicConfig> => {
    const res = await fetch("/api/config");
    if (!res.ok) return { googleSignIn: false };
    return publicConfigSchema.parse(await res.json());
  },
  staleTime: Infinity,
});

export async function updateMe(input: UpdateMe): Promise<Me> {
  const res = await fetch("/api/v1/me", {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`PATCH /api/v1/me failed: ${String(res.status)}`);
  return meSchema.parse(await res.json());
}
