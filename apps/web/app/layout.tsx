import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Open Communication — decentralized AI & private messaging",
  description:
    "Uncensored AI inference and end-to-end encrypted messaging on contributed GPUs. Owned by no one.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AuthProvider>
          <Nav />
          <main className="mx-auto max-w-6xl px-4">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
