"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import {
  getPublicSiteUrl,
  sendClientApprovalEmail,
  sendClientInvitationEmail,
} from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

const idSchema = z.string().uuid();

async function recordActivity(
  adminUserId: string,
  action: string,
  entityId: string,
  details: Record<string, unknown>,
) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("admin_activity_log").insert({
    admin_user_id: adminUserId,
    action,
    entity_type: "client_portal",
    entity_id: entityId,
    details,
  });
  if (error) console.error("Client portal activity logging failed", error.code);
}

export async function inviteClientAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsedClientId = idSchema.safeParse(formData.get("clientId"));
  if (!parsedClientId.success) throw new Error("Invalid client invitation.");

  const supabase = createAdminClient();
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, business_name, contact_name, contact_email")
    .eq("id", parsedClientId.data)
    .single();

  if (clientError || !client) throw new Error("Client record not found.");

  const { data: existingAccount } = await supabase
    .from("client_portal_accounts")
    .select("user_id")
    .eq("client_id", client.id)
    .maybeSingle();
  if (existingAccount) throw new Error("This client already created portal credentials.");

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await supabase
    .from("client_invitations")
    .update({ status: "revoked" })
    .eq("client_id", client.id)
    .eq("status", "pending");

  const { data: invitation, error: invitationError } = await supabase
    .from("client_invitations")
    .insert({
      client_id: client.id,
      email: client.contact_email.toLowerCase(),
      token_hash: tokenHash,
      invited_by: admin.userId,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (invitationError || !invitation) throw new Error("Could not create the invitation.");

  let emailSent = false;
  try {
    const invitationUrl = `${getPublicSiteUrl()}/register?token=${encodeURIComponent(rawToken)}`;
    await sendClientInvitationEmail({
      email: client.contact_email,
      name: client.contact_name,
      businessName: client.business_name,
      invitationUrl,
    });
    emailSent = true;
  } catch (error) {
    console.error(
      "Client invitation email failed",
      error instanceof Error ? error.message : "UNKNOWN_EMAIL_ERROR",
    );
  }

  await supabase
    .from("client_invitations")
    .update({ email_status: emailSent ? "sent" : "failed" })
    .eq("id", invitation.id);

  await recordActivity(admin.userId, "client.invited", client.id, {
    invitationId: invitation.id,
    emailSent,
  });

  revalidatePath("/admin/access");
  redirect(`/admin/access?invite=${emailSent ? "sent" : "failed"}`);
}

export async function approveClientAccessAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      accountUserId: z.string().uuid(),
      moduleIds: z.array(z.string().uuid()).min(1).max(20),
    })
    .safeParse({
      accountUserId: formData.get("accountUserId"),
      moduleIds: formData.getAll("moduleIds"),
    });

  if (!parsed.success) throw new Error("Select at least one valid solution module.");

  const supabase = createAdminClient();
  const { data: account, error: accountError } = await supabase
    .from("client_portal_accounts")
    .select("user_id, display_name, status, client_id, clients!inner(business_name, contact_email)")
    .eq("user_id", parsed.data.accountUserId)
    .single();

  if (accountError || !account) throw new Error("Client portal account not found.");

  const { data: modules, error: modulesError } = await supabase
    .from("solution_modules")
    .select("id, name")
    .in("id", parsed.data.moduleIds)
    .eq("is_active", true);

  if (modulesError || modules.length !== parsed.data.moduleIds.length) {
    throw new Error("One or more selected modules are unavailable.");
  }

  const wasApproved = account.status === "approved";
  const { error: approvalError } = await supabase.rpc(
    "approve_client_portal_access",
    {
      p_account_user_id: parsed.data.accountUserId,
      p_module_ids: parsed.data.moduleIds,
      p_admin_user_id: admin.userId,
    },
  );

  if (approvalError) throw new Error("Could not approve the client workspace.");

  let emailSent = wasApproved;
  if (!wasApproved) {
    const { data: userData } = await supabase.auth.admin.getUserById(account.user_id);
    const relatedClient = Array.isArray(account.clients) ? account.clients[0] : account.clients;
    const recipientEmail = userData.user?.email || relatedClient?.contact_email;

    if (recipientEmail && relatedClient) {
      try {
        await sendClientApprovalEmail({
          email: recipientEmail,
          name: account.display_name,
          businessName: relatedClient.business_name,
          moduleNames: modules.map((module) => module.name),
          loginUrl: `${getPublicSiteUrl()}/login`,
        });
        emailSent = true;
      } catch (error) {
        console.error(
          "Client approval email failed",
          error instanceof Error ? error.message : "UNKNOWN_EMAIL_ERROR",
        );
      }
    }
  }

  await recordActivity(
    admin.userId,
    wasApproved ? "client.access_updated" : "client.access_approved",
    account.client_id,
    { accountUserId: account.user_id, moduleIds: parsed.data.moduleIds, emailSent },
  );

  revalidatePath("/admin/access");
  redirect(
    `/admin/access?${wasApproved ? "access=updated" : `approval=${emailSent ? "sent" : "email-failed"}`}`,
  );
}

