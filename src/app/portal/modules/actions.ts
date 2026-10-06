"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireClientModule } from "@/lib/client-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const productSchema = z.object({
  sku: z.string().trim().min(1).max(60),
  barcode: z.string().trim().max(80),
  name: z.string().trim().min(2).max(140),
  category: z.string().trim().min(2).max(80),
  unit: z.string().trim().min(1).max(20),
  salePrice: z.coerce.number().min(0).max(100_000_000),
  cost: z.coerce.number().min(0).max(100_000_000),
  reorderLevel: z.coerce.number().int().min(0).max(10_000_000),
});

export async function createInventoryProductAction(formData: FormData) {
  const { client } = await requireClientModule("inventory");
  const parsed = productSchema
    .extend({ openingStock: z.coerce.number().int().min(0).max(10_000_000) })
    .safeParse({
      sku: formData.get("sku"),
      barcode: formData.get("barcode") || "",
      name: formData.get("name"),
      category: formData.get("category") || "General",
      unit: formData.get("unit") || "pc",
      salePrice: formData.get("salePrice"),
      cost: formData.get("cost"),
      openingStock: formData.get("openingStock"),
      reorderLevel: formData.get("reorderLevel"),
    });

  if (!parsed.success) redirect("/portal/modules/inventory?error=invalid");

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("create_inventory_product", {
    p_client_id: client.clientId,
    p_actor_user_id: client.userId,
    p_sku: parsed.data.sku,
    p_barcode: parsed.data.barcode,
    p_name: parsed.data.name,
    p_category: parsed.data.category,
    p_unit: parsed.data.unit,
    p_sale_price_centavos: Math.round(parsed.data.salePrice * 100),
    p_cost_centavos: Math.round(parsed.data.cost * 100),
    p_opening_stock: parsed.data.openingStock,
    p_reorder_level: parsed.data.reorderLevel,
  });

  if (error) {
    redirect(`/portal/modules/inventory?error=${error.code === "23505" ? "duplicate" : "save"}`);
  }

  revalidatePath("/portal");
  revalidatePath("/portal/modules/inventory");
  revalidatePath("/portal/modules/pos");
  revalidatePath("/portal/modules/stock-control");
  redirect("/portal/modules/inventory?created=1");
}

export async function updateInventoryProductAction(formData: FormData) {
  const { client } = await requireClientModule("inventory");
  const parsed = productSchema
    .extend({
      productId: z.string().uuid(),
      isActive: z.boolean(),
    })
    .safeParse({
      productId: formData.get("productId"),
      sku: formData.get("sku"),
      barcode: formData.get("barcode") || "",
      name: formData.get("name"),
      category: formData.get("category") || "General",
      unit: formData.get("unit") || "pc",
      salePrice: formData.get("salePrice"),
      cost: formData.get("cost"),
      reorderLevel: formData.get("reorderLevel"),
      isActive: formData.get("isActive") === "on",
    });

  if (!parsed.success) redirect("/portal/modules/inventory?error=invalid");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("inventory_products")
    .update({
      sku: parsed.data.sku,
      barcode: parsed.data.barcode || null,
      name: parsed.data.name,
      category: parsed.data.category,
      unit: parsed.data.unit,
      sale_price_centavos: Math.round(parsed.data.salePrice * 100),
      cost_centavos: Math.round(parsed.data.cost * 100),
      reorder_level: parsed.data.reorderLevel,
      is_active: parsed.data.isActive,
    })
    .eq("id", parsed.data.productId)
    .eq("client_id", client.clientId);

  if (error) {
    redirect(`/portal/modules/inventory?error=${error.code === "23505" ? "duplicate" : "save"}`);
  }

  revalidatePath("/portal/modules/inventory");
  revalidatePath("/portal/modules/pos");
  revalidatePath("/portal/modules/stock-control");
  redirect("/portal/modules/inventory?updated=1");
}

const stockMovementTypes = [
  "receipt",
  "adjustment_in",
  "adjustment_out",
  "damage",
  "return",
] as const;

export async function adjustStockAction(formData: FormData) {
  const { client } = await requireClientModule("stock-control");
  const parsed = z
    .object({
      productId: z.string().uuid(),
      movementType: z.enum(stockMovementTypes),
      quantity: z.coerce.number().int().min(1).max(10_000_000),
      note: z.string().trim().max(500),
    })
    .safeParse({
      productId: formData.get("productId"),
      movementType: formData.get("movementType"),
      quantity: formData.get("quantity"),
      note: formData.get("note") || "",
    });

  if (!parsed.success) redirect("/portal/modules/stock-control?error=invalid");

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("adjust_inventory_stock", {
    p_client_id: client.clientId,
    p_product_id: parsed.data.productId,
    p_actor_user_id: client.userId,
    p_movement_type: parsed.data.movementType,
    p_quantity: parsed.data.quantity,
    p_note: parsed.data.note,
  });

  if (error) {
    const code = error.message.includes("INSUFFICIENT_STOCK") ? "stock" : "save";
    redirect(`/portal/modules/stock-control?error=${code}`);
  }

  revalidatePath("/portal");
  revalidatePath("/portal/modules/inventory");
  revalidatePath("/portal/modules/pos");
  revalidatePath("/portal/modules/stock-control");
  redirect("/portal/modules/stock-control?adjusted=1");
}

const cartSchema = z.array(
  z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(10_000),
  }),
).min(1).max(50);

export async function completePosSaleAction(formData: FormData) {
  const { client } = await requireClientModule("pos");

  let rawCart: unknown;
  try {
    rawCart = JSON.parse(String(formData.get("cart") || "[]"));
  } catch {
    redirect("/portal/modules/pos?error=cart");
  }

  const parsed = z
    .object({
      cart: cartSchema,
      paymentMethod: z.enum(["cash", "gcash", "card", "bank"]),
      tenderedPesos: z.union([z.literal(""), z.coerce.number().min(0).max(100_000_000)]),
    })
    .safeParse({
      cart: rawCart,
      paymentMethod: formData.get("paymentMethod"),
      tenderedPesos: formData.get("tenderedPesos") || "",
    });

  if (!parsed.success) redirect("/portal/modules/pos?error=cart");

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("complete_pos_sale", {
    p_client_id: client.clientId,
    p_cashier_user_id: client.userId,
    p_items: parsed.data.cart,
    p_payment_method: parsed.data.paymentMethod,
    p_tendered_centavos:
      parsed.data.paymentMethod === "cash" && parsed.data.tenderedPesos !== ""
        ? Math.round(parsed.data.tenderedPesos * 100)
        : null,
  });

  if (error || !data?.[0]) {
    const message = error?.message || "";
    const errorCode = message.includes("OUT_OF_STOCK")
      ? "stock"
      : message.includes("INSUFFICIENT_PAYMENT")
        ? "payment"
        : "checkout";
    redirect(`/portal/modules/pos?error=${errorCode}`);
  }

  const sale = data[0];
  revalidatePath("/portal");
  revalidatePath("/portal/modules/inventory");
  revalidatePath("/portal/modules/pos");
  revalidatePath("/portal/modules/stock-control");
  redirect(
    `/portal/modules/pos?receipt=${encodeURIComponent(sale.receipt_number)}&total=${sale.total_centavos}&change=${sale.change_centavos}`,
  );
}
