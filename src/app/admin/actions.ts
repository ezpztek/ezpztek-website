"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthClient } from "@/lib/supabase/server";

const inquiryStatuses = ["new", "contacted", "qualified", "closed", "spam"] as const;
const clientStatuses = ["lead", "onboarding", "active", "paused", "cancelled"] as const;
const subscriptionStatuses = ["trial", "active", "past_due", "paused"] as const;

async function logAdminAction(
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("admin_activity_log").insert({
    admin_user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  });

  if (error) console.error("Admin activity log insert failed.");
}

export async function logoutAction() {
  await requireAdmin();
  const authClient = await createAuthClient();
  await authClient.auth.signOut();
  redirect("/admin/login");
}

export async function updateInquiryAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      id: z.string().uuid(),
      status: z.enum(inquiryStatuses),
      notes: z.string().trim().max(4000),
    })
    .safeParse({
      id: formData.get("id"),
      status: formData.get("status"),
      notes: formData.get("notes") || "",
    });

  if (!parsed.success) throw new Error("Invalid inquiry update.");

  const supabase = createAdminClient();
  const contactedAt = ["contacted", "qualified", "closed"].includes(parsed.data.status)
    ? new Date().toISOString()
    : null;

  const { error } = await supabase
    .from("consultation_requests")
    .update({
      status: parsed.data.status,
      admin_notes: parsed.data.notes || null,
      contacted_at: contactedAt,
    })
    .eq("id", parsed.data.id);

  if (error) throw new Error("Could not update the inquiry.");

  if (parsed.data.status === "qualified") {
    const { error: promotionError } = await supabase.rpc(
      "promote_qualified_inquiry_to_client",
      {
        p_inquiry_id: parsed.data.id,
        p_admin_user_id: admin.userId,
      },
    );

    if (promotionError) {
      console.error("Qualified inquiry client promotion failed", promotionError.code);
    }
  }

  await logAdminAction(admin.userId, "inquiry.updated", "consultation", parsed.data.id, {
    status: parsed.data.status,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/inquiries");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/access");
}

export async function syncQualifiedInquiriesAction() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc(
    "sync_qualified_inquiries_to_clients",
    { p_admin_user_id: admin.userId },
  );

  if (error) throw new Error("Could not sync qualified inquiries. Run migration 202610060005 first.");

  const result = data?.[0] || {
    processed: 0,
    clients_created: 0,
    clients_linked: 0,
  };

  revalidatePath("/admin");
  revalidatePath("/admin/inquiries");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/access");
  redirect(
    `/admin/inquiries?sync=done&processed=${result.processed}&created=${result.clients_created}&linked=${result.clients_linked}`,
  );
}

const clientSchema = z.object({
  businessName: z.string().trim().min(2).max(140),
  contactName: z.string().trim().min(2).max(100),
  contactEmail: z.string().trim().email().max(254),
  contactPhone: z.string().trim().max(32),
  website: z.string().trim().max(240),
  notes: z.string().trim().max(4000),
});

