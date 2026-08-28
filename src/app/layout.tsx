import type { Metadata } from "next";
import { Toaster } from "sonner";
import { AppProvider } from "@/components/providers/app-provider";
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
