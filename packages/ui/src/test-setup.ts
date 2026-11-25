import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom gaps that Radix and Motion touch.
vi.stubGlobal(
  "matchMedia",
  (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
);
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
for (const name of ["scrollIntoView", "hasPointerCapture", "releasePointerCapture"] as const) {
  Object.defineProperty(Element.prototype, name, {
    value: () => false,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  cleanup();
});
