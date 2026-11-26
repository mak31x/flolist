import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  SheetContent,
  SkeletonSquiggle,
  duration,
  easing,
  panelSlideOffset,
  seconds,
  Dialog,
} from "@flolist/ui";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Copy, Link2, MoreVertical, PanelRightClose, Settings2, Trash2, X } from "lucide-react";
import type { CoverId } from "./covers.ts";
import { useMediaQuery } from "./use-media-query.ts";
import { useShell } from "./ui-store.ts";

/** What a route shows on the right: a fixed cover, the open list's own cover, or nothing. */
export type PanelMode = { kind: "cover"; cover: CoverId } | { kind: "list" } | { kind: "none" };

/** A resolved cover image; `onCustomize` adds the gear (list covers). */
export interface PanelCover {
  key: string;
  src: string;
  onCustomize?: () => void;
}

type RightPanelProps = {
  cover: PanelCover | null;
  /** When set, the panel shows task details instead of the cover. */
  task: { listId: string; taskId: string } | null;
};

const transition = { duration: seconds(duration.base), ease: easing.out };

/** Right column (ui-design §1): a cover photo, or task details when a task is open. */
export function RightPanel({ cover, task }: RightPanelProps) {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const coverCollapsed = useShell((s) => s.coverCollapsed);
  const setCoverCollapsed = useShell((s) => s.setCoverCollapsed);

  // Tablet and phone: details open as a sheet; there is no cover panel.
  if (!desktop) return task ? <DetailsSheet task={task} /> : null;

  const showCover = cover !== null && !coverCollapsed;
  if (!task && !showCover) return null;

  return (
    <aside
      aria-label={task ? "Task details" : "Cover"}
      className="relative w-[clamp(300px,30vw,440px)] shrink-0 overflow-hidden rounded-card print:hidden"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {task ? (
          <motion.div
            key="details"
            className="absolute inset-0 bg-surface"
            initial={{ opacity: 0, x: panelSlideOffset }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            <TaskDetails task={task} />
          </motion.div>
        ) : cover ? (
          <motion.div
            key={`cover-${cover.key}`}
            className="group absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            <img src={cover.src} alt="" className="size-full object-cover" draggable={false} />
            <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 transition-opacity duration-(--motion-fast) group-focus-within:opacity-100 group-hover:opacity-100">
              {cover.onCustomize && (
                <IconButton
                  label="Customize"
                  icon={<Settings2 />}
                  variant="chip"
                  onClick={cover.onCustomize}
                />
              )}
              <IconButton
                label="Hide cover"
                icon={<PanelRightClose />}
                variant="chip"
                onClick={() => {
                  setCoverCollapsed(true);
                }}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </aside>
  );
}

function TaskDetails({ task }: { task: { listId: string; taskId: string } }) {
  const navigate = useNavigate();
  const close = () => {
    void navigate({ to: "/lists/$listId", params: { listId: task.listId } });
  };
  return (
    <div
      className="flex h-full flex-col p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <div className="flex items-center justify-between">
        <IconButton label="Close" icon={<X />} variant="chip" shortcut="Escape" onClick={close} />
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="More" icon={<MoreVertical />} variant="chip" tooltip={false} />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={<Copy />} disabled>
              Duplicate
            </MenuItem>
            <MenuItem icon={<Link2 />} disabled>
              Copy link
            </MenuItem>
            <MenuItem icon={<Trash2 />} destructive disabled>
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <h2 className="mt-5 px-1 text-details-title font-bold">Task</h2>
      <SkeletonSquiggle className="mt-4" rows={4} />
    </div>
  );
}

function DetailsSheet({ task }: { task: { listId: string; taskId: string } }) {
  const navigate = useNavigate();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void navigate({ to: "/lists/$listId", params: { listId: task.listId } });
      }}
    >
      <SheetContent side="right" title="Task details">
        <TaskDetails task={task} />
      </SheetContent>
    </Dialog>
  );
}
