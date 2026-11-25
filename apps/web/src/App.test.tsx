import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows the wordmark and a healthy API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ status: "ok", service: "api", time: new Date().toISOString() }),
        ),
      ),
    );
    render(<App />);
    expect(screen.getByRole("heading", { name: "Flolist" })).toBeInTheDocument();
    expect(await screen.findByText("API: ok")).toBeInTheDocument();
  });

  it("reports an unreachable API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<App />);
    expect(await screen.findByText("API: unreachable")).toBeInTheDocument();
  });
});
