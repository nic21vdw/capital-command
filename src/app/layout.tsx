import type { Metadata } from "next";
import { Toaster } from "sonner";
import { AppProvider } from "@/components/providers/app-provider";
import { ColateralBridgeProvider } from "@/components/providers/colateral-bridge-provider";
import { ThemePresetProvider, ThemePresetScript } from "@/components/providers/theme-preset-provider";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Capital Command",
  description: "The CoLateral command centre for planning, producing and publishing a channel."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/InterVariable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <ThemePresetScript />
      </head>
      <body>
        <ThemePresetProvider>
          {/*
            The canvas bridge sits between the theme and the data: it needs
            `useHostTheme` from above it, and everything below it — the shell,
            the pages, the command bar — reads `useColateralBridge` to know
            whether it is inside a Capital Command Card and how much room it
            has. It renders nothing of its own.
          */}
          <ColateralBridgeProvider>
            <AppProvider>
              {children}
              <Toaster richColors position="top-right" />
            </AppProvider>
          </ColateralBridgeProvider>
        </ThemePresetProvider>
      </body>
    </html>
  );
}
