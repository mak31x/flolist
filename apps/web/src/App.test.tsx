import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { createAppRouter } from "./router.tsx";
import { useShell } from "./shell/ui-store.ts";

function renderAt(path: string, width = 1440) {
  window.innerWidth = width;
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<App router={router} />);
  return router;
}

beforeEach(() => {
  useShell.setState({ sidebarCollapsed: false, coverCollapsed: false, drawerOpen: false });
});

describe("app shell", () => {
  it("redirects / to Today with the cover panel", async () => {
    const router = renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: /Today/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/today");
    expect(screen.getByRole("complementary", { name: "Cover" })).toBeInTheDocument();
  });

  it("lists every system view in the sidebar and marks the active one", async () => {
    renderAt("/inbox");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    for (const label of ["Inbox", "Today", "Week", "All tasks", "Updates", "All lists"]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(within(nav).queryByText("Meetings")).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it.each([
    ["/my-week", "My Week"],
    ["/all-tasks", "Tasks"],
    ["/all-lists", "Lists"],
    ["/trash", "Trash"],
    ["/team/t1", "Team"],
    ["/lists/l1", "Untitled list"],
  ])("renders %s without a cover", async (path, title) => {
    renderAt(path);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Cover" })).not.toBeInTheDocument();
  });

  it("shows a cover on Inbox and Updates", async () => {
    renderAt("/updates");
    expect(await screen.findByRole("heading", { level: 1, name: "Updates" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Cover" })).toBeInTheDocument();
  });

  it("hides the cover panel below 1024px", async () => {
    renderAt("/today", 900);
    expect(await screen.findByRole("heading", { level: 1, name: /Today/ })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Cover" })).not.toBeInTheDocument();
  });

  it("collapses and restores the cover", async () => {
    renderAt("/inbox");
    await userEvent.click(await screen.findByRole("button", { name: "Hide cover" }));
    expect(screen.queryByRole("complementary", { name: "Cover" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show cover" }));
    expect(await screen.findByRole("complementary", { name: "Cover" })).toBeInTheDocument();
  });

  it("collapses and restores the sidebar", async () => {
    renderAt("/today");
    await userEvent.click(await screen.findByRole("button", { name: "Collapse sidebar" }));
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("opens task details in the right panel and closes back to the list", async () => {
    const router = renderAt("/lists/l1/tasks/t1");
    const panel = await screen.findByRole("complementary", { name: "Task details" });
    await userEvent.click(within(panel).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/lists/l1");
    });
  });

  it("shows a not-found page for unknown routes", async () => {
    renderAt("/nope");
    expect(await screen.findByText("This page doesn't exist.")).toBeInTheDocument();
  });
});

describe("phone layout", () => {
  it("opens the sidebar as a drawer and closes it after navigating", async () => {
    const router = renderAt("/today", 375);
    await userEvent.click(await screen.findByRole("button", { name: "Open navigation" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    await userEvent.click(within(drawer).getByRole("link", { name: "Inbox" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/inbox");
    });
    expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument();
  });
});

describe("settings", () => {
  it("redirects /settings and unknown tabs to Profile", async () => {
    const router = renderAt("/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/profile");
    await router.navigate({ to: "/settings/$tab", params: { tab: "billing" } });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/settings/profile");
    });
  });

  it("switches the theme from Features → Appearance", async () => {
    renderAt("/settings/features");
    await userEvent.click(await screen.findByRole("button", { name: "System preference" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("flolist.theme")).toBe("dark");
  });
});
