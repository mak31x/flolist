import { Button, TextField } from "@flolist/ui";
import { getRouteApi, Link, useRouter } from "@tanstack/react-router";
import { useState, type SubmitEvent } from "react";
import { AFTER_AUTH_PATH, authClient, authErrorMessage, safeRedirect } from "../auth-client.ts";
import { AuthLayout, FormMessage } from "./AuthLayout.tsx";
import { GoogleSignIn } from "./GoogleButton.tsx";

const route = getRouteApi("/signup");

export function SignupView() {
  const search = route.useSearch();
  const router = useRouter();
  const target = search.redirect ? safeRedirect(search.redirect) : AFTER_AUTH_PATH;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signUp.email({
      name: name.trim(),
      email,
      password,
      callbackURL: target,
    });
    if (err) {
      setBusy(false);
      setError(authErrorMessage(err));
      return;
    }
    await router.navigate({ to: "/verify-email", search: { email } });
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Plan your day, organise your lists and work together."
      footer={
        <>
          Already have an account?{" "}
          <Link
            to="/login"
            search={search.redirect ? { redirect: search.redirect } : {}}
            className="font-semibold text-accent"
          >
            Log in
          </Link>
        </>
      }
    >
      <GoogleSignIn callbackPath={target} />
      <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
        <TextField
          label="Name"
          name="name"
          autoComplete="name"
          required
          maxLength={100}
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
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
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          hint="At least 8 characters."
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <Button type="submit" block loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
