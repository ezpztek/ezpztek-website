"use client";

import { useEffect } from "react";
import { AdminIcon } from "@/components/admin/admin-icon";

export default function AdminWorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin workspace error", error.digest);
  }, [error]);

  return (
    <div className="admin-page">
      <div className="admin-empty-state admin-error-state">
        <span><AdminIcon name="spark" size={26} /></span>
        <h2>That operation did not complete.</h2>
        <p>Check the Supabase migration and environment settings, then try again.</p>
        <button className="admin-primary-button" type="button" onClick={reset}>Try again</button>
      </div>
    </div>
  );
}

