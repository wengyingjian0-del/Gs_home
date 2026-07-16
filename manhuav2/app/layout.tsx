import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "漫小星 · 儿童漫画创作工坊",
  description: "用自然的方式，慢慢描绘属于你的漫画世界。",
  applicationName: "漫小星",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#4A7C59",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <link 
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=Ma+Shan+Zheng&display=swap" 
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
