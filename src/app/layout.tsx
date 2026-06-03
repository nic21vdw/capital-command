import type { Metadata } from "next";
import { Toaster } from "sonner";
import { AppProvider } from "@/components/providers/app-provider";
import { AccentThemeProvider, AccentThemeScript } from "@/components/providers/accent-theme-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Capital Command",
  description: "A personal investment dashboard for tracking holdings, goals, and research."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <AccentThemeScript />
      </head>
      <body>
        <ThemeProvider>
          <AccentThemeProvider>
            <AppProvider>
              {children}
              <Toaster richColors position="top-right" />
            </AppProvider>
          </AccentThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
