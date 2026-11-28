import { toast } from "@flolist/ui";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

/**
 * The optimistic pattern every list/sidebar action uses (CLAUDE.md → Optimistic UI): patch the
 * cache at once, roll back and toast on error, and refetch the touched queries once the last
 * pending mutation with the same key settles (which also picks up live events skipped
 * meanwhile, see `applyChange`).
 */
export type Snapshot = [QueryKey, unknown][];

export function useOptimistic<V, R>(options: {
  mutationKey: QueryKey;
  touches: (vars: V) => QueryKey[];
  apply: (qc: QueryClient, vars: V) => void;
  run: (vars: V) => Promise<R>;
  error: string;
  /** After the snapshot is restored on error (undo what a caller seeded before `mutate`). */
  rollback?: (qc: QueryClient, vars: V) => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: options.mutationKey,
    mutationFn: options.run,
    onMutate: async (vars: V) => {
      const keys = options.touches(vars);
      await Promise.all(keys.map((queryKey) => qc.cancelQueries({ queryKey })));
      const snapshot: Snapshot = keys.map((k) => [k, qc.getQueryData(k)]);
      options.apply(qc, vars);
      return { snapshot };
    },
    onError: (_err, vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
      options.rollback?.(qc, vars);
      toast(options.error);
    },
    onSettled: async (_data, _err, vars) => {
      if (qc.isMutating({ mutationKey: options.mutationKey }) > 1) return;
      await Promise.all(
        options.touches(vars).map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
    },
  });
}
