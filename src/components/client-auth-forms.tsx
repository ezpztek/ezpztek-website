"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  clientLoginAction,
  registerClientAction,
  type ClientAuthState,
} from "@/app/(client-auth)/actions";

const initialState: ClientAuthState = { error: "" };

function AuthButton({ idle, pending }: { idle: string; pending: string }) {
  const status = useFormStatus();
  return (
    <button className="client-primary-button" disabled={status.pending}>
      {status.pending && <span className="client-spinner" aria-hidden="true" />}
      {status.pending ? pending : idle}
    </button>
  );
}

export function ClientLoginForm() {
  const [state, action] = useActionState(clientLoginAction, initialState);
  return (
    <form className="client-auth-form" action={action}>
      <label>Email address<input type="email" name="email" autoComplete="email" required /></label>
      <label>Password<input type="password" name="password" autoComplete="current-password" minLength={10} required /></label>
      {state.error && <p className="client-form-error" role="alert">{state.error}</p>}
      <AuthButton idle="Sign in to workspace" pending="Signing in…" />
    </form>
  );
}

export function ClientRegistrationForm({ token, defaultName }: { token: string; defaultName: string }) {
  const [state, action] = useActionState(registerClientAction, initialState);
  return (
    <form className="client-auth-form" action={action}>
      <input type="hidden" name="token" value={token} />
      <label>Your name<input name="displayName" autoComplete="name" defaultValue={defaultName} minLength={2} required /></label>
      <label>Create password<input type="password" name="password" autoComplete="new-password" minLength={10} required /></label>
      <p className="client-password-hint">Use 10+ characters with uppercase, lowercase, and a number.</p>
      <label>Confirm password<input type="password" name="confirmPassword" autoComplete="new-password" minLength={10} required /></label>
      {state.error && <p className="client-form-error" role="alert">{state.error}</p>}
      <AuthButton idle="Create secure account" pending="Creating workspace…" />
    </form>
  );
}
