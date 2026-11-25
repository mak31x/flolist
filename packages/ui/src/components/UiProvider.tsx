import { MotionConfig } from "motion/react";
import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";
import { Toaster } from "./Toast.tsx";

/** Mount once at the app root: tooltips, toasts, and reduced-motion handling for Motion. */
export function UiProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <Tooltip.Provider delayDuration={500} skipDelayDuration={200}>
        {children}
        <Toaster />
      </Tooltip.Provider>
    </MotionConfig>
  );
}
