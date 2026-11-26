import { createContext, useContext, useEffect } from "react";
import type { LiveSocket } from "./socket.ts";

export const LiveSyncContext = createContext<LiveSocket | null>(null);

/** Joins the open list's channel so changes by others reach this client. */
export function useListChannel(listId: string): void {
  const socket = useContext(LiveSyncContext);
  useEffect(() => socket?.joinList(listId), [socket, listId]);
}
