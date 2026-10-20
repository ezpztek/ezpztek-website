"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireClientModule } from "@/lib/client-auth";
import { getClientBranch } from "@/lib/branches";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliveryStatuses } from "@/lib/delivery/core";
import { enqueueEvent, ownedConnection, processEvents, sandboxEnabled } from "@/lib/delivery/server";
const path = "/portal/modules/integrations";
const uuid = z.string().uuid();
function finish(status: string): never {
  revalidatePath(path);
  redirect(`${path}?notice=${status}`);
}
function invalid(): never { redirect(`${path}?notice=invalid`); }

export async function createBranchAction(form: FormData) {
  const { client } = await requireClientModule("pos");
  const parsed = z.string().trim().min(2).max(100).safeParse(form.get("name"));
  if (!parsed.success) invalid();
  const { error } = await createAdminClient().rpc("create_client_branch", {
    p_client_id: client.clientId, p_name: parsed.data,
  });
  if (error) finish("failed");
  finish("branch_created");
}
export async function requestConnectionAction(form: FormData) {
  const { client, moduleAccess } = await requireClientModule("pos");
  const parsed = z.object({
    branchId: uuid, environment: z.enum(["sandbox", "staging", "production"]),
    vendorCode: z.string().trim().max(120), chainCode: z.string().trim().max(120),
    consent: z.literal("on"),
  }).safeParse({ branchId: form.get("branchId"), environment: form.get("environment"),
    vendorCode: form.get("vendorCode") || "", chainCode: form.get("chainCode") || "", consent: form.get("consent") });
  if (!parsed.success) invalid();
  const p = parsed.data;
  await getClientBranch(client.clientId, p.branchId);
  if (p.environment === "sandbox" && !sandboxEnabled()) finish("sandbox_disabled");
  if (p.environment !== "sandbox" && moduleAccess.access_mode !== "full") finish("full_access_required");
  if (p.environment !== "sandbox" && (!p.vendorCode || !p.chainCode)) invalid();
  const { error } = await createAdminClient().from("delivery_connections").insert({
    client_id: client.clientId, branch_id: p.branchId, provider: "foodpanda", environment: p.environment,
    status: p.environment === "sandbox" ? "active" : "requested",
    vendor_code: p.vendorCode || null, chain_code: p.chainCode || null, consent_by: client.userId,
  });
  if (error) finish(error.code === "23505" ? "connection_exists" : "failed");
  finish(p.environment === "sandbox" ? "sandbox_created" : "approval_requested");
}
export async function mapProductAction(form: FormData) {
  const { client } = await requireClientModule("pos");
  const parsed = z.object({ connectionId: uuid, productId: uuid,
    externalProductId: z.string().trim().min(1).max(120),
  }).safeParse({ connectionId: form.get("connectionId"), productId: form.get("productId"),
    externalProductId: form.get("externalProductId") });
  if (!parsed.success) invalid();
  const conn = await ownedConnection(client.clientId, parsed.data.connectionId);
  const { error } = await createAdminClient().rpc("save_delivery_product_mapping", {
    p_client_id: client.clientId, p_connection_id: conn.id,
    p_external_product_id: parsed.data.externalProductId, p_product_id: parsed.data.productId,
    p_actor_user_id: client.userId,
  });
  if (error) finish("mapping_failed");
  finish("mapped");
}
export async function simulateOrderAction(form: FormData) {
  const { client } = await requireClientModule("pos");
  if (!sandboxEnabled()) finish("sandbox_disabled");
  const parsed = z.object({ connectionId: uuid, externalProductId: z.string().trim().min(1).max(120) })
    .safeParse({ connectionId: form.get("connectionId"), externalProductId: form.get("externalProductId") });
  if (!parsed.success) invalid();
  const conn = await ownedConnection(client.clientId, parsed.data.connectionId);
  if (conn.environment !== "sandbox" || conn.status !== "active") invalid();
  const db = createAdminClient();
  const { data: mapping } = await db.from("delivery_product_mappings").select("product_id")
    .eq("connection_id", conn.id).eq("client_id", client.clientId)
    .eq("external_product_id", parsed.data.externalProductId).maybeSingle();
  if (!mapping) finish("mapping_failed");
  const { data: product } = await db.from("inventory_products").select("name,sale_price_centavos")
    .eq("id", mapping.product_id).eq("client_id", client.clientId).eq("branch_id", conn.branch_id).maybeSingle();
  if (!product) finish("mapping_failed");
  const price = Number(product.sale_price_centavos);
  try {
    await enqueueEvent(conn.id, {
      schemaVersion: 1, eventId: randomUUID(), occurredAt: new Date().toISOString(),
      remoteStoreId: conn.remote_store_id, orderId: `TEST-${randomUUID()}`, status: "received",
      order: { currency: "PHP", subtotalCentavos: price, discountCentavos: 0, totalCentavos: price,
        collection: "platform", items: [{ externalProductId: parsed.data.externalProductId,
          name: product.name, quantity: 1, unitPriceCentavos: price }] },
    });
    await processEvents(client.clientId);
  } catch { finish("failed"); }
  finish("simulated");
}
export async function simulateStatusAction(form: FormData) {
  const { client } = await requireClientModule("pos");
  if (!sandboxEnabled()) finish("sandbox_disabled");
  const parsed = z.object({ orderId: uuid, status: z.enum(deliveryStatuses) })
    .safeParse({ orderId: form.get("orderId"), status: form.get("status") });
  if (!parsed.success || parsed.data.status === "received") invalid();
  const { data: order } = await createAdminClient().from("delivery_orders")
    .select("connection_id,external_order_id").eq("id", parsed.data.orderId)
    .eq("client_id", client.clientId).maybeSingle();
  if (!order) invalid();
  const conn = await ownedConnection(client.clientId, order.connection_id);
  if (conn.environment !== "sandbox" || conn.status !== "active") invalid();
  try {
    await enqueueEvent(conn.id, { schemaVersion: 1, eventId: randomUUID(),
      occurredAt: new Date().toISOString(), remoteStoreId: conn.remote_store_id,
      orderId: order.external_order_id, status: parsed.data.status });
    await processEvents(client.clientId);
  } catch { finish("failed"); }
  finish("simulated");
}
export async function retryEventAction(form: FormData) {
  const { client } = await requireClientModule("pos");
  const parsed = uuid.safeParse(form.get("eventId"));
  if (!parsed.success) invalid();
  const { error } = await createAdminClient().rpc("retry_delivery_event", {
    p_client_id: client.clientId, p_event_id: parsed.data, p_actor_user_id: client.userId,
  });
  if (error) finish("failed");
  try { await processEvents(client.clientId); } catch { finish("failed"); }
  finish("retried");
}
export async function processPendingAction() {
  const { client } = await requireClientModule("pos");
  try { await processEvents(client.clientId); } catch { finish("failed"); }
  finish("processed");
}
export async function disconnectAction(form: FormData) {
  const { client } = await requireClientModule("pos");
  const parsed = uuid.safeParse(form.get("connectionId"));
  if (!parsed.success || form.get("confirm") !== "on") invalid();
  const { error } = await createAdminClient().rpc("disconnect_delivery_connection", {
    p_client_id: client.clientId, p_connection_id: parsed.data, p_actor_user_id: client.userId,
  });
  if (error) finish("failed");
  finish("disconnected");
}
export async function resolveInventoryAction(form: FormData) {
  const { client, moduleAccess } = await requireClientModule("pos");
  const parsed = z.object({ orderId: uuid, resolution: z.enum(["restocked", "consumed"]) })
    .safeParse({ orderId: form.get("orderId"), resolution: form.get("resolution") });
  if (!parsed.success || form.get("confirm") !== "on" || moduleAccess.access_mode !== "full") invalid();
  const { error } = await createAdminClient().rpc("resolve_delivery_inventory", {
    p_client_id: client.clientId, p_order_id: parsed.data.orderId,
    p_actor_user_id: client.userId, p_resolution: parsed.data.resolution,
  });
  if (error) finish("failed");
  for (const page of ["inventory", "pos", "stock-control"]) revalidatePath(`/portal/modules/${page}`);
  finish("resolved");
}
