import Image from "next/image";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/admin/forgot-password-form";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="admin-auth-page">
      <section className="admin-auth-card">
        <Link className="admin-login-brand dark" href="/">
          <span><Image src="/ezpztek-logo.png" alt="EZPZTEK" width={42} height={42} /></span>
          EZPZTEK
        </Link>
        <p className="admin-eyebrow">Account recovery</p>
        <h1>Reset your password.</h1>
        <p>We’ll send a new single-use recovery link to the authorized administrator email.</p>
        {params.error === "expired" && (
          <p className="admin-form-error">That recovery link is invalid, expired, or already used. Request a fresh one below.</p>
        )}
        <ForgotPasswordForm />
        <Link className="admin-back-link" href="/admin/login">← Back to sign in</Link>
      </section>
    </main>
  );
}
