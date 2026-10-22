"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireClientModule } from "@/lib/client-auth";
import { getClientBranch } from "@/lib/branches";
import { inventoryUnitValues } from "@/lib/inventory/catalog";
import { createAdminClient } from "@/lib/supabase/admin";

const productSchema = z.object({
  branchId: z.string().uuid(), sku: z.string().trim().max(60),
  barcode: z.string().trim().max(80), name: z.string().trim().min(2).max(140),
  category: z.string().trim().min(2).max(80), unit: z.enum(inventoryUnitValues),
  salePrice: z.coerce.number().min(0).max(100_000_000),
  cost: z.coerce.number().min(0).max(100_000_000),
  reorderLevel: z.coerce.number().int().min(0).max(10_000_000),
});
function productInput(form: FormData) {
  return {
    branchId: form.get("branchId"), sku: form.get("sku") || "", barcode: form.get("barcode") || "",
    name: form.get("name"), category: form.get("category") || "General", unit: form.get("unit") || "piece",
    salePrice: form.get("salePrice"), cost: form.get("cost"), reorderLevel: form.get("reorderLevel"),
  };
}
function refresh() {
  for (const path of ["/portal", "/portal/modules/inventory", "/portal/modules/pos",
    "/portal/modules/stock-control"]) revalidatePath(path);
}
function go(module: string, branchId: string | undefined, parameter: string): never {
  const query = new URLSearchParams(parameter);
  if (branchId) query.set("branch", branchId);
  redirect(`/portal/modules/${module}?${query}`);
}
async function canonicalCategory(clientId: string, requestedName: string) {
  const { data, error } = await createAdminClient().from("inventory_categories")
    .select("name")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .eq("name", requestedName)
    .maybeSingle();
  if (error) return { error: "Category setup is unavailable. Apply migration 011 first." } as const;
  if (!data) return { error: "Choose a category from the list or add it first." } as const;
  return { name: data.name } as const;
}

async function createInventoryProduct(
  client: { clientId: string; userId: string },
  form: FormData,
) {
  const parsed = productSchema.extend({
    openingStock: z.coerce.number().int().min(0).max(10_000_000),
  }).safeParse({ ...productInput(form), openingStock: form.get("openingStock") });
  if (!parsed.success) return { ok: false, code: "invalid", message: "Check the item details and try again." } as const;
  const p = parsed.data;
  await getClientBranch(client.clientId, p.branchId);
  const category = await canonicalCategory(client.clientId, p.category);
  if ("error" in category) return { ok: false, code: "category", message: category.error } as const;
  const { data, error } = await createAdminClient().rpc("create_branch_inventory_product", {
    p_client_id: client.clientId, p_branch_id: p.branchId, p_actor_user_id: client.userId,
    p_sku: p.sku, p_barcode: p.barcode, p_name: p.name, p_category: category.name, p_unit: p.unit,
    p_sale_price_centavos: Math.round(p.salePrice * 100), p_cost_centavos: Math.round(p.cost * 100),
    p_opening_stock: p.openingStock, p_reorder_level: p.reorderLevel,
  });
  if (error || typeof data !== "string") {
    const duplicate = error?.code === "23505";
    return {
      ok: false,
      code: duplicate ? "duplicate" : "save",
      message: duplicate
        ? "That SKU or barcode is already used by another item."
        : "The item could not be saved. Confirm migration 011 is installed.",
    } as const;
  }
  refresh();
  return { ok: true, productId: data, branchId: p.branchId, productName: p.name } as const;
}

export async function createInventoryCategoryAction(form: FormData) {
  const { client } = await requireClientModule("inventory");
  const parsed = z.string().trim().min(2).max(80)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
    .safeParse(form.get("name"));
  if (!parsed.success) return { ok: false, message: "Use a category name between 2 and 80 characters." } as const;
  const db = createAdminClient();
  const { data, error } = await db.from("inventory_categories").insert({
    client_id: client.clientId,
    name: parsed.data,
    created_by: client.userId,
  }).select("id,name").single();
  if (!error && data) {
    revalidatePath("/portal/modules/inventory");
    return { ok: true, category: { id: data.id, name: data.name } } as const;
  }
  if (error?.code === "23505") {
    const { data: categories } = await db.from("inventory_categories")
      .select("id,name").eq("client_id", client.clientId).eq("is_active", true).limit(500);
    const existing = categories?.find((item) => item.name.toLocaleLowerCase() === parsed.data.toLocaleLowerCase());
    if (existing) return { ok: true, category: existing } as const;
  }
  return {
    ok: false,
    message: error?.code === "42P01"
      ? "Category setup is unavailable. Apply migration 011 first."
      : "The category could not be added. Try again.",
  } as const;
}

export async function createInventoryProductModalAction(form: FormData) {
  const { client } = await requireClientModule("inventory");
  return createInventoryProduct(client, form);
}

