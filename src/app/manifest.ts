import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "1Pass Vault",
    short_name: "1Pass",
    description: "Securely manage passwords, cards, and identities in a private vault.",
    start_url: "/",
    id: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F9FAFB",
    theme_color: "#1F2937",
    lang: "en",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
        purpose: "any"
      }
    ],
    shortcuts: [
      {
        name: "Unlock vault",
        short_name: "Unlock",
        description: "Unlock your vault to access saved entries.",
        url: "/"
      }
    ]
  }
}
