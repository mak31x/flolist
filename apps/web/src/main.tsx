import { notifyManager, QueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { createAppRouter } from "./router.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Deliver cache updates in a microtask, not a later task: an editor command (Enter) must
// render its new block, and move focus there, before the next key event arrives (D-046).
notifyManager.setScheduler(queueMicrotask);
const queryClient = new QueryClient();
const router = createAppRouter(queryClient);

createRoot(root).render(
  <StrictMode>
    <App router={router} queryClient={queryClient} />
  </StrictMode>,
);
