import type { Metadata } from "next";
import { Toaster } from "sonner";
import { AppProvider } from "@/components/providers/app-provider";
import { ThemePresetProvider, ThemePresetScript } from "@/components/providers/theme-preset-provider";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Nic Vandewetering",
  description: "A personal investment dashboard for tracking holdings, goals, and research."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemePresetScript />
      </head>
      <body>
        <ThemePresetProvider>
          <AppProvider>
            {children}
            <Toaster richColors position="top-right" />
          </AppProvider>
        </ThemePresetProvider>
      </body>
    </html>
  );
}