export async function updateInventoryProductAction(form: FormData) {
  const { client } = await requireClientModule("inventory");
  const parsed = productSchema.extend({ productId: z.string().uuid(), isActive: z.boolean() })
    .safeParse({ ...productInput(form), productId: form.get("productId"), isActive: form.get("isActive") === "on" });
  if (!parsed.success) go("inventory", undefined, "error=invalid");
  const p = parsed.data;
  await getClientBranch(client.clientId, p.branchId);
  const category = await canonicalCategory(client.clientId, p.category);
  if ("error" in category) go("inventory", p.branchId, "error=category");
  const sku = p.sku || `AUTO-${p.productId.replaceAll("-", "").toUpperCase()}`;
  const { data, error } = await createAdminClient().from("inventory_products").update({
    sku, barcode: p.barcode || null, name: p.name, category: category.name, unit: p.unit,
    sale_price_centavos: Math.round(p.salePrice * 100), cost_centavos: Math.round(p.cost * 100),
    reorder_level: p.reorderLevel, is_active: p.isActive,
  }).eq("id", p.productId).eq("client_id", client.clientId).eq("branch_id", p.branchId)
    .select("id").maybeSingle();
  if (error || !data) go("inventory", p.branchId, `error=${error?.code === "23505" ? "duplicate" : "save"}`);
  refresh();
  go("inventory", p.branchId, "updated=1");
}
export async function adjustStockAction(form: FormData) {
  const { client } = await requireClientModule("stock-control");
  const parsed = z.object({
    branchId: z.string().uuid(), productId: z.string().uuid(),
    movementType: z.enum(["receipt", "adjustment_in", "adjustment_out", "damage", "return"]),
    quantity: z.coerce.number().int().min(1).max(10_000_000), note: z.string().trim().max(500),
  }).safeParse({ branchId: form.get("branchId"), productId: form.get("productId"),
    movementType: form.get("movementType"), quantity: form.get("quantity"), note: form.get("note") || "" });
  if (!parsed.success) go("stock-control", undefined, "error=invalid");
  const p = parsed.data;
  await getClientBranch(client.clientId, p.branchId);
  const db = createAdminClient();
  const { data: product } = await db.from("inventory_products").select("id")
    .eq("id", p.productId).eq("client_id", client.clientId).eq("branch_id", p.branchId).maybeSingle();
  if (!product) go("stock-control", p.branchId, "error=invalid");
  const { error } = await db.rpc("adjust_inventory_stock", {
    p_client_id: client.clientId, p_product_id: p.productId, p_actor_user_id: client.userId,
    p_movement_type: p.movementType, p_quantity: p.quantity, p_note: p.note,
  });
  if (error) go("stock-control", p.branchId, `error=${error.message.includes("INSUFFICIENT_STOCK") ? "stock" : "save"}`);
  refresh();
  go("stock-control", p.branchId, "adjusted=1");
}
export async function completePosSaleAction(form: FormData) {
  const { client } = await requireClientModule("pos");
  let cart: unknown;
  try { cart = JSON.parse(String(form.get("cart") || "[]")); }
  catch { go("pos", undefined, "error=cart"); }
  const parsed = z.object({
    branchId: z.string().uuid(), requestId: z.string().uuid(),
    cart: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(10_000) })).min(1).max(50),
    paymentMethod: z.enum(["cash", "gcash", "card", "bank"]),
    tenderedPesos: z.union([z.literal(""), z.coerce.number().min(0).max(100_000_000)]),
  }).safeParse({ branchId: form.get("branchId"), requestId: form.get("requestId"), cart,
    paymentMethod: form.get("paymentMethod"), tenderedPesos: form.get("tenderedPesos") || "" });
  if (!parsed.success) go("pos", undefined, "error=cart");
  const p = parsed.data;
  await getClientBranch(client.clientId, p.branchId);
  const { data, error } = await createAdminClient().rpc("complete_branch_pos_sale", {
    p_client_id: client.clientId, p_branch_id: p.branchId, p_cashier_user_id: client.userId,
    p_items: p.cart, p_payment_method: p.paymentMethod,
    p_tendered_centavos: p.paymentMethod === "cash" && p.tenderedPesos !== "" ? Math.round(p.tenderedPesos * 100) : null,
    p_request_id: p.requestId,
  });
  if (error || !data?.[0]) {
    const message = error?.message || "";
    const code = message.includes("OUT_OF_STOCK") ? "stock" : message.includes("INSUFFICIENT_PAYMENT")
      ? "payment" : message.includes("REQUEST_REUSED") ? "retry" : "checkout";
    go("pos", p.branchId, `error=${code}&requestId=${encodeURIComponent(p.requestId)}`);
  }
  refresh();
  go("pos", p.branchId, `receipt=${encodeURIComponent(data[0].receipt_number)}`);
}
