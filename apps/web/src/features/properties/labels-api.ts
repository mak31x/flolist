import {
  labelPageSchema,
  labelSchema,
  updateLabelResultSchema,
  uuidv7,
  type ChangeEvent,
  type Label,
  type LabelColor,
} from "@flolist/shared";
import { toast } from "@flolist/ui";
import { queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";

export const labelsKey = ["labels"] as const;
const labelsMutationKey = ["labels"] as const;

/** Every label in the user's workspaces, by name (Settings → Labels and the pickers). */
export const labelsQuery = queryOptions({
  queryKey: labelsKey,
  queryFn: async (): Promise<Label[]> => (await api("GET", "/labels", labelPageSchema)).items,
  staleTime: 60_000,
});

const byName = (a: Label, b: Label) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);

function upsertLabel(rows: readonly Label[], label: Label): Label[] {
  return [...rows.filter((l) => l.id !== label.id), label].sort(byName);
}

const removeLabel = (rows: readonly Label[], id: string) => rows.filter((l) => l.id !== id);

/** Live `label` events (workspace channels). */
export function applyLabelChange(qc: QueryClient, event: ChangeEvent): void {
  if (event.entity !== "label") return;
  if (qc.isMutating({ mutationKey: labelsMutationKey }) > 0) return;
  qc.setQueryData<Label[]>(labelsKey, (old) => {
    if (!old) return old;
    if (event.op === "delete") return removeLabel(old, event.id);
    const current = old.find((l) => l.id === event.id);
    if (current && current.version >= event.version) return old;
    return "data" in event ? upsertLabel(old, event.data) : old;
  });
}

/** The labels a task can use: its workspace's, by name. */
export function labelsOf(labels: readonly Label[] | undefined, workspaceId: string): Label[] {
  return (labels ?? []).filter((l) => l.workspaceId === workspaceId);
}

function useLabelMutation<V, R>(options: {
  run: (vars: V) => Promise<R>;
  apply: (rows: Label[], vars: V) => Label[];
  done?: (qc: QueryClient, result: R, vars: V) => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: labelsMutationKey,
    mutationFn: options.run,
    onMutate: async (vars: V) => {
      await qc.cancelQueries({ queryKey: labelsKey });
      const before = qc.getQueryData<Label[]>(labelsKey);
      qc.setQueryData<Label[]>(labelsKey, (old) => options.apply(old ?? [], vars));
      return { before };
    },
    onSuccess: (result, vars) => options.done?.(qc, result, vars),
    onError: (_err, _vars, ctx) => {
      qc.setQueryData(labelsKey, ctx?.before);
      toast(t("labels.error"));
    },
    onSettled: async () => {
      if (qc.isMutating({ mutationKey: labelsMutationKey }) > 1) return;
      await qc.invalidateQueries({ queryKey: labelsKey });
    },
  });
}

export interface CreateLabelVars {
  id: string;
  workspaceId: string;
  name: string;
}

/**
 * Creates a label (optimistic). The server answers the existing label when the name is
 * taken, so callers should use the id from the result.
 */
export function useCreateLabel() {
  return useLabelMutation({
    run: (vars: CreateLabelVars) =>
      api("POST", "/labels", labelSchema, { clientMutationId: uuidv7(), ...vars }),
    apply: (rows, vars) => {
      const now = new Date().toISOString();
      return upsertLabel(rows, {
        ...vars,
        color: null,
        taskCount: 0,
        version: 0,
        createdAt: now,
        updatedAt: now,
      });
    },
    done: (qc, label, vars) => {
      qc.setQueryData<Label[]>(labelsKey, (old) =>
        upsertLabel(removeLabel(old ?? [], vars.id), label),
      );
    },
  });
}

export const newLabelId = uuidv7;

export function useUpdateLabel() {
  return useLabelMutation({
    run: (vars: { id: string; name?: string; color?: LabelColor | null }) => {
      const { id, ...fields } = vars;
      return api("PATCH", `/labels/${id}`, updateLabelResultSchema, {
        clientMutationId: uuidv7(),
        ...fields,
      });
    },
    apply: (rows, vars) => {
      const label = rows.find((l) => l.id === vars.id);
      if (!label) return rows;
      return upsertLabel(rows, {
        ...label,
        ...(vars.name !== undefined ? { name: vars.name.trim() } : {}),
        ...(vars.color !== undefined ? { color: vars.color } : {}),
      });
    },
    done: (qc, result) => {
      qc.setQueryData<Label[]>(labelsKey, (old) => {
        const rows = result.mergedFrom ? removeLabel(old ?? [], result.mergedFrom) : (old ?? []);
        return upsertLabel(rows, result.label);
      });
      if (result.mergedFrom) toast(t("settings.labels.merged", { name: result.label.name }));
    },
  });
}

export function useDeleteLabel() {
  return useLabelMutation({
    run: (vars: { id: string }) =>
      api("DELETE", `/labels/${vars.id}`, undefined, { clientMutationId: uuidv7() }),
    apply: (rows, vars) => removeLabel(rows, vars.id),
  });
}
