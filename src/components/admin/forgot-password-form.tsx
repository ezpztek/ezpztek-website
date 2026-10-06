"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  requestPasswordResetAction,
  type ForgotPasswordState,
} from "@/app/admin/forgot-password/actions";

const initialState: ForgotPasswordState = { status: "idle", message: "" };

function ResetEmailButton() {
  const { pending } = useFormStatus();
  return (
    <button className="admin-primary-button admin-login-button" disabled={pending}>
      {pending && <span className="admin-spinner" aria-hidden="true" />}
      {pending ? "Sending secure link…" : "Send new reset link"}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, initialState);

  return (
    <form className="admin-login-form" action={action}>
      <label>
        Administrator email
        <input name="email" type="email" autoComplete="email" placeholder="you@ezpztek.com" required />
      </label>
      {state.message && (
        <p className={state.status === "success" ? "admin-form-success" : "admin-form-error"} role="status">
          {state.message}
        </p>
      )}
      <ResetEmailButton />
    </form>
  );
}

