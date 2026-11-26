import type { ListIndexItem, Sidebar } from "@flolist/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useShell } from "../../shell/ui-store.ts";
import { FakeSocket } from "../../test-socket.ts";
import { jsonResponse, renderApp, stubFetch, testMe } from "../../test-utils.tsx";
import { sortLists } from "./sort-lists.ts";

const FAV = "0190a000-0000-7000-8000-0000000000f0";
const WORK = "0190a000-0000-7000-8000-0000000000f1";
const L1 = "0190a000-0000-7000-8000-00000000000a";
const L2 = "0190a000-0000-7000-8000-00000000000b";

const list = (id: string, title: string, extra: Partial<ListIndexItem> = {}): ListIndexItem => ({
  id,
  workspaceId: "0190a000-0000-7000-8000-0000000000aa",
  rootListId: id,
  parentListId: null,
  title,
  emoji: null,
  createdBy: testMe.id,
  version: 1,
  createdAt: "2026-11-26T10:00:00.000Z",
  updatedAt: "2026-11-26T10:00:00.000Z",
  lastOpenedAt: null,
  ...extra,
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

type Calls = { method: string; path: string; body: Record<string, unknown> | null }[];

/** A small in-memory API: enough of /lists, /sidebar and /sections for the UI. */
function fakeApi(
  options: { lists?: ListIndexItem[]; sidebar?: Sidebar; failCreate?: boolean } = {},
) {
  const lists = options.lists ?? [list(L1, "Groceries", { emoji: "🛒" }), list(L2, "Work notes")];
  const sidebar: Sidebar = options.sidebar ?? {
    sections: [
      {
        id: FAV,
        title: "Favorites",
        position: "a0",
        collapsed: false,
        isDefault: true,
        version: 1,
      },
    ],
    entries: [{ listId: L1, sectionId: FAV, position: "a0", version: 1 }],
  };
  const calls: Calls = [];
  const record = async (req: Request) => {
    const text = await req.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    calls.push({ method: req.method, path: new URL(req.url).pathname, body });
    return body ?? {};
  };
  const listRoute = (id: string) => `/api/v1/lists/${id}`;
  const routes: Parameters<typeof stubFetch>[0] = {
    "GET /api/v1/lists": () => jsonResponse({ items: lists }),
    "GET /api/v1/sidebar": () => jsonResponse(sidebar),
    "POST /api/v1/lists": async (req) => {
      const body = await record(req);
      if (options.failCreate) {
        return jsonResponse({ error: { code: "INTERNAL", message: "boom" } }, 500);
      }
      const created = list(str(body.id), str(body.title));
      lists.unshift(created);
      addListRoutes(created);
      const entry = {
        listId: created.id,
        sectionId: str(body.sectionId, FAV),
        position: str(body.position, "a5"),
        version: 1,
      };
      sidebar.entries.push(entry);
      return jsonResponse({ list: created, sidebarEntry: entry }, 201);
    },
  };
  function addListRoutes(l: ListIndexItem) {
    routes[`GET ${listRoute(l.id)}`] = () => jsonResponse(l);
    routes[`POST ${listRoute(l.id)}/open`] = () => new Response(null, { status: 204 });
    routes[`PATCH ${listRoute(l.id)}`] = async (req) => {
      const body = await record(req);
      Object.assign(l, body, { version: l.version + 1 });
      return jsonResponse(l);
    };
    routes[`DELETE ${listRoute(l.id)}`] = async (req) => {
      await record(req);
      lists.splice(lists.indexOf(l), 1);
      sidebar.entries = sidebar.entries.filter((e) => e.listId !== l.id);
      return jsonResponse({ id: l.id });
    };
    routes[`PUT /api/v1/sidebar/entries/${l.id}`] = async (req) => {
      const body = await record(req);
      const entry = {
        listId: l.id,
        sectionId: str(body.sectionId),
        position: str(body.position),
        version: 2,
      };
      sidebar.entries = [...sidebar.entries.filter((e) => e.listId !== l.id), entry];
      return jsonResponse(entry);
    };
    routes[`DELETE /api/v1/sidebar/entries/${l.id}`] = async (req) => {
      await record(req);
      sidebar.entries = sidebar.entries.filter((e) => e.listId !== l.id);
      return jsonResponse({ listId: l.id });
    };
  }
  for (const l of lists) addListRoutes(l);
  routes[`PATCH /api/v1/sections/${FAV}`] = async (req) => {
    const body = await record(req);
    const next = { ...sidebar.sections[0], ...body, version: 2 } as Sidebar["sections"][number];
    sidebar.sections = [next, ...sidebar.sections.slice(1)];
    return jsonResponse(next);
  };
  routes["POST /api/v1/sections"] = async (req) => {
    const body = await record(req);
    return jsonResponse({ ...body, collapsed: false, isDefault: false, version: 1 }, 201);
  };
  stubFetch(routes);
  return { calls, lists, sidebar };
}

const nav = async () => within(await screen.findByRole("navigation", { name: "Main" }));

afterEach(() => {
  vi.restoreAllMocks();
  useShell.setState({ renaming: null, focusTitleOf: null, drawerOpen: false });
});

describe("sidebar lists", () => {
  it("shows Favorites with its starred lists", async () => {
    fakeApi();
    renderApp("/today");
    const link = await (await nav()).findByRole("link", { name: "Groceries" });
    expect(link).toHaveAttribute("href", `/lists/${L1}`);
    expect((await nav()).queryByRole("link", { name: "Work notes" })).not.toBeInTheDocument();
    expect((await nav()).getByRole("button", { name: "Collapse Favorites" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("collapses a section and saves it", async () => {
    const { calls } = fakeApi();
    renderApp("/today");
    await (await nav()).findByRole("link", { name: "Groceries" });
    await userEvent.click((await nav()).getByRole("button", { name: "Collapse Favorites" }));
    expect((await nav()).queryByRole("link", { name: "Groceries" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(calls.some((c) => c.method === "PATCH" && c.body?.collapsed === true)).toBe(true);
    });
  });

  it("creates a list from Quick create, opens it and focuses its title", async () => {
    const { calls } = fakeApi();
    const { router } = renderApp("/today");
    await (await nav()).findByRole("link", { name: "Groceries" });
    await userEvent.click((await nav()).getByRole("button", { name: "Create" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "New list" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/lists\/[0-9a-f-]{36}$/);
    });
    const title = await screen.findByRole("textbox", { name: "List title" });
    await waitFor(() => {
      expect(title).toHaveFocus();
    });
    expect((await nav()).getByRole("link", { name: "Untitled list" })).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST" && c.path === "/api/v1/lists");
    expect(post?.body).toMatchObject({ sectionId: FAV, title: "" });
    expect(router.state.location.pathname).toBe(`/lists/${str(post?.body?.id)}`);
  });

  it("rolls back a failed create and says so", async () => {
    fakeApi({ failCreate: true });
    renderApp("/today");
    await (await nav()).findByRole("link", { name: "Groceries" });
    await userEvent.click((await nav()).getByRole("button", { name: "Create" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "New list" }));
    expect(await screen.findByText("Couldn't create the list. Try again.")).toBeInTheDocument();
    await waitFor(async () => {
      expect((await nav()).queryByRole("link", { name: "Untitled list" })).not.toBeInTheDocument();
    });
  });

  it("applies live changes from the socket", async () => {
    fakeApi();
    renderApp("/today");
    await (await nav()).findByRole("link", { name: "Groceries" });
    const socket = FakeSocket.last();
    if (!socket) throw new Error("no socket");
    act(() => {
      socket.acceptAndReady([`user:${testMe.id}`]);
      const data: Partial<ListIndexItem> = list(L1, "Groceries 2", { version: 2 });
      delete data.lastOpenedAt;
      socket.receive({
        type: "change",
        op: "upsert",
        entity: "list",
        id: L1,
        version: 2,
        clientMutationId: null,
        data,
      });
      socket.receive({
        type: "change",
        op: "upsert",
        entity: "section",
        id: WORK,
        version: 1,
        clientMutationId: null,
        data: {
          id: WORK,
          title: "Work",
          position: "a1",
          collapsed: false,
          isDefault: false,
          version: 1,
        },
      });
    });
    expect(await (await nav()).findByRole("link", { name: "Groceries 2" })).toBeInTheDocument();
    expect((await nav()).getByRole("button", { name: "Collapse Work" })).toBeInTheDocument();
  });
});

describe("list page", () => {
  it("renames the list as you type and updates the sidebar", async () => {
    const { calls } = fakeApi();
    renderApp(`/lists/${L1}`);
    const title = await screen.findByRole("textbox", { name: "List title" });
    expect(title).toHaveValue("Groceries");
    await userEvent.clear(title);
    await userEvent.type(title, "Weekly shop{Enter}");
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.method === "PATCH" &&
            c.path === `/api/v1/lists/${L1}` &&
            c.body?.title === "Weekly shop",
        ),
      ).toBe(true);
    });
    expect(await (await nav()).findByRole("link", { name: "Weekly shop" })).toBeInTheDocument();
    expect(FakeSocket.last()?.sent ?? []).toEqual([]);
  });

  it("joins the list's live channel once the socket is ready", async () => {
    fakeApi();
    renderApp(`/lists/${L1}`);
    await screen.findByRole("textbox", { name: "List title" });
    act(() => {
      FakeSocket.last()?.acceptAndReady();
    });
    expect(FakeSocket.last()?.sent).toContainEqual({ type: "subscribe", channel: `list:${L1}` });
  });

  it("stars and unstars from the header", async () => {
    const { calls } = fakeApi();
    renderApp(`/lists/${L2}`);
    const star = await screen.findByRole("button", { name: "Star" });
    await waitFor(() => {
      expect(star).toBeEnabled();
    });
    await userEvent.click(star);
    expect(await screen.findByRole("button", { name: "Unstar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await (await nav()).findByRole("link", { name: "Work notes" })).toBeInTheDocument();
    await waitFor(() => {
      expect(calls).toContainEqual(
        expect.objectContaining({ method: "PUT", path: `/api/v1/sidebar/entries/${L2}` }),
      );
    });
  });

  it("deletes after confirming and goes to All lists", async () => {
    const { calls } = fakeApi();
    const { router } = renderApp(`/lists/${L1}`);
    await userEvent.click(await screen.findByRole("button", { name: "List actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete list" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete list?" });
    expect(dialog).toHaveTextContent("Delete “Groceries”, including all of its tasks");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/all-lists");
    });
    expect(calls).toContainEqual(expect.objectContaining({ method: "DELETE" }));
    expect((await nav()).queryByRole("link", { name: "Groceries" })).not.toBeInTheDocument();
  });

  it("explains a list that doesn't exist", async () => {
    fakeApi();
    renderApp("/lists/0190a000-0000-7000-8000-0000000000ff");
    expect(
      await screen.findByText("This list doesn't exist, or you don't have access to it."),
    ).toBeInTheDocument();
  });
});

describe("All lists", () => {
  it("lists, searches and stars lists", async () => {
    const { calls } = fakeApi();
    renderApp("/all-lists");
    const rows = await screen.findByRole("list", { name: "Lists" });
    await within(rows).findByRole("link", { name: "Groceries" });
    expect(within(rows).getByRole("link", { name: "Work notes" })).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox", { name: "Search lists" }), "work");
    expect(within(rows).queryByRole("link", { name: "Groceries" })).not.toBeInTheDocument();

    await userEvent.click(within(rows).getByRole("button", { name: "Star" }));
    await waitFor(() => {
      expect(calls).toContainEqual(
        expect.objectContaining({ method: "PUT", path: `/api/v1/sidebar/entries/${L2}` }),
      );
    });

    await userEvent.click(screen.getByRole("radio", { name: "Shared" }));
    expect(await screen.findByText("No list matches “work”.")).toBeInTheDocument();
  });

  it("dismisses the tip for good", async () => {
    fakeApi();
    renderApp("/all-lists");
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss tip" }));
    expect(localStorage.getItem("flolist.tip.allLists")).toBe("dismissed");
  });

  it("sorts by title, creation date and last opened", () => {
    const a = list(L1, "banana", { createdAt: "2026-11-01T00:00:00.000Z" });
    const b = list(L2, "Apple", {
      createdAt: "2026-11-02T00:00:00.000Z",
      lastOpenedAt: "2026-11-03T00:00:00.000Z",
    });
    const c = list(WORK, "", { createdAt: "2026-11-03T00:00:00.000Z" });
    expect(sortLists([a, b, c], "alphabetical").map((l) => l.id)).toEqual([L2, L1, WORK]);
    expect(sortLists([a, b, c], "created").map((l) => l.id)).toEqual([WORK, L2, L1]);
    expect(sortLists([a, b, c], "opened").map((l) => l.id)).toEqual([L2, WORK, L1]);
  });
});
