import { Button, TextField } from "@flolist/ui";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useState, type SubmitEvent } from "react";
import { AFTER_AUTH_PATH, authClient, authErrorMessage } from "../auth-client.ts";
import { AuthLayout, FormMessage } from "./AuthLayout.tsx";

const route = getRouteApi("/verify-email");

/** "Check your inbox" after sign-up, and where expired or invalid verification links land. */
export function VerifyEmailView() {
  const search = route.useSearch();
  const [email, setEmail] = useState(search.email ?? "");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const linkFailed = search.error !== undefined;

  async function resend(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const { error: err } = await authClient.sendVerificationEmail({
      email,
      callbackURL: AFTER_AUTH_PATH,
    });
    if (err) {
      setState("idle");
      setError(authErrorMessage(err));
      return;
    }
    setState("sent");
  }

  return (
    <AuthLayout
      title={linkFailed ? "That link didn't work" : "Check your inbox"}
      description={
        linkFailed ? (
          "Verification links expire after an hour and work once. Send yourself a new one."
        ) : search.email ? (
          <>
            We sent a verification link to <strong className="text-text">{search.email}</strong>.
            Open it to finish setting up your account.
          </>
        ) : (
          "Open the verification link we emailed you to finish setting up your account."
        )
      }
      footer={
        <Link to="/login" className="font-semibold text-accent">
          Back to log in
        </Link>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void resend(e)}>
        {!search.email && (
          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        )}
        {state === "sent" && <FormMessage tone="info">A new link is on its way.</FormMessage>}
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <Button type="submit" variant="secondary" block loading={state === "sending"}>
          Resend the link
        </Button>
      </form>
    </AuthLayout>
  );
}
