# Decisões

Detalhes em [arquitetura.md](arquitetura.md).

| # | Decisão | Motivo |
|---|---|---|
| 1 | Lógica em `src/server`, sem importar Next.js ou React | Executor, comparador e autenticação independem da interface |
| 2 | Login como adaptador registrado por tipo; `tipo_login` é texto validado contra o registro | Novos fluxos sem alterar o restante, e nenhum perfil fixo no código |
| 3 | Falha de login é valor retornado, com os campos do Salesforce sem alteração | Mostrar o erro real |
| 4 | Cache em memória por contexto, com margem de 60s e sem falhas | Tokens nunca persistidos |
| 5 | **Substituída pela decisão 9.** Sem `expires_in`, a expiração é estimada por `SF_TOKEN_TTL_SECONDS` (padrão 900) e marcada como estimada | A resposta OAuth costuma trazer só `issued_at`; a confirmar com o especialista Salesforce |
| 6 | Testar login sempre ignora o cache | O teste precisa validar as credenciais atuais |
| 7 | `better-sqlite3`, sem ORM | Solução mais simples para um único processo |
| 8 | Vitest e servidor falso com `node:http` | Testa o HTTP real sem chamar o Salesforce |
| 9 | Substitui a decisão 5 e o TTL estimado de `arquitetura.md`: sem `expires_in` confiável, o token é reaproveitado até receber 401, com um único novo login e uma única repetição da chamada. `expiresAt` fica `null`, `expiresAtSource` fica `"nao-informado"`, e `SF_TOKEN_TTL_SECONDS` não é lido. A margem de 60s da decisão 4 vale só se `expires_in` vier informado | As respostas documentadas não listam `expires_in` (`fluxos-login.md`, 4.3), e novas tentativas sem limite podem consumir o limite de login. Definido pelo responsável na tarefa T09 |

## Propostas que complementam o briefing (aguardam validação)

| # | Proposta | Motivo |
|---|---|---|
| P1 | `contexto.ambiente_id` | O briefing não liga o contexto ao ambiente, de onde vem o app OAuth |
| P2 | `redirect_uri` no app OAuth do ambiente | O Headless Login precisa dele, e o briefing não o prevê |
| P3 | Cifrar também Client Secret e security token com AES-GCM | São segredos equivalentes à senha, embora o briefing cite só senhas |

## Regras dos cadastros (T07, aguardam validação)

Regras em aberto, resolvidas pela opção mais simples compatível com os critérios.

