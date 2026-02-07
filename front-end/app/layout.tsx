import type { Metadata } from "next";
import { Geist, Source_Code_Pro } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const sourceCodePro = Source_Code_Pro({
  variable: "--font-source-code-pro",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sanos",
  description: "Your Autonomous DevOps",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${sourceCodePro.variable}`}>
      <body className="antialiased font-sans">
        {children}
      </body>
    </html>
  );
}