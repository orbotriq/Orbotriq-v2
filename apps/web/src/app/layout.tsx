import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "Orbotriq — Digital Growth Platform", template: "%s | Orbotriq" },
  description: "Manage SEO, AI search visibility, social media, advertising and client growth in one platform.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
