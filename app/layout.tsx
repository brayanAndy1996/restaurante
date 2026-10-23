import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Restaurante | Diagnóstico técnico",
  description: "Diagnóstico local del servicio Restaurante.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
