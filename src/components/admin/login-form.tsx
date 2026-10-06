"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import {
  emergencyPinLoginAction,
  loginAction,
  type LoginState,
} from "@/app/admin/login/actions";

const initialState: LoginState = { error: "" };

function LoginButton() {
  const { pending } = useFormStatus();

  return (
    <button className="admin-primary-button admin-login-button" disabled={pending}>
      {pending && <span className="admin-spinner" aria-hidden="true" />}
      {pending ? "Checking access…" : "Enter workspace"}
    </button>
  );
}

function EmergencyLoginButton() {
  const { pending } = useFormStatus();

  return (
    <button className="admin-secondary-button admin-login-button" disabled={pending}>
      {pending && <span className="admin-spinner dark" aria-hidden="true" />}
      {pending ? "Verifying owner…" : "Use emergency access"}
    </button>
  );
}

export function LoginForm({ emergencyPinEnabled }: { emergencyPinEnabled: boolean }) {
  const [state, formAction] = useActionState(loginAction, initialState);
  const [emergencyState, emergencyAction] = useActionState(
    emergencyPinLoginAction,
    initialState,
  );

  return (
    <>
      <form className="admin-login-form" action={formAction}>
        <label>
          Work email
          <input name="email" type="email" autoComplete="email" placeholder="you@ezpztek.com" required />
        </label>
        <label>
          <span className="admin-password-label">Password <Link href="/admin/forgot-password">Forgot password?</Link></span>
          <input name="password" type="password" autoComplete="current-password" placeholder="Your password" minLength={8} required />
        </label>
        {state.error && <p className="admin-form-error" role="alert">{state.error}</p>}
        <LoginButton />
      </form>

      {emergencyPinEnabled && (
        <details className="admin-emergency-access">
          <summary>Emergency owner access</summary>
          <form className="admin-login-form" action={emergencyAction}>
            <p>Use only when normal account recovery is unavailable.</p>
            <label>
              Emergency PIN
              <input
                name="pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{6,12}"
                minLength={6}
                maxLength={12}
                placeholder="6–12 digit PIN"
                required
              />
            </label>
            {emergencyState.error && (
              <p className="admin-form-error" role="alert">{emergencyState.error}</p>
            )}
            <EmergencyLoginButton />
          </form>
        </details>
      )}
    </>
  );
}
