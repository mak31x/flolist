import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { t } from "../../i18n/index.ts";
import { activityText, groupByDay, timeFormat } from "./activity.ts";
import { activityKey, activityQuery } from "./api.ts";

/**
 * The task's activity (ui-design §5 item 6): a centred date separator per day, then small muted
 * lines "1:49 pm: Karan created this task". Messages interleave here with M7.3.
 */
export function ActivityLog({ taskId, version }: { taskId: string; version: number }) {
  const qc = useQueryClient();
  const { data } = useQuery(activityQuery(taskId));
  // Every logged change bumps the task block's version once the server has it (the batch
  // answer), so refetch then too, not only on the live `task` echo, which can lag.
  const seen = useRef(version);
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    void qc.invalidateQueries({ queryKey: activityKey(taskId) });
  }, [qc, taskId, version]);
  if (!data || data.length === 0) return null;
  return (
    <section aria-label={t("tasks.activity.label")} className="px-1 py-2">
      {groupByDay(data).map((group) => (
        <div key={group.day}>
          <p className="my-2 text-center text-meta font-medium text-text-muted">{group.day}</p>
          <ul className="flex flex-col gap-1">
            {group.events.map((event) => (
              <li key={event.id} className="text-meta text-text-muted">
                {t("tasks.activity.line", {
                  time: timeFormat.format(new Date(event.createdAt)),
                  text: activityText(event),
                })}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
