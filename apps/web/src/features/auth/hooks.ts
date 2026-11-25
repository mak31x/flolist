import type { Me } from "@flolist/shared";
import { toast, type ThemePreference } from "@flolist/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useThemeStore } from "../../shell/theme-store.ts";
import { meQuery, updateMe } from "./api.ts";
import { authClient } from "./auth-client.ts";

/** The signed-in user. Only use under the `app` layout, which guarantees one. */
export function useMe() {
  const { data } = useQuery(meQuery);
  if (!data) throw new Error("useMe() used outside the signed-in layout");
  return data;
}

/**
 * The user record is the source of truth for the theme (D-034); localStorage only caches it
 * so the first paint is right. Applies the server's value when it differs.
 */
export function useServerThemeSync() {
  const { data: me } = useQuery(meQuery);
  useEffect(() => {
    if (me && me.theme !== useThemeStore.getState().preference) {
      useThemeStore.getState().setPreference(me.theme);
    }
  }, [me]);
}

/** Changes the theme at once and saves it on the user record; rolls back with a toast on error. */
export function useSaveTheme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (theme: ThemePreference) => {
      const me = queryClient.getQueryData(meQuery.queryKey);
      if (!me) throw new Error("not signed in");
      return updateMe({ theme, clientMutationId: crypto.randomUUID(), baseVersion: me.version });
    },
    onMutate: (theme) => {
      const previous = queryClient.getQueryData(meQuery.queryKey);
      useThemeStore.getState().setPreference(theme);
      queryClient.setQueryData(meQuery.queryKey, (old): Me | null | undefined =>
        old ? { ...old, theme } : old,
      );
      return { previous };
    },
    onError: (_err, _theme, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(meQuery.queryKey, ctx.previous);
        useThemeStore.getState().setPreference(ctx.previous.theme);
      }
      toast("Couldn't save the theme. Try again.");
    },
    onSuccess: (me) => {
      queryClient.setQueryData(meQuery.queryKey, me);
    },
  });
}

/**
 * Signs out, forgets the user's cached data and goes to the log-in screen. `me` is set to
 * `null` (signed out) instead of being cleared, so nothing refetches on the way out.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async () => {
    const { error } = await authClient.signOut();
    if (error) {
      toast("Couldn't sign out. Try again.");
      return;
    }
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== meQuery.queryKey[0] });
    queryClient.setQueryData(meQuery.queryKey, null);
    await router.navigate({ to: "/login", replace: true });
  };
}
