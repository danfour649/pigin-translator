import { WebAnalytics } from "@/components/web-analytics";
import type { Metadata } from "next";
import { Fraunces, Noto_Sans } from "next/font/google";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin", "latin-ext"],
  variable: "--font-fraunces",
  display: "swap",
});

const sans = Noto_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-noto",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pigin — English to Naijá and Yorùbá",
  description:
    "Translate English into Nigerian Pidgin (Naijá) and Yorùbá. Type or use the microphone, then hear the result.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <WebAnalytics />
      </body>
    </html>
  );
}