| # | Decisão | Motivo |
|---|---|---|
| C1 | Conta como histórico (P3 dos critérios) ter contexto vinculado, ativo ou arquivado. Teste de login não conta, pois não é gravado | É o único registro existente nesta fase, e o banco já impede excluir perfil com contexto |
| C2 | `DELETE /api/perfis/{id}` exclui sem contexto e arquiva com contexto. A resposta informa o resultado em `resultado` | Uma única ação para a tela, com o resultado explícito |
| C3 | Perfil arquivado pode ser reativado pela edição da situação, e não recebe contexto novo (409). Seus contextos não são arquivados junto e continuam editáveis | Arquivar é reversível e não altera outros cadastros |
| C4 | Testar login de contexto arquivado, ou de contexto cujo perfil está arquivado, é recusado com 409, sem nenhuma chamada externa. Vale só para o teste: `login-service` não verifica a situação | Definido pelo responsável na tarefa T14. Arquivar deixa claro que o cadastro não está em uso, e a recusa evita consumir o limite de login |
| C5 | Edição por `PATCH`: campo ausente mantém o valor. Em segredo, texto em branco também mantém, e `null` remove se for opcional (senha recusa `null`) | Uma tela pode reenviar o formulário com o campo de senha vazio sem apagar nada |
| C6 | Segredo só com espaços conta como vazio, e os demais são gravados sem `trim`. Os outros textos passam por `trim` | Espaço pode fazer parte de uma senha, mas um valor só de espaços é engano provável |
| C7 | Sem exclusão de ambiente e contexto nesta fase. Contexto é arquivado pela situação | Os critérios F2 pedem só criar, listar e editar. Consequência: perfil que já teve contexto nunca pode ser excluído |
| C8 | URL de ambiente e de contexto é obrigatória e não é derivada uma da outra. Exige `https` (`http` só em loopback) e recusa credenciais, query e fragmento. A barra final é removida | Segue a regra de URLs da arquitetura, e impede que um segredo colado na URL volte nas respostas |
| C9 | `redirect_uri` é opcional no cadastro e mantido como digitado. Client Secret também é opcional para qualquer tipo de login | O ambiente não tem tipo de login. A exigência do Headless fica na hora do login, como erro de configuração. A dispensa do secret no Username-Password não está confirmada (`fluxos-login.md`, item 5 da seção 7) |
| C10 | O tipo de ambiente é gravado como `sandbox` ou `producao`, sem acento | Valores definidos pela migração 001 |
| C11 | Sem chave válida, a gravação de segredo responde 503 com o motivo e nada é gravado. Cadastro ou edição sem segredo novo funciona sem chave | A chave só é necessária para cifrar (F3.6) |
| C12 | Escritas exigem `Content-Type: application/json` (415) | Sem login na ferramenta, isso impede que uma página de outra origem grave cadastros por formulário ou `fetch` simples |
| C13 | Editar contexto invalida o token dele. Editar ambiente ou perfil invalida todos. A chave do cache é `String(contexto.id)` | Segue a arquitetura. O perfil entra porque tipo de login e situação afetam seus contextos (P5 dos critérios) |
| C14 | `tipoLogin` é validado contra `auth/registry` na criação e quando muda na edição (ligado em T14, em `src/server/services/index.ts`). Perfil antigo com tipo sem adaptador gera erro de configuração no login, sem chamada externa (F4.8) | Completa a decisão 2 no cadastro |
| C15 | F6.1 e F6.3 são verificados em `login-service.getToken` e `callWithToken`, e não em Testar login, que autentica de novo a cada clique (decisão 6). Um 401 em `userinfo` durante o teste é o resultado do teste: não há novo login, e o token recusado sai do cache | O texto de F6.1 ("dois testes seguidos... uma única autenticação") contradizia a decisão 6. Decidida pelo responsável na tarefa T15: Testar login continua autenticando de novo, e F6.1 foi reescrito |
| C16 | A rota de Testar login exige `Content-Type: application/json`, como as escritas (C12), e ignora o corpo | Sem isso, uma página de outra origem poderia disparar logins e consumir o limite |

## Segurança (T15)

| # | Decisão | Motivo |
|---|---|---|
| S1 | `src/proxy.ts` responde 403 quando o hostname de `Host`, ou de um `Origin` presente, está fora de `localhost`, `127.0.0.1` e `[::1]`. A porta não é comparada, e `Origin: null` é recusado | Sem login na ferramenta, DNS rebinding daria a uma página externa acesso à API local |
| S2 | Mudou o host (com porta) da URL: a edição do contexto exige a senha, e a do ambiente exige o Client Secret salvo ou sua remoção. Mudar só o caminho não exige | Segunda camada contra A1: o segredo salvo não vai para um host novo sem ser informado de novo. Limite: o login usa a URL do contexto, então o security token do contexto e o Client Secret do ambiente ainda seguem para o host novo quando só a senha é informada |
| S3 | `sfdc_community_url`, no authorize e na resposta de token: mesma origem da URL do contexto, ou `https` em host terminado em `.salesforce.com`, `.force.com` ou `.site.com`. Loopback só se a URL do contexto também for loopback | Esse host recebe `client_secret`, `code` e token. Um domínio próprio de site só é aceito se for a própria URL do contexto |
| S4 | Corpo das respostas limitado a 1 MB, com a conexão abortada ao ultrapassar | A resposta inteira ficaria em memória, sem limite |
| S5 | `redirect_uri` aceita só `https`, ou `http` em loopback. Continua gravada como digitada | Complementa C9. Esquemas próprios de aplicativo, como `myapp://`, também são recusados |
| S6 | **Ampliada por S9.** Vale para a forma com `=`; a forma com dois-pontos segue S14. `code=VALOR` em texto livre é mascarado, exceto número de até 5 dígitos ou identificador com sublinhado, como `invalid_grant` | Mantém legíveis frases como `status code=400` e o erro real do Salesforce. Um código só com esse formato não seria mascarado pelo nome, mas o `code` real da troca continua mascarado por ser segredo conhecido |

