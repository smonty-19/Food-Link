import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

// Fallback for SF Pro on non-Apple devices (see --font-sans in globals.css)
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "FoodLink", template: "%s · FoodLink" },
  description: "Surplus food from Bengaluru's kitchens, matched to the people who need it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <footer className="t-caption mx-auto w-full max-w-[1024px] border-t border-line px-5 py-5 text-muted">
          FoodLink · PES University DBMS project · Group 19
        </footer>
      </body>
    </html>
  );
}
