import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BiteRight",
  description: "Know what's safe to eat — instantly.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50 text-gray-900">
        {children}
      </body>
    </html>
  );
}
