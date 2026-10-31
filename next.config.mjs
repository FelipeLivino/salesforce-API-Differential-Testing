/** @type {import("next").NextConfig} */
const nextConfig = {
  // Módulo nativo: precisa ser carregado pelo Node, nunca empacotado.
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  // Sem isso, o `next dev` cria AGENTS.md na raiz ao detectar um agente de IA.
  agentRules: false,
};

export default nextConfig;
