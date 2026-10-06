import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_REQUEST_BYTES = 20_000;

const consultationSchema = z.object({
  submissionId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  businessName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(32).default(""),
  message: z.string().trim().min(10).max(2000),
  consent: z.literal(true),
  website: z.string().trim().max(200).default(""),
});

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin) return process.env.NODE_ENV !== "production";

  try {
    const allowedOrigins = new Set<string>();

    if (process.env.SITE_URL) {
      allowedOrigins.add(new URL(process.env.SITE_URL).origin);
    }

    if (process.env.VERCEL_URL) {
      allowedOrigins.add(new URL(`https://${process.env.VERCEL_URL}`).origin);
    }

    if (process.env.NODE_ENV !== "production") {
      allowedOrigins.add("http://localhost:3000");
      allowedOrigins.add("http://127.0.0.1:3000");
    }

    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

function getRequestFingerprint(request: Request, secret: string) {
  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0];
  const clientIp = forwardedIp?.trim() || request.headers.get("x-real-ip") || "unknown";

  return createHmac("sha256", secret).update(clientIp).digest("hex");
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character] || character,
  );
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").slice(0, 120);
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return jsonResponse(
      { ok: false, message: "This request could not be verified." },
      403,
    );
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return jsonResponse(
      { ok: false, message: "Please submit the consultation form again." },
      415,
    );
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse(
      { ok: false, message: "Your message is too long to submit." },
      413,
    );
  }

  const rawBody = await request.text();

  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
    return jsonResponse(
      { ok: false, message: "Your message is too long to submit." },
      413,
    );
  }

  let requestBody: unknown;
  try {
    requestBody = JSON.parse(rawBody);
  } catch {
    return jsonResponse(
      { ok: false, message: "Please check the form and try again." },
      400,
    );
  }

  const parsed = consultationSchema.safeParse(requestBody);

  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        message: "Please complete all required fields with valid information.",
      },
      400,
    );
  }

  // Silently accept bot submissions that fill the hidden honeypot field.
  if (parsed.data.website) {
    return jsonResponse({ ok: true, emailSent: true });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  const rateLimitSecret = process.env.RATE_LIMIT_SECRET;

  if (!supabaseUrl || !supabaseSecretKey || !rateLimitSecret) {
    console.error("Consultation API is missing its server configuration.");
    return jsonResponse(
      {
        ok: false,
        message:
          "Online booking is being configured. Please email us directly for now.",
      },
      503,
    );
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const inquiry = {
    submissionId: parsed.data.submissionId,
    name: parsed.data.name,
    businessName: parsed.data.businessName,
    email: parsed.data.email.toLowerCase(),
    phone: parsed.data.phone || null,
    message: parsed.data.message,
    requestFingerprint: getRequestFingerprint(request, rateLimitSecret),
  };

  const { data: existingRequest, error: existingRequestError } = await supabase
    .from("consultation_requests")
    .select(
      "id, name, business_name, email, phone, message, confirmation_status",
    )
    .eq("submission_id", inquiry.submissionId)
    .maybeSingle();

  if (existingRequestError) {
    console.error("Consultation deduplication check failed.");
    return jsonResponse(
      {
        ok: false,
        message: "We couldn’t save your request. Please try again shortly.",
      },
      503,
    );
  }

  if (existingRequest) {
    const payloadMatches =
      existingRequest.name === inquiry.name &&
      existingRequest.business_name === inquiry.businessName &&
      existingRequest.email === inquiry.email &&
      (existingRequest.phone || null) === inquiry.phone &&
      existingRequest.message === inquiry.message;

    if (!payloadMatches) {
      return jsonResponse(
        {
          ok: false,
          message: "This form changed after submission. Please refresh and try again.",
        },
        409,
      );
    }

    return jsonResponse({
      ok: true,
      emailSent: existingRequest.confirmation_status === "sent",
    });
  }

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [recentSiteRequests, recentEmailRequests, recentClientRequests] =
    await Promise.all([
      supabase
        .from("consultation_requests")
        .select("id", { count: "exact", head: true })
        .gte("created_at", tenMinutesAgo),
      supabase
        .from("consultation_requests")
        .select("id", { count: "exact", head: true })
        .eq("email", inquiry.email)
        .gte("created_at", oneHourAgo),
      supabase
        .from("consultation_requests")
        .select("id", { count: "exact", head: true })
        .eq("request_fingerprint", inquiry.requestFingerprint)
        .gte("created_at", oneHourAgo),
    ]);

  if (
    recentSiteRequests.error ||
    recentEmailRequests.error ||
    recentClientRequests.error
  ) {
    console.error("Consultation rate-limit check failed.");
    return jsonResponse(
      {
        ok: false,
        message: "We couldn’t save your request. Please try again shortly.",
      },
      503,
    );
  }

  if (
    (recentSiteRequests.count || 0) >= 20 ||
    (recentEmailRequests.count || 0) >= 3 ||
    (recentClientRequests.count || 0) >= 5
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "We’ve received several requests recently. Please wait a little before trying again.",
      },
      429,
    );
  }

  const { data: savedRequest, error: insertError } = await supabase
    .from("consultation_requests")
    .insert({
      submission_id: inquiry.submissionId,
      name: inquiry.name,
      business_name: inquiry.businessName,
      email: inquiry.email,
      phone: inquiry.phone,
      message: inquiry.message,
      request_fingerprint: inquiry.requestFingerprint,
      source: "website",
      consent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !savedRequest) {
    if (insertError?.code === "23505") {
      const { data: duplicateRequest } = await supabase
        .from("consultation_requests")
        .select("confirmation_status")
        .eq("submission_id", inquiry.submissionId)
        .maybeSingle();

      return jsonResponse({
        ok: true,
        emailSent: duplicateRequest?.confirmation_status === "sent",
      });
    }

    console.error("Consultation request insert failed.");
    return jsonResponse(
      {
        ok: false,
        message: "We couldn’t save your request. Please try again shortly.",
      },
      503,
    );
  }

  const smtpHost = process.env.SMTP_HOST || "smtp.hostinger.com";
  const smtpPort = Number(process.env.SMTP_PORT || "465");
  const smtpSecure =
    process.env.SMTP_SECURE === undefined
      ? smtpPort === 465
      : process.env.SMTP_SECURE === "true";
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const ownerEmail = process.env.CONTACT_TO_EMAIL || smtpUser;
  const fromName = process.env.SMTP_FROM_NAME || "EZPZTEK";

  if (!smtpUser || !smtpPass || !ownerEmail) {
    await supabase
      .from("consultation_requests")
      .update({
        confirmation_status: "failed",
        owner_notification_status: "failed",
        email_attempts: 1,
        last_email_error_code: "SMTP_NOT_CONFIGURED",
      })
      .eq("id", savedRequest.id);

    console.error("Consultation API is missing its SMTP server configuration.");
    return jsonResponse(
      { ok: true, emailSent: false },
      201,
    );
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: { user: smtpUser, pass: smtpPass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  const safeName = escapeHtml(inquiry.name);
  const safeBusiness = escapeHtml(inquiry.businessName);
  const safeEmail = escapeHtml(inquiry.email);
  const safePhone = escapeHtml(inquiry.phone || "Not provided");
  const safeMessage = escapeHtml(inquiry.message).replace(/\n/g, "<br />");

  const ownerNotification = transporter.sendMail({
    from: { name: fromName, address: smtpUser },
    to: ownerEmail,
    replyTo: inquiry.email,
    subject: `New consultation request — ${safeHeader(inquiry.businessName)}`,
    text: [
      "New EZPZTEK consultation request",
      "",
      `Name: ${inquiry.name}`,
      `Business: ${inquiry.businessName}`,
      `Email: ${inquiry.email}`,
      `Phone: ${inquiry.phone || "Not provided"}`,
      "",
      "Current challenge:",
      inquiry.message,
      "",
      `Inquiry ID: ${savedRequest.id}`,
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#171714;max-width:640px;margin:auto">
        <div style="background:#f54d3f;color:#fff;padding:22px 26px;border-radius:16px 16px 0 0">
          <strong style="font-size:20px">New EZPZTEK consultation request</strong>
        </div>
        <div style="padding:26px;border:1px solid #e2ddd4;border-top:0;border-radius:0 0 16px 16px">
          <p><strong>Name:</strong> ${safeName}</p>
          <p><strong>Business:</strong> ${safeBusiness}</p>
          <p><strong>Email:</strong> ${safeEmail}</p>
          <p><strong>Phone:</strong> ${safePhone}</p>
          <p><strong>Current challenge:</strong><br />${safeMessage}</p>
          <p style="color:#746e64;font-size:12px">Inquiry ID: ${savedRequest.id}</p>
        </div>
      </div>
    `,
  });

  const visitorConfirmation = transporter.sendMail({
    from: { name: fromName, address: smtpUser },
    to: inquiry.email,
    replyTo: ownerEmail,
    subject: "Thank you for contacting EZPZTEK",
    text: [
      `Hi ${inquiry.name},`,
      "",
      "Thank you for choosing EZPZTEK. Your request is safely recorded and we’ll contact you within 24–48 hours.",
      "",
      "You may reply to this email if you need to add anything.",
      "",
      "EZPZTEK",
      "Practical software for growing Filipino businesses",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.7;color:#171714;max-width:640px;margin:auto">
        <div style="padding:30px;background:#f4efe6;border-radius:18px">
          <p style="margin:0 0 12px;color:#dc3b30;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">EZPZTEK consultation</p>
          <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:34px;line-height:1.1">Thank you for choosing EZPZTEK.</h1>
          <p>Hi ${safeName},</p>
          <p>Your request is safely recorded and we’ll contact you within <strong>24–48 hours</strong>.</p>
          <p>You may reply to this email if you need to add anything.</p>
          <p style="margin-bottom:0"><strong>EZPZTEK</strong><br /><span style="color:#655f56">Practical software for growing Filipino businesses</span></p>
        </div>
      </div>
    `,
  });

  const [ownerResult, visitorResult] = await Promise.allSettled([
    ownerNotification,
    visitorConfirmation,
  ]);

  const ownerSent = ownerResult.status === "fulfilled";
  const confirmationSent = visitorResult.status === "fulfilled";
  const sentAt = new Date().toISOString();

  const { error: statusUpdateError } = await supabase
    .from("consultation_requests")
    .update({
      owner_notification_status: ownerSent ? "sent" : "failed",
      owner_notification_sent_at: ownerSent ? sentAt : null,
      confirmation_status: confirmationSent ? "sent" : "failed",
      confirmation_sent_at: confirmationSent ? sentAt : null,
      email_attempts: 1,
      last_email_error_code:
        ownerSent && confirmationSent ? null : "SMTP_SEND_FAILED",
    })
    .eq("id", savedRequest.id);

  if (statusUpdateError) {
    console.error("Consultation email status update failed.");
  }

  return jsonResponse(
    { ok: true, emailSent: confirmationSent },
    201,
  );
}
