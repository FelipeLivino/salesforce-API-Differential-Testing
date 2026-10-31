import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AvisoChave } from "@/components/aviso-chave";
import { Navegacao } from "@/components/navegacao";
import "./globals.css";

export const metadata: Metadata = {
  title: "Testes diferenciais de APIs Salesforce",
  description: "Ferramenta local de testes diferenciais de APIs Salesforce.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Navegacao />
        <AvisoChave />
        {children}
      </body>
    </html>
  );
}
