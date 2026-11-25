import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { createAppRouter } from "./router.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

const router = createAppRouter();

createRoot(root).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
);
