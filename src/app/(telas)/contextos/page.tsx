import type { Metadata } from "next";
import { TelaContextos } from "@/components/tela-contextos";

export const metadata: Metadata = { title: "Contextos | Testes diferenciais" };

export default function Pagina() {
  return <TelaContextos />;
}
