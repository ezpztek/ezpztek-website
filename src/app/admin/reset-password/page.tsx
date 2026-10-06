import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UpdatePasswordForm } from "@/components/admin/update-password-form";
import { getAdminSession } from "@/lib/admin-auth";

export default async function ResetPasswordPage() {
  const admin = await getAdminSession();
  if (!admin) redirect("/admin/forgot-password?error=expired");

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-card">
        <Link className="admin-login-brand dark" href="/">
          <span><Image src="/ezpztek-logo.png" alt="EZPZTEK" width={42} height={42} /></span>
          EZPZTEK
        </Link>
        <p className="admin-eyebrow">Secure recovery</p>
        <h1>Choose a new password.</h1>
        <p>Signed in as <strong>{admin.email}</strong>. Your new password will take effect immediately.</p>
        <UpdatePasswordForm />
      </section>
    </main>
  );
}

