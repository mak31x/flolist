import { useQuery } from "@tanstack/react-query";
import { t } from "../../i18n/index.ts";
import { activityText, groupByDay, timeFormat } from "./activity.ts";
import { activityQuery } from "./api.ts";

/**
 * The task's activity (ui-design §5 item 6): a centred date separator per day, then small muted
 * lines "1:49 pm: Karan created this task". Messages interleave here with M7.3.
 */
export function ActivityLog({ taskId }: { taskId: string }) {
  const { data } = useQuery(activityQuery(taskId));
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
