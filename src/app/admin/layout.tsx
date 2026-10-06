import type { Metadata } from "next";
import "./admin.css";

export const metadata: Metadata = {
  title: "Admin workspace",
  description: "EZPZTEK internal operations workspace.",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return <div className="admin-root">{children}</div>;
}