## Segurança (T16)

| # | Decisão | Motivo |
|---|---|---|
| S7 | Ponto único de saída: `maskOutput` (`log/redact.ts`) aplica a mesma máscara a `error`, `errorDescription`, `rawBody`, `message` e `instanceUrl`. `salesforceFailure` a usa ao montar a falha, e `login-service` a usa em todo retorno, de falha ou de sucesso, com os segredos conhecidos naquele momento | O QA reprovou FT.2 e FT.3 porque cada caminho mascarava à sua maneira. O serviço cobre também um adaptador que não mascare |
| S8 | **Ajustada por S12.** São segredos conhecidos os valores de campos sensíveis da própria resposta (`secretsInJson`), como `access_token` e `refresh_token`, antes de redigir o restante dela, mesmo em resposta de falha. Em `LoginSuccess`, eles vão em `maskValues`. O token em cache chega ao adaptador por `LoginInput.maskValues` | O servidor pode repetir o token recebido em `error` ou `error_description`. O adaptador trunca `rawBody`, e um segredo cortado no limite não seria mais reconhecido depois |
| S9 | **Ajustada por S12 a S16.** Reconhecimento pelo nome em um único padrão: `code`, `sid`, `signature`, `token`, `access_token`, `refresh_token`, `id_token`, `code_verifier`, `password`, `client_secret` e `security_token`, depois de qualquer caractere não alfanumérico. Vale com `=`, `:`, codificados em URL, JSON ou HTML, entre aspas e em elemento XML. A exceção de S6 vale só para `code`, `sid` e `signature` | A correção por casos deixava de fora cada nova posição. Consequência aceita: uma frase como `token: expirado` também fica `token: ***`, pois não se distingue de um valor real. Limite: valor sem aspas com espaço só é mascarado até o espaço, se não for segredo conhecido |
| S10 | `instance_url` do Username-Password segue a regra de destino de S3, em `tokenDestinationProblem`. Se for inválida, o token não é enviado e o retorno é um erro que cita `instance_url` | O token iria a esse host em `userinfo` e nas chamadas seguintes. Um host de instância fora dos sufixos de S3 fica recusado até haver evidência real (R4.3) |
| S11 | `sfdc_community_url` ou `instance_url` que contenha um segredo conhecido ou um campo sensível é recusada, no authorize e na resposta de token | O valor voltaria aberto em `ok: true`. Mascarar a URL deixaria o token indo a um endereço diferente do exibido |

## Segurança (T17)

