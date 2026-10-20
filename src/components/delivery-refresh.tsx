"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function DeliveryRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [router]);
  return <small>Refreshes every 15 seconds while this page is visible.</small>;
}
