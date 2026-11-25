import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/** matchMedia that understands (min-width)/(max-width) against window.innerWidth; everything else is false. */
function matches(query: string): boolean {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  if (!min && !max) return false;
  const w = window.innerWidth;
  return (!min || w >= Number(min[1])) && (!max || w <= Number(max[1]));
}

vi.stubGlobal(
  "matchMedia",
  (query: string) =>
    ({
      get matches() {
        return matches(query);
      },
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
vi.stubGlobal("scrollTo", () => undefined);
for (const name of ["scrollIntoView", "hasPointerCapture", "releasePointerCapture"] as const) {
  Object.defineProperty(Element.prototype, name, {
    value: () => false,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
