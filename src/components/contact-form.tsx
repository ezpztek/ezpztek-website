"use client";

import { FormEvent, useRef, useState } from "react";

type SubmitState = {
  type: "idle" | "pending" | "success" | "error";
  message: string;
};

type ConsultationResponse = {
  ok?: boolean;
  emailSent?: boolean;
  message?: string;
};

const publicContactEmail =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hello@ezpztek.com";

export default function ContactForm() {
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<SubmitState>({
    type: "idle",
    message: "",
  });
  const submissionId = useRef<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    submissionId.current ||= crypto.randomUUID();
    setSubmitting(true);
    setStatus({ type: "pending", message: "Sending your request securely…" });

    try {
      const response = await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: submissionId.current,
          name: String(form.get("name") || "").trim(),
          businessName: String(form.get("businessName") || "").trim(),
          email: String(form.get("email") || "").trim(),
          phone: String(form.get("phone") || "").trim(),
          message: String(form.get("message") || "").trim(),
          consent: form.get("consent") === "on",
          website: String(form.get("website") || "").trim(),
        }),
      });

      const result = (await response.json().catch(() => ({}))) as ConsultationResponse;

      if (!response.ok || !result.ok) {
        throw new Error(
          result.message || "We couldn’t send your request. Please try again.",
        );
      }

      formElement.reset();
      submissionId.current = null;

      setStatus({
        type: "success",
        message:
          "Thank you for choosing EZPZTEK. Your request is safely recorded and we’ll contact you within 24–48 hours.",
      });
    } catch (error) {
      setStatus({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "We couldn’t send your request. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="contact-form"
      onSubmit={handleSubmit}
      aria-busy={submitting}
    >
      <div className="form-row">
        <label htmlFor="name">
          Your name
          <input
            id="name"
            name="name"
            autoComplete="name"
            placeholder="Juan Dela Cruz"
            minLength={2}
            maxLength={100}
            required
          />
        </label>
        <label htmlFor="businessName">
          Business name
          <input
            id="businessName"
            name="businessName"
            autoComplete="organization"
            placeholder="Your company"
            minLength={2}
            maxLength={120}
            required
          />
        </label>
      </div>

      <div className="form-row">
        <label htmlFor="email">
          Email address
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            maxLength={254}
            required
          />
        </label>
        <label htmlFor="phone">
          <span className="field-label">
            Mobile number <span className="optional-label">Optional</span>
          </span>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+63 9XX XXX XXXX"
            maxLength={32}
          />
        </label>
      </div>

      <label htmlFor="message">
        What process is slowing you down?
        <textarea
          id="message"
          name="message"
          placeholder="Example: We update inventory in three spreadsheets and reconcile them every Friday."
          minLength={10}
          maxLength={2000}
          required
          rows={5}
        />
      </label>

      <label className="consent-field" htmlFor="consent">
        <input id="consent" name="consent" type="checkbox" required />
        <span>
          I agree that EZPZTEK may use these details to respond to my inquiry.
        </span>
      </label>

      <label className="form-honeypot" htmlFor="website" aria-hidden="true">
        Website
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </label>

      <button
        className="button button-dark form-button"
        type="submit"
        disabled={submitting}
      >
        {submitting ? (
          <>
            <span className="button-spinner" aria-hidden="true" />
            <span>Sending request…</span>
          </>
        ) : (
          "Book my free consultation"
        )}
      </button>

      <p className="form-note">
        We’ll save your inquiry securely and send a confirmation email. If the
        form is unavailable, email{" "}
        <a href={`mailto:${publicContactEmail}`}>{publicContactEmail}</a>.
      </p>
      <p
        className={`form-status form-status-${status.type}`}
        aria-live="polite"
        role="status"
      >
        {status.message}
      </p>
    </form>
  );
}
