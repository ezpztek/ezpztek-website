"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  updatePasswordAction,
  type UpdatePasswordState,
} from "@/app/admin/reset-password/actions";

const initialState: UpdatePasswordState = { error: "" };

function UpdatePasswordButton() {
  const { pending } = useFormStatus();
  return (
    <button className="admin-primary-button admin-login-button" disabled={pending}>
      {pending && <span className="admin-spinner" aria-hidden="true" />}
      {pending ? "Updating password…" : "Save new password"}
    </button>
  );
}

export function UpdatePasswordForm() {
  const [state, action] = useActionState(updatePasswordAction, initialState);
  return (
    <form className="admin-login-form" action={action}>
      <label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
      <label>Confirm new password<input name="confirmation" type="password" autoComplete="new-password" minLength={12} required /></label>
      <p className="admin-password-hint">Use at least 12 characters and avoid reusing another password.</p>
      {state.error && <p className="admin-form-error" role="alert">{state.error}</p>}
      <UpdatePasswordButton />
    </form>
  );
}

