import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDeliveryEvent } from "@/lib/delivery/core";
import { readLimitedBody, verifySandboxSignature } from "@/lib/delivery/security";
import { enqueueEvent, processEvents, sandboxEnabled } from "@/lib/delivery/server";
export const runtime = "nodejs";
export const maxDuration = 30;

/** EZPZTEK simulation endpoint, NOT the Delivery Hero Restaurant Plugin API. */
export async function POST(request: Request) {
  if (!sandboxEnabled()) return Response.json({ error: "sandbox_disabled" }, { status: 404 });
  const encoding = request.headers.get("content-encoding");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
    || (encoding && encoding !== "identity")) {
    return Response.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  let body: string;
  try { body = await readLimitedBody(request); }
  catch { return Response.json({ error: "invalid_or_oversized_body" }, { status: 413 }); }
  if (!verifySandboxSignature(body, request.headers.get("x-ezpz-timestamp"),
    request.headers.get("x-ezpz-signature"), process.env.DELIVERY_SANDBOX_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let event;
  try { event = parseDeliveryEvent(JSON.parse(body)); }
  catch { return Response.json({ error: "invalid_event" }, { status: 400 }); }
  const { data: connection, error } = await createAdminClient().from("delivery_connections")
    .select("id").eq("provider", "foodpanda").eq("environment", "sandbox")
    .eq("remote_store_id", event.remoteStoreId).eq("status", "active").maybeSingle();
  if (error) return Response.json({ error: "storage_unavailable" }, { status: 503 });
  if (!connection) return Response.json({ error: "sandbox_store_not_found" }, { status: 404 });
  try {
    const eventId = await enqueueEvent(connection.id, event);
    // Inbox is committed before acknowledging. after() is an optimization,
    // not the recovery mechanism: schedule the database worker separately.
    after(async () => {
      try { await processEvents(); }
      catch { console.error("delivery_worker_retry_required"); }
    });
    return Response.json({ eventId, status: "stored" }, {
      status: 202, headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "EVENT_ID_CONFLICT") return Response.json({ error: "event_id_conflict" }, { status: 409 });
    if (message === "SANDBOX_RATE_LIMIT") return Response.json({ error: "sandbox_rate_limit" }, { status: 429, headers: { "Retry-After": "60" } });
    return Response.json({ error: "storage_unavailable" }, { status: 503 });
  }
}
