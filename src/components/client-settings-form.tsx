"use client";
/* eslint-disable @next/next/no-img-element -- private S3 images use an authenticated redirect */

import { useActionState, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  changeClientPasswordAction,
  type ClientPasswordState,
} from "@/app/portal/settings/actions";
import { inventoryImageUploadError } from "@/lib/inventory-images/core";
import {
  fileChecksumSha256,
  prepareClientLogo,
} from "@/lib/inventory-images/upload-client";

type LogoResponse = {
  imageId?: string;
  message?: string;
  cleanupPending?: boolean;
  upload?: { url?: string; fields?: Record<string, string> };
};

const initialPasswordState: ClientPasswordState = { error: "" };

async function responseJson(response: Response): Promise<LogoResponse> {
  try {
    return (await response.json()) as LogoResponse;
  } catch {
    return {};
  }
}

function ClientLogoForm({
  businessName,
  initialLogoId,
  brandingAvailable,
  storageAvailable,
}: {
  businessName: string;
  initialLogoId: string | null;
  brandingAvailable: boolean;
  storageAvailable: boolean;
}) {
  const inputId = useId();
  const router = useRouter();
  const [currentLogoId, setCurrentLogoId] = useState(initialLogoId);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const enabled = brandingAvailable && storageAvailable;

  async function uploadLogo(file: File) {
    if (!enabled || busy) return;
    setBusy(true);
    setError("");
    setStatus("Optimizing logo...");
    try {
      const prepared = await prepareClientLogo(file);
      setStatus("Checking logo...");
      const checksumSha256 = await fileChecksumSha256(prepared);

      setStatus("Preparing secure upload...");
      const presignResponse = await fetch("/api/client/logo/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType: prepared.type,
          byteSize: prepared.size,
          checksumSha256,
        }),
      });
      const presign = await responseJson(presignResponse);
      if (
        !presignResponse.ok ||
        !presign.imageId ||
        !presign.upload?.url ||
        !presign.upload.fields
      ) {
        throw new Error(presign.message || "The secure upload could not be prepared.");
      }

      const uploadUrl = new URL(presign.upload.url);
      if (uploadUrl.protocol !== "https:") throw new Error("The upload destination is invalid.");

      setStatus("Uploading logo...");
      const uploadForm = new FormData();
      for (const [name, value] of Object.entries(presign.upload.fields)) {
        uploadForm.append(name, value);
      }
      uploadForm.append("file", prepared);
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        body: uploadForm,
        credentials: "omit",
      });
      if (!uploadResponse.ok) {
        const responseBody = await uploadResponse.text().catch(() => "");
        throw new Error(inventoryImageUploadError(uploadResponse.status, responseBody));
      }

      const confirmation = {
        imageId: presign.imageId,
        contentType: prepared.type,
        byteSize: prepared.size,
        checksumSha256,
      };
      setStatus("Verifying logo...");
      let finalizeResponse = await fetch("/api/client/logo/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmation),
      });
      if (finalizeResponse.status >= 500) {
        finalizeResponse = await fetch("/api/client/logo/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(confirmation),
        });
      }
      const finalized = await responseJson(finalizeResponse);
      if (!finalizeResponse.ok || !finalized.imageId) {
        throw new Error(finalized.message || "The logo could not be verified.");
      }

      setCurrentLogoId(finalized.imageId);
      setStatus(finalized.cleanupPending
        ? "Logo saved. Previous-file cleanup will be retried later."
        : "Business logo saved.");
      router.refresh();
    } catch (uploadError) {
      setStatus("");
      setError(uploadError instanceof Error ? uploadError.message : "The logo upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeLogo() {
    if (!currentLogoId || busy || !window.confirm("Remove the business logo?")) return;
    setBusy(true);
    setError("");
    setStatus("Removing logo...");
    try {
      const response = await fetch(`/api/client/logo/${encodeURIComponent(currentLogoId)}`, {
        method: "DELETE",
      });
      const result = await responseJson(response);
      if (!response.ok) throw new Error(result.message || "The logo could not be removed.");
      setCurrentLogoId(null);
      setStatus(result.cleanupPending
        ? "Logo removed. Private-file cleanup is still pending."
        : "Business logo removed.");
      router.refresh();
    } catch (removeError) {
      setStatus("");
      setError(removeError instanceof Error ? removeError.message : "The logo could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="inventory-image-manager" aria-labelledby={`${inputId}-title`} aria-busy={busy}>
      <div className="inventory-image-head">
        <div>
          <strong id={`${inputId}-title`}>Business logo</strong>
          <small>Private in AWS S3</small>
        </div>
        <div className="inventory-image-actions">
          <label className={`inventory-image-upload ${!enabled || busy ? "disabled" : ""}`} htmlFor={inputId}>
            {busy && <span className="client-inline-spinner dark" aria-hidden="true" />}
            {busy ? "Working..." : currentLogoId ? "Replace logo" : "Upload logo"}
          </label>
          <input
            id={inputId}
            className="inventory-image-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={!enabled || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadLogo(file);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="inventory-image-grid">
        {currentLogoId ? (
          <article className="inventory-image-tile ready">
            <img
              key={currentLogoId}
              src={`/api/client/logo/${encodeURIComponent(currentLogoId)}`}
              alt={`${businessName} logo`}
              decoding="async"
              style={{ objectFit: "contain", background: "#fff" }}
            />
            <div>
              <small>Current logo</small>
              <button type="button" disabled={busy} onClick={() => void removeLogo()}>
                Remove
              </button>
            </div>
          </article>
        ) : (
          <p className="inventory-image-empty">No business logo uploaded yet.</p>
        )}
      </div>

      {!brandingAvailable && (
        <p className="inventory-image-feedback error" role="alert">
          Logo settings are unavailable until migration 013 is applied.
        </p>
      )}
      {brandingAvailable && !storageAvailable && (
        <p className="inventory-image-feedback error" role="alert">
          AWS image storage is not configured for this deployment.
        </p>
      )}
      {(status || error) && (
        <p
          className={error ? "inventory-image-feedback error" : "inventory-image-feedback"}
          role={error ? "alert" : "status"}
          aria-live={error ? "assertive" : "polite"}
        >
          {error || status}
        </p>
      )}
      <small className="inventory-image-safety">
        JPEG, PNG, or WebP only. Large logos are optimized before upload.
      </small>
    </section>
  );
}

function ClientPasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(
    changeClientPasswordAction,
    initialPasswordState,
  );

  return (
    <form className="client-auth-form" action={formAction} aria-busy={pending}>
      <label>
        Account email
        <input type="email" value={email} disabled readOnly />
      </label>
      <label>
        Current password
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          maxLength={200}
          required
        />
      </label>
      <label>
        New password
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={200}
          required
        />
      </label>
      <p className="client-password-hint">
        Use 12 or more characters with uppercase, lowercase, and a number.
      </p>
      <label>
        Confirm new password
        <input
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={200}
          required
        />
      </label>
      {state.error && <p className="client-form-error" role="alert">{state.error}</p>}
      <button className="client-primary-button" type="submit" disabled={pending}>
        {pending && <span className="client-inline-spinner" aria-hidden="true" />}
        {pending ? "Updating password..." : "Update password"}
      </button>
    </form>
  );
}

export function ClientSettingsForm({
  businessName,
  email,
  initialLogoId,
  brandingAvailable,
  storageAvailable,
}: {
  businessName: string;
  email: string;
  initialLogoId: string | null;
  brandingAvailable: boolean;
  storageAvailable: boolean;
}) {
  return (
    <section className="client-module-preview client-settings-grid">
      <div className="client-settings-card">
        <p className="client-kicker">Business identity</p>
        <h2>Make the workspace yours.</h2>
        <p>Your logo stays private and appears only inside your authenticated workspace.</p>
        <ClientLogoForm
          businessName={businessName}
          initialLogoId={initialLogoId}
          brandingAvailable={brandingAvailable}
          storageAvailable={storageAvailable}
        />
      </div>
      <div className="client-settings-card client-password-card">
        <p className="client-kicker">Account security</p>
        <h2>Change password</h2>
        <p className="inventory-image-note">
          Confirm your current password first. You will sign in again after the change.
        </p>
        <ClientPasswordForm email={email} />
      </div>
    </section>
  );
}
