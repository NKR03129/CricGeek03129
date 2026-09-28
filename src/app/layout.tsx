import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import Providers from "@/app/providers";

export const metadata: Metadata = {
  title: "CricGeek - Live Cricket Scores, Analysis & Community",
  description:
    "Your ultimate cricket companion. Live match scores, ball-by-ball commentary, expert analysis, and community-driven cricket discussion.",
  keywords: ["cricket", "live scores", "IPL", "World Cup", "cricket analysis"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-cg-dark text-white min-h-screen antialiased">
        <Providers>
          <Navbar />
          <main className="min-h-[calc(100vh-64px)]">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
