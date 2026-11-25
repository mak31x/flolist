import { Button, toast } from "@flolist/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { publicConfigQuery } from "../api.ts";
import { authClient } from "../auth-client.ts";
import { OrDivider } from "./AuthLayout.tsx";

/** Google's "G" in the current text colour (components never hard-code colours, D-027). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.68 3.7 14.55 2.8 12 2.8 6.92 2.8 2.8 6.92 2.8 12s4.12 9.2 9.2 9.2c5.31 0 8.83-3.73 8.83-8.99 0-.6-.07-1.06-.15-1.51Z" />
    </svg>
  );
}

/** "Continue with Google" plus the "or" divider; renders nothing when the server has no Google keys. */
export function GoogleSignIn({ callbackPath }: { callbackPath: string }) {
  const { data } = useQuery(publicConfigQuery);
  const [busy, setBusy] = useState(false);
  if (!data?.googleSignIn) return null;
  return (
    <>
      <Button
        variant="outline"
        block
        icon={<GoogleMark />}
        loading={busy}
        onClick={() => {
          setBusy(true);
          void authClient.signIn
            .social({
              provider: "google",
              callbackURL: callbackPath,
              errorCallbackURL: "/login?error=google",
            })
            .then(({ error }) => {
              if (error) {
                setBusy(false);
                toast("Couldn't reach Google. Try again.");
              }
            });
        }}
      >
        Continue with Google
      </Button>
      <OrDivider />
    </>
  );
}
