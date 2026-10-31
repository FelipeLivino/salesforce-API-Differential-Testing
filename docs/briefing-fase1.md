# Briefing da Fase 1

## Produto

Ferramenta local de testes diferenciais de APIs Salesforce. Ela executa a mesma chamada com o usuário de integração e com usuários da comunidade, e aponta falhas e diferenças. Esta fase entrega apenas a fundação e o login, sem chamadas de negócio além de um teste de token.

## Stack

- Next.js com TypeScript e Route Handlers
- SQLite
- Docker Compose com um único serviço, publicado em `127.0.0.1`
- Sem Redis, filas, PostgreSQL, RBAC ou login na própria ferramenta

## Decisões

- Comunidade usa sempre Headless Login (Authorization Code and Credentials, com PKCE). O OAuth antigo da comunidade está fora do escopo.
- Usuário de integração usa OAuth Username-Password, com URL do ambiente, login e senha.
- Login é um adaptador por tipo, para permitir novos fluxos sem alterar o restante.
- Perfis ficam no banco, sem nome, enum ou quantidade fixa no código. Os testes iniciais usarão 5 perfis, apenas como cadastros.
- Perfil com histórico é arquivado, e não excluído.

## Entidades da fase

- **Ambiente:** URL, tipo (sandbox ou produção) e app OAuth (Client ID, Client Secret opcional e redirect URI)
- **Perfil:** nome, descrição, tipo de login e situação
- **Contexto:** ambiente, perfil, URL, login, senha e security token opcional. A URL é a do site para comunidade e a do ambiente para integração.
- **Segredos:** senha, Client Secret e security token são criptografados.

## Entregas

- Projeto com Docker Compose
- Cadastro de ambientes, apps, perfis e contextos
- Senhas com AES-GCM, usando chave no `.env`
- Adaptadores Headless e Username-Password
- Botão Testar login, mostrando o erro real do Salesforce
- Tokens só em memória, reaproveitados até expirar

## Regras

- Senhas e tokens nunca aparecem em logs, respostas de API ou relatórios.
- Testes automatizados não chamam o Salesforce real: use um servidor falso.
- Nenhum agente usa credenciais reais nem acessa org real.
- Nenhum agente faz commit.

- Se uma fonte ou site bloquear o acesso, registre a limitação. Não contorne bloqueios.

## Fluxos de login

- Siga `docs/fluxos-login.md`. O que estiver marcado como não confirmado continua sendo hipótese, inclusive os erros simulados pelo servidor falso.
- O app OAuth é genérico: não presuma Connected App, porque External Client App também precisa funcionar.
- Sem `expires_in` confiável, o token é reaproveitado até receber 401, com um único novo login em seguida.
- O fluxo Username-Password tem aposentadoria anunciada para 20/02/2027. Nada fora do adaptador pode depender dele.

## Limite conhecido

O login real na sandbox da Honda depende de credenciais e não pode ser verificado nesta etapa.