| # | Decisão | Motivo |
|---|---|---|
| S12 | Valor de resposta de erro não vira segredo conhecido. HTTP fora de 2xx e redirect com `error`: nenhum valor é promovido, e cada campo sensível é mascarado só no próprio lugar, pela estrutura do JSON ou pelo nome. HTTP 2xx sem `error`: todos os nomes sensíveis, como em S8. HTTP 2xx com `error`, resposta contraditória: só `access_token` e `refresh_token`, e só com aspecto de segredo (S14). `null` e booleanos não são mascarados. O JSON é percorrido e trocado no próprio texto, sem serializar de novo | Promover `"token":"invalid"` escondia `invalid` em todo o erro, e `"token":"e"` gerava `auth***ntication`. Consequência aceita: um `code` ou token presente só em resposta de erro, se repetido em `error_description`, continua visível ali (ver R2). Substitui o caso D2 do `code` repetido no redirect de erro. Definido pelo responsável na tarefa T17 |
| S13 | Em JSON, `code` e `errorCode` ficam legíveis quando parecem código de erro: até 32 caracteres, formados por número de até 5 dígitos, ou por palavras de uma só caixa ou em PascalCase, separadas por `_`, `.` ou `-`, com sufixo numérico opcional de até 6 dígitos. Ex.: `E1001`, `unauthorized`, `INVALID_SESSION_ID`, `ERR-42`. O restante é mascarado. Ex.: `aPrx9Zq2mK`, `a1b2c3d4`, `123456`, valor com mais de 32 caracteres. `errorCode` em texto livre continua fora dos nomes | O código é parte do erro real. Limite: uma palavra só de letras, ou como `abc123`, não se distingue de um código de erro. O `code` real da troca continua mascarado por ser segredo conhecido |
| S14 | Com dois-pontos e nome sem aspas (`token: expired`), o valor só é mascarado se parecer segredo: 16 ou mais caracteres, ou mistura de letras e dígitos, mantida a exceção de S6. A forma com `=` e o elemento XML seguem mascarando como antes. Com nome entre aspas (`"token":"x"`, em JSON truncado ou embutido em texto), vale a regra de JSON | Frases como `access token: expired or revoked` são o erro real. Limite: valor curto só de letras depois de dois-pontos fica visível, e `code: E1001` é mascarado por misturar letras e dígitos |
| S15 | Segredo conhecido com menos de 6 caracteres só é substituído como palavra inteira, sem letra, dígito ou `_` ao lado. A recusa por valor sensível na URL (S11) segue a mesma regra. No campo `message`, texto da própria ferramenta, segredos curtos não são aplicados | Uma senha `p` não pode mutilar `https`, nem uma senha `a` as frases da ferramenta. Limite: segredo curto igual a um rótulo inteiro da URL, como `my`, ainda recusa o destino, e um adaptador que coloque um segredo curto em `message` não terá esse valor mascarado |
| S16 | Segredos conhecidos também são mascarados nas grafias usuais de JSON (`\/`, `\"`, `\uXXXX` de não ASCII) e HTML (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&#34;`). `secretsInJson` percorre objetos e listas sob nomes sensíveis (V3). `accessToken`, `refreshToken`, `clientSecret` e `codeVerifier` entram nos nomes reconhecidos (V9). Host com rótulo vazio, como `https://.salesforce.com`, não atende aos sufixos de S3 | Cobrem as formas que um servidor comum produz sem transformar o valor de propósito. O restante é o risco R2 |
| S17 | O erro legível tem prioridade sobre mascarar palavras comuns: na dúvida entre uma palavra comum e um segredo desconhecido, a palavra fica visível | Mostrar o erro real é o principal valor de Testar login (decisão 3, F5.2). Definido pelo responsável na tarefa T17 |

## Riscos aceitos nesta fase

| # | Risco | Motivo para aceitar agora |
|---|---|---|
| A3 | Uma URL cadastrada pode alcançar um HTTPS interno, como `https://10.0.0.5/app`, e parte da resposta aparece na tela | Definido pelo responsável na tarefa T15. Exige cadastrar a URL na ferramenta local, e a restrição de destino fica para depois |
| R1 | Copiar no banco a senha cifrada de um contexto para outro não é detectado, e a senha do outro usuário é enviada: o AAD cobre só a versão, não a linha ou a coluna | Definido pelo responsável na tarefa T15. Exige escrita direta no banco local |
| R2 | A máscara não cobre: V1 e V2, valores de tentativas anteriores; V4, V5 e V6, segredo em base64, em hex, com troca de caixa ou em entidades numéricas completas; V8 com essas mesmas codificações; demais nomes não padronizados de V9, como `authToken`. Também não cobre um valor presente só em resposta de erro e repetido em outro campo (S12); percent-encoding estrito fora das saídas de `encodeURIComponent` e `URLSearchParams`, como `%2A` para `*`; formulário com hex minúsculo; combinações de mais de uma codificação; e a concatenação de senha e security token ambos curtos no Username-Password (S15) | Definido pelo responsável na tarefa T17. Nesses casos, só um servidor que já recebeu o segredo o devolve, ao próprio usuário local, em ferramenta local. Guardar valores de tentativas anteriores aumentaria a exposição em memória |