export async function createClientAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = clientSchema.safeParse({
    businessName: formData.get("businessName"),
    contactName: formData.get("contactName"),
    contactEmail: formData.get("contactEmail"),
    contactPhone: formData.get("contactPhone") || "",
    website: formData.get("website") || "",
    notes: formData.get("notes") || "",
  });

  if (!parsed.success) throw new Error("Please complete the required client details.");

  const supabase = createAdminClient();
  const { data: client, error } = await supabase
    .from("clients")
    .insert({
      business_name: parsed.data.businessName,
      contact_name: parsed.data.contactName,
      contact_email: parsed.data.contactEmail.toLowerCase(),
      contact_phone: parsed.data.contactPhone || null,
      website: parsed.data.website || null,
      notes: parsed.data.notes,
    })
    .select("id")
    .single();

  if (error || !client) throw new Error("Could not create the client.");

  await logAdminAction(admin.userId, "client.created", "client", client.id, {
    businessName: parsed.data.businessName,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  redirect("/admin/clients?created=1");
}

export async function updateClientStatusAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z
    .object({ id: z.string().uuid(), status: z.enum(clientStatuses) })
    .safeParse({ id: formData.get("id"), status: formData.get("status") });

  if (!parsed.success) throw new Error("Invalid client update.");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("clients")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id);

  if (error) throw new Error("Could not update the client.");

  await logAdminAction(admin.userId, "client.status_updated", "client", parsed.data.id, {
    status: parsed.data.status,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/clients");
}

function renewalDate(startDate: string, interval: "monthly" | "yearly" | "custom") {
  if (interval === "custom") return null;
  const date = new Date(`${startDate}T12:00:00Z`);
  if (interval === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  if (interval === "yearly") date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

export async function assignSubscriptionAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      clientId: z.string().uuid(),
      planId: z.string().uuid(),
      status: z.enum(subscriptionStatuses),
      startsAt: z.string().date(),
    })
    .safeParse({
      clientId: formData.get("clientId"),
      planId: formData.get("planId"),
      status: formData.get("subscriptionStatus"),
      startsAt: formData.get("startsAt"),
    });

  if (!parsed.success) throw new Error("Invalid subscription details.");

  const supabase = createAdminClient();
  const { data: plan, error: planError } = await supabase
    .from("subscription_plans")
    .select("price_centavos, billing_interval")
    .eq("id", parsed.data.planId)
    .single();

  if (planError || !plan) throw new Error("Subscription plan not found.");

  const { data: subscriptionId, error } = await supabase.rpc(
    "replace_client_subscription",
    {
      p_client_id: parsed.data.clientId,
      p_plan_id: parsed.data.planId,
      p_status: parsed.data.status,
      p_amount_centavos: plan.price_centavos,
      p_starts_at: parsed.data.startsAt,
      p_renews_at: renewalDate(parsed.data.startsAt, plan.billing_interval),
    },
  );

  if (error || !subscriptionId) throw new Error("Could not assign the subscription.");

  if (["active", "trial"].includes(parsed.data.status)) {
    await supabase
      .from("clients")
      .update({ status: parsed.data.status === "active" ? "active" : "onboarding" })
      .eq("id", parsed.data.clientId);
  }

  await logAdminAction(
    admin.userId,
    "subscription.assigned",
    "subscription",
    subscriptionId,
    { clientId: parsed.data.clientId, planId: parsed.data.planId },
  );

  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  redirect("/admin/clients?subscription=1");
}

export async function updatePlanAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      id: z.string().uuid(),
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(500),
      pricePesos: z.union([z.literal(""), z.coerce.number().min(0).max(10000000)]),
      billingInterval: z.enum(["monthly", "yearly", "custom"]),
      features: z.string().max(2000),
      isActive: z.boolean(),
    })
    .safeParse({
      id: formData.get("id"),
      name: formData.get("name"),
      description: formData.get("description") || "",
      pricePesos: formData.get("pricePesos") || "",
      billingInterval: formData.get("billingInterval"),
      features: formData.get("features") || "",
      isActive: formData.get("isActive") === "on",
    });

  if (!parsed.success) throw new Error("Invalid plan details.");

  const features = parsed.data.features
    .split("\n")
    .map((feature) => feature.trim())
    .filter(Boolean)
    .slice(0, 20);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("subscription_plans")
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      price_centavos:
        parsed.data.pricePesos === "" ? null : Math.round(parsed.data.pricePesos * 100),
      billing_interval: parsed.data.billingInterval,
      features,
      is_active: parsed.data.isActive,
    })
    .eq("id", parsed.data.id);

  if (error) throw new Error("Could not update the plan.");

  await logAdminAction(admin.userId, "plan.updated", "subscription_plan", parsed.data.id);
  revalidatePath("/admin");
  revalidatePath("/admin/plans");
}
