import { Button, TextField } from "@flolist/ui";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useRouter } from "@tanstack/react-router";
import { useState, type SubmitEvent } from "react";
import { meQuery } from "../api.ts";
import { authClient, authErrorMessage, safeRedirect } from "../auth-client.ts";
import { AuthLayout, FormMessage } from "./AuthLayout.tsx";
import { GoogleSignIn } from "./GoogleButton.tsx";

const route = getRouteApi("/login");

export function LoginView() {
  const search = route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const target = safeRedirect(search.redirect);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    search.error === "google" ? "Google sign-in didn't finish. Try again." : null,
  );
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.email({ email, password, callbackURL: target });
    if (err) {
      setBusy(false);
      if (err.code === "EMAIL_NOT_VERIFIED") {
        // Better Auth has just re-sent the link (sendOnSignIn).
        await router.navigate({ to: "/verify-email", search: { email } });
        return;
      }
      setError(authErrorMessage(err));
      return;
    }
    await queryClient.query({ ...meQuery, staleTime: 0 });
    await router.navigate({ href: target, replace: true });
  }

  return (
    <AuthLayout
      title="Log in to Flolist"
      footer={
        <>
          New to Flolist?{" "}
          <Link
            to="/signup"
            search={search.redirect ? { redirect: search.redirect } : {}}
            className="font-semibold text-accent"
          >
            Create an account
          </Link>
        </>
      }
    >
      {search.reset === "done" && (
        <div className="mb-4">
          <FormMessage tone="info">Your password was changed. Log in with the new one.</FormMessage>
        </div>
      )}
      <GoogleSignIn callbackPath={target} />
      <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate={false}>
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
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <div className="-mt-2 text-right">
          <Link to="/forgot-password" className="text-[13px] text-text-muted hover:text-text">
            Forgot password?
          </Link>
        </div>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <Button type="submit" block loading={busy}>
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}
