import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "1Pass Vault",
  description: "Securely manage passwords, cards, and identities",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-background text-foreground font-sans">
        {children}
      </body>
    </html>
  );
}
