import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-cormorant",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Phronos — Skin in the game. On chain.",
  description: "Copy trading with real accountability. Every trader on Phronos has posted a bond. Miss targets, lose it.",
  openGraph: {
    title: "Phronos — Skin in the game. On chain.",
    description: "Copy trading with real accountability. Every trader on Phronos has posted a bond. Miss targets, lose it.",
    siteName: "Phronos",
  },
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${cormorant.variable}`}>
      <body className="bg-parchment text-ink min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
