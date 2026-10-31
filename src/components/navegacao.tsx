"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/ambientes", rotulo: "Ambientes" },
  { href: "/perfis", rotulo: "Perfis" },
  { href: "/contextos", rotulo: "Contextos" },
];

export function Navegacao() {
  const caminho = usePathname();
  return (
    <header className="topo">
      <Link href="/" className="marca">
        Testes diferenciais
      </Link>
      <nav aria-label="Principal">
        {LINKS.map(({ href, rotulo }) => (
          <Link key={href} href={href} aria-current={caminho === href ? "page" : undefined}>
            {rotulo}
          </Link>
        ))}
      </nav>
    </header>
  );
}
