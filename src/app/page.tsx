import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>Testes diferenciais de APIs Salesforce</h1>
      <p>Ferramenta local. Cadastre, nesta ordem, o que é preciso para testar o login de cada usuário.</p>
      <ol className="passos">
        <li>
          <Link href="/ambientes">Ambientes</Link>: URL, tipo e app OAuth.
        </li>
        <li>
          <Link href="/perfis">Perfis</Link>: nome, descrição, tipo de login e situação.
        </li>
        <li>
          <Link href="/contextos">Contextos</Link>: ambiente, perfil e credenciais, com o botão Testar login.
        </li>
      </ol>
    </main>
  );
}
