import { Button, TextField } from "@flolist/ui";
import { getRouteApi, Link, useRouter } from "@tanstack/react-router";
import { useState, type SubmitEvent } from "react";
import { authClient, authErrorMessage } from "../auth-client.ts";
import { AuthLayout, FormMessage } from "./AuthLayout.tsx";

const route = getRouteApi("/reset-password");

/** Reached from the reset email: Better Auth redirects here with `?token=` or `?error=INVALID_TOKEN`. */
export function ResetPasswordView() {
  const search = route.useSearch();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { token } = search;

  if (!token || search.error) {
    return (
      <AuthLayout
        title="That link didn't work"
        description="Reset links expire after an hour and work once."
        footer={
          <Link to="/login" className="font-semibold text-accent">
            Back to log in
          </Link>
        }
      >
        <Link
          to="/forgot-password"
          className="inline-flex h-10 w-full items-center justify-center rounded-full bg-accent px-5 text-[14px] font-semibold text-on-accent hover:bg-accent-hover"
        >
          Send a new link
        </Link>
      </AuthLayout>
    );
  }

  async function onSubmit(e: SubmitEvent<HTMLFormElement>, resetToken: string) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.resetPassword({
      newPassword: password,
      token: resetToken,
    });
    if (err) {
      setBusy(false);
      setError(authErrorMessage(err));
      return;
    }
    await router.navigate({ to: "/login", search: { reset: "done" }, replace: true });
  }

  return (
    <AuthLayout
      title="Choose a new password"
      description="You'll be signed out on your other devices."
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e, token)}>
        <TextField
          label="New password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          autoFocus
          hint="At least 8 characters."
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <Button type="submit" block loading={busy}>
          Save password
        </Button>
      </form>
    </AuthLayout>
  );
}
