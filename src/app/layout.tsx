import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import "./client.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "EZPZTEK | Practical Software for Filipino SMEs",
    template: "%s | EZPZTEK",
  },
  description:
    "EZPZTEK builds practical custom software, workflow automation, and digital systems for growing Filipino businesses.",
  keywords: [
    "custom software Philippines",
    "SME digitalization",
    "inventory system Philippines",
    "business process automation",
    "SaaS Philippines",
  ],
  applicationName: "EZPZTEK",
  creator: "EZPZTEK",
  openGraph: {
    title: "Less paperwork. Better control. | EZPZTEK",
    description:
      "Practical software and digital systems built around how Filipino SMEs actually operate.",
    type: "website",
    siteName: "EZPZTEK",
    locale: "en_PH",
  },
  twitter: {
    card: "summary",
    title: "EZPZTEK | Practical Software for Filipino SMEs",
    description:
      "Replace scattered spreadsheets, paper records, and repetitive work with practical digital systems.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <body>{children}</body>
    </html>
  );
}
