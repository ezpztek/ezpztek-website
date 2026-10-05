"use client";

import { FormEvent, useState } from "react";

const contactEmail =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hello@ezpztek.com";

export default function ContactForm() {
  const [status, setStatus] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const business = String(form.get("business") || "").trim();
    const contact = String(form.get("contact") || "").trim();
    const painPoint = String(form.get("painPoint") || "").trim();

    const subject = encodeURIComponent(
      `Process consultation request — ${business || name}`,
    );
    const body = encodeURIComponent(
      [
        "Hello EZPZTEK,",
        "",
        "I’d like to discuss a business process that may be ready for digitalization.",
        "",
        `Name: ${name}`,
        `Business: ${business}`,
        `Preferred contact: ${contact}`,
        `Current challenge: ${painPoint}`,
        "",
        "Thank you.",
      ].join("\n"),
    );

    setStatus("Your email draft is ready. Review it, then send when you’re comfortable.");
    window.location.href = `mailto:${contactEmail}?subject=${subject}&body=${body}`;
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <label>
          Your name
          <input name="name" autoComplete="name" placeholder="Juan Dela Cruz" required />
        </label>
        <label>
          Business name
          <input name="business" autoComplete="organization" placeholder="Your company" required />
        </label>
      </div>
      <label>
        Email or mobile number
        <input
          name="contact"
          autoComplete="email"
          placeholder="How should we reach you?"
          required
        />
      </label>
      <label>
        What process is slowing you down?
        <textarea
          name="painPoint"
          placeholder="Example: We update inventory in three spreadsheets and reconcile them every Friday."
          required
          rows={5}
        />
      </label>
      <button className="button button-dark form-button" type="submit">
        Prepare consultation email
      </button>
      <p className="form-note">
        You review the message before sending. Nothing is uploaded from this page.
      </p>
      <p className="form-status" aria-live="polite">{status}</p>
    </form>
  );
}
