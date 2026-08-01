import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { Nav } from "@/components/Nav";

const TITLE = "Open Communication — uncensored AI, private messaging, provable maths";
const DESCRIPTION =
  "Uncensored AI inference, end-to-end encrypted messaging, and formally verified mathematics on contributed GPUs. Lean 4 proofs via Harmonic Aristotle, signed with ed25519 and settled on Solana. Owned by no one.";

export const metadata: Metadata = {
  metadataBase: new URL("https://opencommunication.app"),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "decentralized AI",
    "uncensored inference",
    "end-to-end encrypted messaging",
    "formally verified mathematics",
    "Lean 4",
    "Harmonic Aristotle",
    "machine-checked proof",
    "ed25519 attestation",
    "X25519",
    "XChaCha20-Poly1305",
    "Solana",
    "contributed GPUs",
    "OpenAI-compatible API",
  ],
  openGraph: {
    type: "website",
    siteName: "Open Communication",
    title: TITLE,
    description: DESCRIPTION,
    url: "https://opencommunication.app",
  },
  twitter: { card: "summary_large_image", site: "@O_C_", title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Scroll-reveal starts content at opacity 0 and JavaScript adds `is-in`.
          Without scripts that class never arrives, so neutralise the animation
          entirely rather than serve a blank page.
        */}
        <noscript>
          {/* eslint-disable-next-line react/no-danger */}
          <style
            dangerouslySetInnerHTML={{
              __html: ".reveal{opacity:1!important;transform:none!important}",
            }}
          />
        </noscript>
      </head>
      <body className="min-h-screen">
        <AuthProvider>
          <Nav />
          <main className="mx-auto max-w-6xl px-4">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
