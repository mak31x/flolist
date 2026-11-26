import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { openSocket, socketUrl } from "../../platform/index.ts";
import { applyAccessChanged, applyChange } from "./apply-change.ts";
import { LiveSyncContext } from "./live-sync-context.ts";
import { LiveSocket } from "./socket.ts";

/**
 * Runs the live-sync socket while the signed-in shell is mounted. Change events patch the
 * query cache; after a reconnect every active query refetches, since events may have been
 * missed while offline.
 */
export function LiveSyncProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [socket] = useState(
    () =>
      new LiveSocket({
        url: socketUrl,
        open: openSocket,
        onMessage: (msg) => {
          if (msg.type === "change") applyChange(qc, msg);
          else if (msg.type === "access_changed") applyAccessChanged(qc);
        },
        onReady: (reconnected) => {
          if (reconnected) void qc.invalidateQueries({ refetchType: "active" });
        },
      }),
  );

  useEffect(() => {
    socket.start();
    const wake = () => {
      socket.wake();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") socket.wake();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisible);
      socket.stop();
    };
  }, [socket]);

  return <LiveSyncContext.Provider value={socket}>{children}</LiveSyncContext.Provider>;
}
