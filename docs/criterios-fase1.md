# Critérios de aceite da Fase 1

Base: `docs/briefing-fase1.md`.

## Como ler

- **F (sem org real):** verificável por agentes, com testes automatizados ou execução local. Toda chamada ao Salesforce vai para o servidor falso.
- **R (org real):** só uma pessoa autorizada verifica, com credenciais reais, fora do trabalho dos agentes. Estes critérios ficam em aberto nesta etapa e não bloqueiam a validação dos critérios F.
- Nos testes, senhas e tokens usam valores-sentinela fictícios e fáceis de buscar, como `SENTINELA-SENHA-123`.
- **[P#]** indica que o critério depende de uma pendência listada no fim do documento.

## E1. Projeto com Docker Compose

### F (sem org real)

- **F1.1** Com um `.env` criado a partir do `.env.example`, `docker compose up` sobe um único serviço e a tela inicial abre em `http://127.0.0.1:<porta>`.
- **F1.2** `docker compose config` mostra a porta publicada em `127.0.0.1`. A ferramenta não responde pelo IP da máquina na rede.
- **F1.3** Os dados cadastrados continuam disponíveis depois de `docker compose down` e de um novo `up`.
- **F1.4** O projeto não tem Redis, filas, PostgreSQL, RBAC nem tela de login da própria ferramenta.
- **F1.5** O `.env` real não é versionado, e o `.env.example` não contém valores reais.

### R (org real)

Nenhum.

## E2. Cadastro de ambientes, apps, perfis e contextos

### F (sem org real)

- **F2.1** É possível criar, listar e editar um ambiente com URL, tipo (sandbox ou produção) e app OAuth.
- **F2.2** O ambiente é salvo com ou sem Client Secret, e o Client ID é obrigatório.
- **F2.3** Um tipo de ambiente diferente de sandbox ou produção é recusado com mensagem de erro.
- **F2.4** É possível criar, listar e editar um perfil com nome, descrição, tipo de login e situação.
- **F2.5** Uma base nova começa sem perfis. Os 5 perfis dos testes entram apenas como cadastros, e um 6º pode ser criado sem alterar o código.
- **F2.6** Um nome de perfil criado nos testes não aparece em nenhum arquivo de código da aplicação, e o tipo de perfil não é um enum fixo.
- **F2.7** Um perfil com histórico não pode ser excluído: ele pode ser arquivado e continua existindo com a situação de arquivado. [P3]
- **F2.8** Um perfil sem histórico pode ser excluído. [P3]
- **F2.9** É possível criar, listar e editar um contexto com perfil, URL, login, senha e security token opcional. [P1]
- **F2.10** Um cadastro com campo obrigatório vazio é recusado, e a mensagem indica o campo.
- **F2.11** Editar um contexto sem informar nova senha mantém a senha atual, e o login continua funcionando no servidor falso.

### R (org real)

Nenhum.

## E3. Senhas com AES-GCM e chave no `.env`

### F (sem org real)

- **F3.1** Depois de salvar um contexto, a senha-sentinela não é encontrada em texto puro em nenhum arquivo do SQLite.
- **F3.2** Salvar a mesma senha duas vezes gera valores cifrados diferentes.
- **F3.3** A senha salva é decifrada corretamente e chega idêntica ao servidor falso.
- **F3.4** Um valor cifrado adulterado no banco faz o teste de login falhar com erro claro, sem chamada ao servidor falso.
- **F3.5** Com uma chave diferente no `.env`, ocorre o mesmo: erro claro, sem chamada e sem expor a senha ou a chave.
- **F3.6** Sem chave no `.env`, ou com chave inválida, a ferramenta avisa o motivo e não grava senha sem criptografia.
- **F3.7** A chave não aparece em logs, respostas de API, código versionado ou banco.

### R (org real)

Nenhum.

## E4. Adaptadores Headless e Username-Password

### F (sem org real)

- **F4.1** Um perfil do tipo Headless autentica no servidor falso pelo fluxo Authorization Code and Credentials.
- **F4.2** O servidor falso valida o PKCE e rejeita uma troca de código com verificador incorreto. Nesse caso, a ferramenta não mostra sucesso.
- **F4.3** Cada tentativa Headless usa um verificador PKCE novo.
- **F4.4** Um perfil Username-Password autentica no servidor falso com URL do ambiente, login, senha e app OAuth. [P1]
- **F4.5** O security token, quando cadastrado, chega ao servidor falso. Sem ele, o login também funciona. [P4]
- **F4.6** Um perfil de comunidade nunca aciona o OAuth antigo da comunidade: o servidor falso registra apenas chamadas do fluxo Headless.
- **F4.7** Um terceiro adaptador, criado só no teste, funciona com o registro do novo tipo, sem alteração em cadastros, tela de teste ou cache de tokens.
- **F4.8** Um tipo de login sem adaptador registrado gera erro claro, sem chamada ao servidor falso.

### R (org real)

- **R4.1** O adaptador Username-Password obtém token na sandbox da Honda com um usuário de integração.
- **R4.2** O adaptador Headless obtém token na sandbox da Honda com um usuário da comunidade.
- **R4.3** O formato real das chamadas e respostas é aceito pelo Salesforce e equivale ao simulado pelo servidor falso. Toda divergência é registrada, e o servidor falso é corrigido.
- **R4.4** Org e app da sandbox estão configurados para os dois fluxos. Bloqueio de configuração é registrado como pendência de ambiente, não como defeito da ferramenta. [P6]

## E5. Botão Testar login

### F (sem org real)

- **F5.1** Com login aceito pelo servidor falso, a tela mostra sucesso para o contexto testado, sem mostrar o token.
- **F5.2** Com login recusado, a tela mostra literalmente o `error` e o `error_description` devolvidos pelo servidor falso, usando textos arbitrários para provar que não há mensagem pronta no lugar.
- **F5.3** Servidor falso desligado ou sem resposta gera um erro de conexão, distinto de um erro do Salesforce.
- **F5.4** Resposta malformada do servidor falso gera erro claro, sem queda da aplicação e sem indicar sucesso.
- **F5.5** Durante o teste, o botão indica andamento. Ao final, a tela volta a aceitar nova tentativa.
- **F5.6** Além das chamadas de login e do teste de token, nenhuma chamada de negócio chega ao servidor falso.

### R (org real)

- **R5.1** Com senha propositalmente incorreta na sandbox, a tela mostra o erro real retornado pelo Salesforce.
- **R5.2** Com credenciais válidas, a tela mostra sucesso nos dois tipos de login.
- **R5.3** Os erros reais observados são legíveis e não foram alterados pela ferramenta.

## E6. Tokens só em memória, reaproveitados até expirar

### F (sem org real)

- **F6.1** Com token válido, chamadas seguidas de `login-service.getToken` e `callWithToken` no mesmo contexto reaproveitam o token e geram uma única autenticação no servidor falso. Testar login é a exceção: cada clique autentica de novo (decisões 6 e C15).
- **F6.2** Contextos diferentes não compartilham token.
- **F6.3** Depois da expiração simulada, o próximo teste autentica de novo e usa o token novo. [P2]
- **F6.4** O token-sentinela não é encontrado em nenhum arquivo do SQLite nem em outro arquivo gravado pela aplicação.
- **F6.5** Depois de reiniciar o serviço, o próximo teste autentica de novo.
- **F6.6** Depois de alterar a senha ou o login do contexto, o token anterior não é reaproveitado. [P5]

### R (org real)

- **R6.1** O reaproveitamento funciona na sandbox: chamadas seguidas de `login-service.getToken` e `callWithToken` no mesmo contexto geram um único login no histórico de logins do usuário. Testar login é a exceção: cada clique gera um novo login (decisões 6 e C15).
- **R6.2** Um token expirado ou revogado na sandbox é detectado, e um novo login é feito. [P2]

## Critérios transversais de segurança

### F (sem org real)

- **FT.1** Depois de executar sucesso e falha nos dois adaptadores, nenhum valor-sentinela de senha, security token, access token, código de autorização ou verificador PKCE aparece nos logs da aplicação e do container.
- **FT.2** Nenhuma resposta de API e nenhuma tela contém esses valores, mesmo em erros ou em leituras de contexto. Escopo: valores conhecidos na tentativa atual, nas grafias pura, URL, formulário, JSON (`\/`, `\"`, `\uXXXX` de não ASCII) e HTML (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&#34;`), e campos com nome padronizado ou `accessToken`, `refreshToken`, `clientSecret` e `codeVerifier`. Fora do escopo, como risco aceito R2 (`decisoes.md`): valores de tentativas anteriores, base64, hex, troca de caixa, entidades numéricas completas e demais nomes não padronizados.
- **FT.3** Se o servidor falso devolver um valor-sentinela dentro da mensagem de erro, esse valor é mascarado antes de chegar à tela e aos logs, e o restante do erro é preservado. Vale para segredos conhecidos e para resposta de sucesso, no escopo de FT.2. Um valor que aparece só em resposta de erro é mascarado apenas no próprio campo, e o erro legível tem prioridade sobre mascarar palavras comuns (S12 a S17).
- **FT.4** A suíte de testes completa roda sem acesso à internet, e nenhuma URL `salesforce.com` ou `force.com` real é chamada.
- **FT.5** O repositório não contém credenciais reais.

### R (org real)

- **RT.1** Depois da execução de R4 a R6, a busca pelas credenciais reais de teste nos logs e no banco não encontra nenhum valor em texto puro.

## Fora do escopo da fase

- Chamadas de negócio e comparação de respostas entre usuários (a execução diferencial em si).
- Relatórios. A regra de não expor segredos passa a valer para eles quando existirem.
- OAuth antigo da comunidade.
- Login na própria ferramenta, RBAC, Redis, filas e PostgreSQL.
- Implantação fora de `127.0.0.1`.
- Execução de qualquer critério R por agentes.

## Pendências

| ID | Pendência | Confirmar com |
| --- | --- | --- |
| P1 | O contexto não tem ligação com o ambiente no briefing, mas o login precisa do app OAuth. Além disso, a URL aparece no ambiente e no contexto: qual delas vale para cada tipo de login? | Arquiteto e especialista Salesforce |
| P2 | Como detectar a expiração se a resposta do Salesforce não informar validade? Hipóteses: rejeição do token no teste, ou tempo configurado. O critério F6.3 só pode ser fechado depois dessa decisão. | Especialista Salesforce |
| P3 | O que conta como "histórico" nesta fase, se ainda não há execuções diferenciais? Contextos e testes de login contam? Um perfil arquivado pode ser reativado, testado ou receber novos contextos? | Responsável pelo produto |
| P4 | O security token e o Client Secret devem ser cifrados como a senha? O briefing só cita a senha. Sugestão: tratar ambos como segredo, o que também os inclui em F3 e FT. | Segurança |
| P5 | Editar o ambiente ou o app OAuth também deve invalidar os tokens em cache dos contextos relacionados? | Arquiteto |
| P6 | A sandbox da Honda tem o fluxo Username-Password e o Headless habilitados? Quem fornece as credenciais e executa os critérios R, e quando? | Responsável pelo ambiente na Honda |
| P7 | O teste de login é permitido em ambiente do tipo produção, ou deve ter alguma restrição? O briefing só define o tipo. | Responsável pelo produto |
