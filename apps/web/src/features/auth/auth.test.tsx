import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderApp, stubFetch, testMe, urlOf } from "../../test-utils.tsx";
import { meQuery } from "./api.ts";
import { safeRedirect } from "./auth-client.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const noGoogle = { "GET /api/config": () => jsonResponse({ googleSignIn: false }) };

async function fillLogin(email: string, password: string) {
  await userEvent.type(await screen.findByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
}

describe("route guard", () => {
  it("sends signed-out visitors to log in and remembers where they were going", async () => {
    stubFetch(noGoogle);
    const { router } = renderApp("/today", { me: null });
    expect(await screen.findByRole("heading", { name: "Log in to Flolist" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ redirect: "/today" });
  });

  it("sends signed-in users from /login to Inbox", async () => {
    const { router } = renderApp("/login");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/inbox");
    });
  });

  it("returns to log in once when the session expires mid-use", async () => {
    stubFetch(noGoogle);
    const { router, queryClient } = renderApp("/today");
    await screen.findByRole("heading", { level: 1, name: /Today/ });
    act(() => {
      queryClient.setQueryData(meQuery.queryKey, null);
    });
    expect(await screen.findByRole("heading", { name: "Log in to Flolist" })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ redirect: "/today" });
  });

  it("explains a failed verification link", async () => {
    stubFetch(noGoogle);
    const { router } = renderApp("/inbox?error=TOKEN_EXPIRED", { me: null });
    expect(
      await screen.findByRole("heading", { name: "That link didn't work" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/verify-email");
  });
});

describe("log in", () => {
  it("signs in and goes to the remembered page", async () => {
    let signedIn = false;
    stubFetch({
      ...noGoogle,
      "POST /api/auth/sign-in/email": () => {
        signedIn = true;
        return jsonResponse({ redirect: false, token: "t", user: { id: testMe.id } });
      },
      "GET /api/v1/me": () =>
        signedIn ? jsonResponse(testMe) : jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401),
    });
    const { router } = renderApp("/login?redirect=%2Fall-tasks", { me: null });
    await fillLogin("ada@test.localhost", "correct horse battery");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/all-tasks");
    });
  });

  it("shows a message for a wrong password", async () => {
    stubFetch({
      ...noGoogle,
      "POST /api/auth/sign-in/email": () =>
        jsonResponse(
          { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
          401,
        ),
    });
    renderApp("/login", { me: null });
    await fillLogin("ada@test.localhost", "nope-nope-nope");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That email and password don't match.",
    );
  });

  it("sends unverified users to check their inbox", async () => {
    stubFetch({
      ...noGoogle,
      "POST /api/auth/sign-in/email": () =>
        jsonResponse({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }, 403),
    });
    const { router } = renderApp("/login", { me: null });
    await fillLogin("ada@test.localhost", "correct horse battery");
    expect(await screen.findByRole("heading", { name: "Check your inbox" })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ email: "ada@test.localhost" });
  });

  it("shows Continue with Google only when the server has Google keys", async () => {
    stubFetch({ "GET /api/config": () => jsonResponse({ googleSignIn: true }) });
    renderApp("/login", { me: null });
    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });

  it("hides Google when it isn't configured", async () => {
    stubFetch(noGoogle);
    renderApp("/login", { me: null });
    await screen.findByRole("heading", { name: "Log in to Flolist" });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Continue with Google" }),
      ).not.toBeInTheDocument();
    });
  });
});

describe("sign up", () => {
  it("creates the account and asks to verify the email", async () => {
    const { spy } = stubFetch({
      ...noGoogle,
      "POST /api/auth/sign-up/email": () => jsonResponse({ token: null, user: { id: testMe.id } }),
    });
    renderApp("/signup", { me: null });
    await userEvent.type(await screen.findByLabelText("Name"), "Ada Lovelace");
    await userEvent.type(screen.getByLabelText("Email"), "ada@test.localhost");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "Check your inbox" })).toBeInTheDocument();
    expect(screen.getByText("ada@test.localhost")).toBeInTheDocument();
    const call = spy.mock.calls.find(([input]) => urlOf(input).includes("/sign-up/email"));
    const body = call?.[1]?.body;
    expect(JSON.parse(typeof body === "string" ? body : "{}")).toMatchObject({
      callbackURL: "/inbox",
    });
  });
});

describe("password reset", () => {
  it("confirms the reset email without saying whether the account exists", async () => {
    stubFetch({ "POST /api/auth/request-password-reset": () => jsonResponse({ status: true }) });
    renderApp("/forgot-password", { me: null });
    await userEvent.type(await screen.findByLabelText("Email"), "ada@test.localhost");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "If an account exists for ada@test.localhost",
    );
  });

  it("saves a new password and returns to log in", async () => {
    stubFetch({
      ...noGoogle,
      "POST /api/auth/reset-password": () => jsonResponse({ status: true }),
    });
    const { router } = renderApp("/reset-password?token=abc", { me: null });
    await userEvent.type(await screen.findByLabelText("New password"), "a whole new password");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(
      await screen.findByText("Your password was changed. Log in with the new one."),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("offers a new link when the token is invalid", async () => {
    stubFetch(noGoogle);
    renderApp("/reset-password?error=INVALID_TOKEN", { me: null });
    expect(
      await screen.findByRole("heading", { name: "That link didn't work" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send a new link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });
});

describe("sign out", () => {
  it("signs out from the account menu", async () => {
    stubFetch({ ...noGoogle, "POST /api/auth/sign-out": () => jsonResponse({ success: true }) });
    const { router } = renderApp("/today");
    await userEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
  });

  it("shows the user's initials in the account menu", async () => {
    renderApp("/today");
    const button = await screen.findByRole("button", { name: "Account menu" });
    expect(within(button).getByText("AL")).toBeInTheDocument();
  });
});

describe("safeRedirect", () => {
  it.each([
    ["/today", "/today"],
    ["/lists/l1?x=1", "/lists/l1?x=1"],
    ["//evil.example", "/inbox"],
    ["https://evil.example", "/inbox"],
    ["/api/auth/sign-out", "/inbox"],
    ["/login", "/inbox"],
    [undefined, "/inbox"],
  ])("%s → %s", (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });
});
