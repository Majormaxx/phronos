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
  title: "PHRONOS",
  description: "A council of strategies allocates your USDC on Arc.",
  openGraph: {
    title: "PHRONOS",
    description: "A council of strategies allocates your USDC on Arc.",
    siteName: "Phronos",
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
