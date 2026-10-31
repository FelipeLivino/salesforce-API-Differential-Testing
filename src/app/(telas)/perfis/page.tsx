import type { Metadata } from "next";
import { TelaPerfis } from "@/components/tela-perfis";

export const metadata: Metadata = { title: "Perfis | Testes diferenciais" };

export default function Pagina() {
  return <TelaPerfis />;
}
