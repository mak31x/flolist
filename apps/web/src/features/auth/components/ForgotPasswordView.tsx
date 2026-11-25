import { Button, TextField } from "@flolist/ui";
import { Link } from "@tanstack/react-router";
import { useState, type SubmitEvent } from "react";
import { authClient, authErrorMessage } from "../auth-client.ts";
import { AuthLayout, FormMessage } from "./AuthLayout.tsx";

export function ForgotPasswordView() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const { error: err } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
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
      title="Reset your password"
      description="Enter your account's email and we'll send you a link to choose a new password."
      footer={
        <Link to="/login" className="font-semibold text-accent">
          Back to log in
        </Link>
      }
    >
      {state === "sent" ? (
        <FormMessage tone="info">
          If an account exists for {email}, a reset link is on its way. It expires in 1 hour.
        </FormMessage>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <Button type="submit" block loading={state === "sending"}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
