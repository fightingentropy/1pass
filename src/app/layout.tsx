import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "1Pass Vault",
  description: "Securely manage passwords, cards, and identities",
  applicationName: "1Pass Vault",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "1Pass Vault",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/1pass-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/1pass-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/1pass-icon-192.png", sizes: "180x180", type: "image/png" },
    ],
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F9FAFB" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased min-h-[100svh] bg-background text-foreground font-sans">
        <div className="relative mx-auto flex min-h-[100svh] w-full max-w-5xl flex-col bg-gradient-to-b from-background via-background/95 to-background px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-[max(env(safe-area-inset-top),2rem)] sm:px-6 sm:pb-20 sm:pt-16">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-48 bg-[radial-gradient(circle_at_top,_rgba(79,70,229,0.18)_0%,_rgba(79,70,229,0)_75%)]" />
          {children}
        </div>
      </body>
    </html>
  )
}
