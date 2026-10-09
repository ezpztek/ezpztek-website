import "server-only";

import nodemailer from "nodemailer";

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

function getMailConfiguration() {
  const host = process.env.SMTP_HOST || "smtp.hostinger.com";
  const port = Number(process.env.SMTP_PORT || "465");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const replyTo = process.env.CONTACT_TO_EMAIL || user;

  if (!user || !pass || !replyTo) return null;

  return {
    host,
    port,
    secure:
      process.env.SMTP_SECURE === undefined
        ? port === 465
        : process.env.SMTP_SECURE === "true",
    user,
    pass,
    replyTo,
    fromName: process.env.SMTP_FROM_NAME || "EZPZTEK",
  };
}

function createTransport() {
  const config = getMailConfiguration();
  if (!config) return null;

  return {
    config,
    transporter: nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    }),
  };
}

export function getPublicSiteUrl() {
  if (process.env.SITE_URL) return new URL(process.env.SITE_URL).origin;
  if (process.env.NODE_ENV === "development") return "http://localhost:3000";
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  throw new Error("SITE_URL_NOT_CONFIGURED");
}

export async function sendClientInvitationEmail({
  email,
  name,
  businessName,
  invitationUrl,
}: {
  email: string;
  name: string;
  businessName: string;
  invitationUrl: string;
}) {
  const mail = createTransport();
  if (!mail) throw new Error("SMTP_NOT_CONFIGURED");

  const safeName = escapeHtml(name);
  const safeBusiness = escapeHtml(businessName);
  const safeUrl = escapeHtml(invitationUrl);

  await mail.transporter.sendMail({
    from: { name: mail.config.fromName, address: mail.config.user },
    to: email,
    replyTo: mail.config.replyTo,
    subject: `Create your EZPZTEK access — ${safeHeader(businessName)}`,
    text: [
      `Hi ${name},`,
      "",
      `EZPZTEK has invited ${businessName} to create a secure client account.`,
      "",
      `Create your credentials: ${invitationUrl}`,
      "",
      "This private link expires in 7 days and can be used once. After registration, your selected demo modules will be reviewed and approved by the EZPZTEK admin.",
      "",
      "EZPZTEK",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.65;color:#171714;max-width:640px;margin:auto">
        <div style="padding:34px;background:#f4efe6;border-radius:18px">
          <p style="margin:0 0 12px;color:#dc3b30;font-size:12px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase">Private client invitation</p>
          <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:34px;line-height:1.08">Your EZPZTEK workspace starts here.</h1>
          <p>Hi ${safeName},</p>
          <p>We’ve invited <strong>${safeBusiness}</strong> to create a secure client account.</p>
          <p style="margin:26px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;border-radius:10px;color:#fff;background:#171714;text-decoration:none;font-weight:800">Create my credentials</a></p>
          <p style="color:#6d675f;font-size:13px">This private link expires in 7 days and can be used once. After registration, EZPZTEK will review and approve your selected free-demo modules.</p>
          <p style="margin-bottom:0"><strong>EZPZTEK</strong><br><span style="color:#6d675f">Practical software for growing businesses</span></p>
        </div>
      </div>
    `,
  });
}

export async function sendClientApprovalEmail({
  email,
  name,
  businessName,
  moduleNames,
  loginUrl,
}: {
  email: string;
  name: string;
  businessName: string;
  moduleNames: string[];
  loginUrl: string;
}) {
  const mail = createTransport();
  if (!mail) throw new Error("SMTP_NOT_CONFIGURED");

  const safeName = escapeHtml(name);
  const safeBusiness = escapeHtml(businessName);
  const safeUrl = escapeHtml(loginUrl);
  const safeModules = moduleNames.map(escapeHtml);

  await mail.transporter.sendMail({
    from: { name: mail.config.fromName, address: mail.config.user },
    to: email,
    replyTo: mail.config.replyTo,
    subject: "Congratulations — your EZPZTEK free demo is approved",
    text: [
      `Hi ${name},`,
      "",
      `Congratulations! The EZPZTEK free demo for ${businessName} is approved.`,
      "",
      "Your available modules:",
      ...moduleNames.map((moduleName) => `- ${moduleName}`),
      "",
      `Sign in: ${loginUrl}`,
      "",
      "Thank you for choosing EZPZTEK.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.65;color:#171714;max-width:640px;margin:auto">
        <div style="padding:34px;background:#171714;color:#fff;border-radius:18px">
          <p style="margin:0 0 12px;color:#ff776c;font-size:12px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase">Demo approved</p>
          <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:34px;line-height:1.08">Congratulations, ${safeName}.</h1>
          <p>The EZPZTEK free demo for <strong>${safeBusiness}</strong> is ready.</p>
          <div style="margin:22px 0;padding:18px;border:1px solid #3d3b36;border-radius:12px;background:#22221f">
            <strong>Your available modules</strong>
            <ul style="margin-bottom:0;color:#d8d4cc">${safeModules.map((moduleName) => `<li>${moduleName}</li>`).join("")}</ul>
          </div>
          <p style="margin:26px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;border-radius:10px;color:#171714;background:#f45143;text-decoration:none;font-weight:800">Open my workspace</a></p>
          <p style="margin-bottom:0;color:#aaa69f">Thank you for choosing EZPZTEK.</p>
        </div>
      </div>
    `,
  });
}
