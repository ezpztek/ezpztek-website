"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  className = "admin-save-button",
  pendingLabel = "Saving…",
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" disabled={pending}>
      {pending && <span className="admin-spinner admin-spinner-dark" aria-hidden="true" />}
      {pending ? pendingLabel : children}
    </button>
  );
}

