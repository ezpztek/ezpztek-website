import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDeliveryEvent, type DeliveryEvent } from "./core";

export const sandboxEnabled = () => process.env.DELIVERY_SANDBOX_ENABLED === "true";
export async function ownedConnection(clientId: string, connectionId: string) {
  const { data, error } = await createAdminClient().from("delivery_connections")
    .select("id,client_id,branch_id,remote_store_id,environment,status")
    .eq("id", connectionId).eq("client_id", clientId).maybeSingle();
  if (error || !data) throw new Error("CONNECTION_UNAVAILABLE");
  return data;
}
export async function enqueueEvent(connectionId: string, event: DeliveryEvent): Promise<string> {
  const normalized = parseDeliveryEvent(event);
  const { data, error } = await createAdminClient().rpc("enqueue_delivery_event", {
    p_connection_id: connectionId, p_event: normalized,
  });
  if (error || !data) {
    const message = error?.message || "";
    throw new Error(message.includes("EVENT_ID_CONFLICT") ? "EVENT_ID_CONFLICT"
      : message.includes("SANDBOX_RATE_LIMIT") ? "SANDBOX_RATE_LIMIT" : "EVENT_NOT_STORED");
  }
  return String(data);
}
export async function processEvents(clientId: string | null = null): Promise<number> {
  const { data, error } = await createAdminClient().rpc("process_delivery_events", {
    p_limit: 25, p_client_id: clientId,
  });
  if (error) throw new Error("WORKER_UNAVAILABLE");
  return Number(data || 0);
}
