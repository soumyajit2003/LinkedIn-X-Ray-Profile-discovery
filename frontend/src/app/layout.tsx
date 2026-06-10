import type { Metadata } from "next";
import "./globals.css";
import ThemeInit from "@/components/ThemeInit";

export const metadata: Metadata = {
  title: "LinkedIn Profile Discovery",
  description: "Profile discovery and connection management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-slate-50 dark:bg-neutral-900 text-slate-900 dark:text-neutral-100 antialiased">
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
