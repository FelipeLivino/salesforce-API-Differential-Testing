import type { Metadata } from "next";
import { TelaAmbientes } from "@/components/tela-ambientes";

export const metadata: Metadata = { title: "Ambientes | Testes diferenciais" };

export default function Pagina() {
  return <TelaAmbientes />;
}
