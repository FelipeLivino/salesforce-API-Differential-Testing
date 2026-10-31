# Fluxos de login Salesforce (T02)

Pesquisa feita em 2026-10-30, só em documentação pública. Nenhuma org foi acessada e nenhum fluxo foi executado.

## Como ler este documento

Cada afirmação traz o nível de evidência e a fonte (numerada na seção 8):

| Marca | Significado |
|---|---|
| **[L]** | Página oficial obtida e consultada |
| **[B]** | Vista só no resumo do buscador, porque a página não abriu (ver seção 8). Conferir antes de tratar como definitiva |
| **[I]** | Inferência a partir das fontes, não afirmada por elas |
| **não confirmado** | Não encontrado nas páginas consultadas |

As páginas foram lidas por meio de um extrator que resume o conteúdo. Por isso, confira nomes de parâmetros na página original antes de implementar.

## 1. Alertas que afetam o briefing

1. **O fluxo Username-Password tem aposentadoria marcada para 20/02/2027**, menos de 4 meses após esta pesquisa [L1]. O briefing da Fase 1 adota esse fluxo para o usuário de integração, portanto o adaptador tem prazo de validade. Ver seção 3.5.
2. **Connected Apps têm fim de suporte previsto para o Summer '27** [L1]. O cadastro de "app OAuth" do Ambiente não deve presumir Connected App.
3. **O Client Secret opcional do briefing só está sustentado para o Headless.** No Username-Password, `client_secret` aparece como parâmetro do fluxo [L3], e a dispensa dele é **não confirmada**.
4. **O briefing prevê reaproveitar tokens "até expirar", mas as respostas documentadas não listam `expires_in`** [L2, L3]. Ver seção 4.3.

## 2. Headless Login: Authorization Code and Credentials com PKCE

Usuário Named-User de Experience Cloud. Os fluxos headless aceitam **somente URLs de site Experience Cloud** como host [L4], por exemplo `https://MyDomainName.my.site.com`.

### 2.1 Pré-requisitos na org

| Item | Detalhe | Fonte |
|---|---|---|
| Liberar o fluxo na org | Setup > OAuth and OpenID Connect Settings > **Allow Authorization Code and Credentials Flows**. Bloqueado por padrão | L5, L6 |
| Habilitar no app | **Enable Authorization Code and Credentials Flow** | L5 |
| Callback URL | Pode ser `/services/oauth2/echo` no domínio do site, ou um endpoint próprio | B1, L2 |
| Scopes | Guia de implementação cita `api` e `openid` | B1 |
| PKCE | **Require Proof Key for Code Exchange...** é opcional no app. Fortemente recomendado para cliente público | L5 |
| Secret, cliente público | Desmarcar **Require Secret For Web Server Flow** e **Require Secret for Refresh Token Flow** | L5 |
| Secret, cliente privado com backend | Marcar as duas opções e guardar o secret no backend | L5 |
| Credenciais só no corpo (opcional) | **Require user credentials in the POST body** proíbe GET e o header Basic | L5 |
| Autorização sem tela | Permitted Users = "Admin-approved users are pre-authorized" | L2 |
| API Access Control (se ativo na org) | O app precisa estar instalado no site, ou clientes e parceiros ficam bloqueados | L7 |

### 2.2 Gerar PKCE (local)

- `code_verifier`: valor aleatório gerado pelo cliente. Tamanho e alfabeto exigidos pela Salesforce: **não confirmado**.
- `code_challenge`: SHA-256 do `code_verifier`, em base64url [B2].

### 2.3 Passo 1: requisição de autorização

```http
POST {URL_DO_SITE}/services/oauth2/authorize
Auth-Request-Type: Named-User
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(username:password)>

response_type=code_credentials&client_id=...&redirect_uri=...&code_challenge=...&scope=...&state=...
```

| Elemento | Obrigatoriedade |
|---|---|
| `Auth-Request-Type: Named-User` | Obrigatório em GET e POST [L2, B2] |
| `Authorization: Basic` | Opcional no POST, obrigatório no GET [L2] |
| `response_type=code_credentials`, `client_id`, `redirect_uri` | Obrigatórios [L2] |
| `code_challenge`, `scope`, `state`, `uvid_hint` | Opcionais [L2] |
| `login_hint`, `password`, `customdata` | Alternativa de credenciais no corpo, só em POST [L2] |

Preferir POST: a própria Salesforce desaconselha credenciais em query string nos fluxos OAuth [L3], e a opção de exigir credenciais no corpo proíbe GET e Basic [L5]. Para compatibilidade com apps nessa configuração, enviar `login_hint` e `password` no corpo é o formato mais seguro [I].

**Resposta:** HTTP 302 para `redirect_uri` com `code`, `sfdc_community_url`, `sfdc_community_id` e `state` [L2].

**Consequência para o adaptador [I]:** o cliente HTTP do servidor não deve seguir o redirect automaticamente. Deve ler o header `Location` e extrair os parâmetros. Assim, o callback não precisa estar acessível nem ser implementado, mas o valor de `redirect_uri` ainda precisa coincidir com o cadastrado no app. A documentação descreve o handler do callback, não esta leitura direta, então validar na primeira execução real.

### 2.4 Passo 2: troca do code por token

GET não é suportado [L2]. Usar como host o `sfdc_community_url` recebido no passo 1 [L2].

```http
POST {sfdc_community_url}/services/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=...&code=...&redirect_uri=...&code_verifier=...
```

- Obrigatórios: `client_id`, `code`, `grant_type=authorization_code`, `redirect_uri` [L2].
- Opcionais: `client_secret`, `code_verifier`, `format` (`urlencoded`, `json` (padrão), `xml`) [L2].
- `code_verifier` passa a ser necessário na prática sempre que `code_challenge` foi enviado, pois a falta gera `invalid_grant` [L2].

**Resposta (JSON):** `access_token`, `sfdc_community_url`, `sfdc_community_id`, `signature`, `scope`, `instance_url`, `id`, `token_type` (`Bearer`), `issued_at`. Condicionais: `id_token` (com scope `openid`), `refresh_token` (se configurado), `state` [L2].

Validade do `code` e uso único: **não confirmado**.

### 2.5 Passo 3: validar o login

Boa opção para o botão "Testar login", pois a documentação usa esta chamada para confirmar o sucesso [L2].

```http
GET {sfdc_community_url}/services/oauth2/userinfo
Authorization: Bearer <access_token>
```

### 2.6 Erros comuns do Headless

| Erro | Causa | Fonte |
|---|---|---|
| `invalid_request` | `code_challenge` inválido ou inesperado, HTTPS ou método incorreto | L2, L8 |
| `invalid_grant` | `code_verifier` divergente ou ausente, code inválido, credenciais inválidas, restrição de IP ou horário de login | L2, L8 |
| `redirect_uri_mismatch` / `redirect_uri_missing` | `redirect_uri` difere do app ou não foi enviado | L8 |
| `invalid_client_id` / `invalid_client` | Client ID inválido / secret inválido | L8 |
| `invalid_app_access` | Usuário não aprovado para o app | L8 |
| `inactive_user` / `inactive_org` | Usuário inativo / org bloqueada, fechada ou suspensa | L8 |
| `unsupported_response_type` | Tipo de resposta não suportado. Fluxo não habilitado como causa: **não confirmado** | L8 |
| `rate_limit_exceeded` | Excesso de tentativas de login | L8 |

Status HTTP de cada erro, formato do corpo e mensagem exata com o fluxo bloqueado na org: **não confirmado**.

## 3. OAuth Username-Password: usuário interno

Não é suportado em sites Experience Cloud [L3]. Não oferece scopes nem refresh token [L3]; enviar `scope` gera `invalid_request` [L8].

### 3.1 Host

A página do fluxo não nomeia o host [L3]. Os hosts vêm da página de endpoints [L4]:

| Ambiente | Token endpoint |
|---|---|
| Produção | `https://login.salesforce.com/services/oauth2/token` ou My Domain |
| Sandbox | `https://test.salesforce.com/services/oauth2/token` ou `https://MyDomainName--SandboxName.sandbox.my.salesforce.com/services/oauth2/token` |

Como o Contexto já guarda a URL, usar o My Domain é o caminho coerente [I].

### 3.2 Requisição

```http
POST {URL_DO_AMBIENTE}/services/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&client_id=...&client_secret=...&username=...&password=<senha><security_token>
```

- Parâmetros: `grant_type=password`, `client_id`, `client_secret`, `username`, `password`; opcional `format` [L3].
- Nunca enviar credenciais na query string [L3].
- `Content-Type` não é citado na página [L3]. O corpo de exemplo tem formato urlencoded [I].
- Valores devem ser codificados em URL, pois senhas podem ter caracteres especiais [I].

### 3.3 Security token

Não existe parâmetro próprio: o token é **concatenado ao final da senha** antes do envio [L3]. Ele é exigido no login a partir de rede não confiável [L3]. Com IP confiável, a dispensa é coerente com esse texto, mas não foi confirmada nesta pesquisa. Daí o campo opcional no Contexto: enviar `senha + token` quando houver token e só a senha quando não houver [I].

### 3.4 Resposta e erros

Resposta: `id`, `issued_at`, `instance_url`, `signature`, `access_token`, `token_type` (`Bearer`). Sem refresh token [L3].

| Erro | Causa | Fonte |
|---|---|---|
| `invalid_grant` (variante "authentication failure") | Senha ou usuário inválidos, token de segurança ausente ou incorreto [I], restrição de IP ou horário | L8, B3 |
| `invalid_client_id` / `invalid_client` | Client ID / secret inválidos | L8 |
| `invalid_request` | `scope` enviado, HTTPS ou método incorreto | L8 |
| `unsupported_grant_type` | `grant_type` não suportado. Pode indicar URL de login errada | B4 |
| `inactive_user` / `inactive_org` | Usuário inativo / org indisponível | L8 |
| `invalid_app_access` | Usuário não aprovado para o app | L8 |
| `rate_limit_exceeded` | Excesso de tentativas de login | L8 |

Mensagem exata quando o fluxo está bloqueado na org: **não confirmado**. O botão Testar login deve exibir `error` e `error_description` sem tratamento, se presentes. Nomes desses campos no corpo: **não confirmado** nas páginas lidas, embora sejam o padrão OAuth [I].

### 3.5 Status de bloqueio e descontinuação

| Data ou versão | Situação | Fonte |
|---|---|---|
| Hoje | Pode ser bloqueado pela opção **Allow OAuth Username-Password Flows**. Salesforce recomenda bloquear | L6 |
| Orgs do Summer '23 em diante | Bloqueado por padrão, pode ser reativado | L6 |
| Spring '26 | Release Update da aposentadoria disponibilizado | B5 |
| Winter '27 | Data original de aplicação, depois adiada | B5 |
| **20/02/2027** | **Aposentadoria do fluxo** | L1, B5 |
| Summer '27 | Fim de suporte de Connected Apps | L1 |

Observações:

- **Sinal de divergência:** o resumo da nota de versão indica que orgs criadas a partir do Summer '26 já bloqueiam o fluxo e não veem o Release Update [B5], enquanto a página de bloqueio fala em Summer '23 com reativação possível [L6]. Podem ser coisas distintas (bloqueio configurável e retirada definitiva), mas isso é **não confirmado**.
- **A roadmap oficial declara que está em evolução** [L1], então a data pode mudar de novo.
- **Alcance para External Client Apps:** o título da nota cita Connected Apps [B5]. Se o fluxo continua em External Client Apps após a data: **não confirmado**. Não planejar contando com isso.
- **Substitutos recomendados:** Web Server com PKCE para login de usuário, Client Credentials para servidor a servidor [L3, B5].
- **Verificar na sandbox da Honda:** em Setup, a opção Allow OAuth Username-Password Flows e a página Release Updates. Isso depende de alguém com acesso à org.

## 4. Chamadas posteriores

### 4.1 URL base e token

| Tipo | URL base | Autenticação |
|---|---|---|
| Username-Password | `instance_url` da resposta [L3] | `Authorization: Bearer <access_token>` |
| Headless | `sfdc_community_url` da resposta [L2] | `Authorization: Bearer <access_token>` |

- A resposta Headless traz também `instance_url`. Os exemplos oficiais usam `sfdc_community_url` [L2]; o comportamento de uma chamada de usuário de comunidade via `instance_url`, e se há diferença de resultado, é **não confirmado**. Vale testar, pois é relevante para testes diferenciais.
- Usar a URL exatamente como devolvida, sem remover caminho nem barra de forma arbitrária, e normalizar só a junção com o path [I]. O exemplo de `instance_url` termina com `/` [L3].

**`sid`:** nenhum dos dois fluxos devolve campo `sid` [L2, L3]. A Apex REST aceita OAuth 2.0 e Session ID [L9]. Ser o `access_token` usável como `sid` em cookie ou em outras interfaces: **não confirmado**. Para esta ferramenta, usar só o `access_token` no header Bearer.

### 4.2 `/services/apexrest` com token de comunidade

```http
{MÉTODO} {sfdc_community_url}/services/apexrest/{urlMapping}
Authorization: Bearer <access_token>
```

**Status: não confirmado por exemplo oficial completo.** O padrão é inferência de duas evidências: os exemplos headless montam chamadas sobre o `sfdc_community_url` com Bearer [L2], e a própria documentação usa `{Experience Cloud Domain}/services/apexrest/code/extraction` como URL de callback [L2]. Validar na primeira execução real.

Requisitos do usuário de comunidade:

| Requisito | Detalhe | Fonte |
|---|---|---|
| Permissão | **Apex REST Services** dá acesso mesmo sem API Enabled | L9 |
| Alternativa | API Enabled por perfil ou permission set, com o perfil como membro do site | B6 |
| Classe Apex | O usuário precisa de permissão para executar a classe | B7 |
| Scope do app | `api` é citado na configuração headless [B1]. Scope mínimo para Apex REST: **não confirmado** | B1 |
| API Access Control | Se ativo, o app precisa estar instalado no site | L7 |

Compatibilidade de licenças: a alocação diária da Customer Community aparece como 0 [B8], e não está confirmado se isso impede a Apex REST. **Licenças da Honda precisam ser conferidas.**

Sharing e permissão por campo dependem de como a classe Apex é escrita (`with sharing`, verificação de FLS). Isso é o que os testes diferenciais tendem a expor, mas está fora do escopo das páginas lidas e não foi pesquisado aqui.

### 4.3 Expiração do token

- `expires_in` não é listado nas respostas documentadas [L2, L3].
- `issued_at` existe, mas sozinho não indica validade.
- Token inválido ou expirado resulta em HTTP 401 na REST API [B9].

Sugestão ao adaptador [I]: reaproveitar o token em memória até receber 401, então refazer o login uma vez. Uma nova tentativa automática sem limite pode consumir o limite de login e bloquear o usuário.

## 5. Limites

| Limite | Valor | Fonte |
|---|---|---|
| Login por usuário | 3.600 requisições por hora. Excesso gera `LOGIN_RATE_EXCEEDED`; orientação de aguardar cerca de 1 hora | L10 |
| Requisições de autorização do app | Excesso do limite por hora gera `server_error`. Valor numérico: **não confirmado** | L8 |
| API diária, org | 100.000 + (licenças × alocação) + adicionais comprados | B8 |
| Customer Community Plus | 200 chamadas por licença em 24 h | B8 |
| Customer Community Plus Login | 10 chamadas por licença em 24 h | B8 |
| Customer Community | 0 | B8 |
| Apex REST | Cada requisição conta 1 chamada, e os governor limits do Apex valem | B10 |
| Limite específico do Headless Login | **não confirmado** | |
| Tokens simultâneos por usuário e app | **não confirmado** | |
| Tempo de vida do `access_token` | **não confirmado**. Depende da configuração de sessão [I] | |

Mudança prevista: refresh tokens com TTL ocioso de 30 dias, em 21/10/2026 (sandbox) e 04/11/2026 (produção) [L1]. Sem impacto se a Fase 1 não usar refresh token.

Testes em lote podem consumir o limite diário da org compartilhada e prejudicar outras integrações [I].

## 6. Pontos para o servidor falso

Comportamentos a reproduzir nos testes automatizados:

- `authorize` devolvendo 302 com `code`, `sfdc_community_url` e `state`, e casos de `invalid_request`.
- `token` com `invalid_grant` por `code_verifier` divergente ou ausente.
- `token` com `grant_type=password`, sucesso sem refresh token e `invalid_grant` para senha sem security token.
- `userinfo` e `/services/apexrest/...` devolvendo 401 com token expirado.

Os corpos exatos de erro são **não confirmados**, portanto esses mocks são hipóteses até uma execução real.

## 7. Lista de não confirmados

1. Corpo e status HTTP exatos dos erros, inclusive com fluxo bloqueado.
2. Chamada completa de `/services/apexrest` com token de comunidade em exemplo oficial.
3. Diferença entre usar `instance_url` e `sfdc_community_url` com token de comunidade.
4. Uso de `access_token` como `sid`.
5. Username-Password sem `client_secret`.
6. Permanência do Username-Password em External Client Apps após 20/02/2027.
7. Regras do `code_verifier`, validade do `code`, tempo de vida do `access_token`.
8. Limites específicos do Headless e número de tokens simultâneos.
9. Efeito da alocação 0 da Customer Community sobre Apex REST.
10. Relação entre os bloqueios por padrão de Summer '23 e Summer '26.

## 8. Fontes

### Consultadas diretamente [L]

- L1. [Connected App & External Client App Security Requirement Updates](https://help.salesforce.com/s/articleView?id=005461287&language=en_US&type=1) (datada de 14/10/2026)
- L2. [Headless Identity APIs: Authorization Code and Credentials Flow for Public Clients](https://help.salesforce.com/s/articleView?id=xcloud.remoteaccess_authcodecreds_singlepageapp.htm&language=en_US&type=5)
- L3. [OAuth 2.0 Username-Password Flow](https://help.salesforce.com/apex/HTViewHelpDoc?id=remoteaccess_oauth_username_password_flow.htm&language=en_US)
- L4. [OAuth Endpoints](https://help.salesforce.com/apex/HTViewHelpDoc?id=remoteaccess_oauth_endpoints.htm&language=en_US)
- L5. [Configure a Code and Credentials Flow](https://help.salesforce.com/s/articleView?id=sf.configure_oauth_code_credentials_flow_external_client_apps.htm&language=en_US&type=5)
- L6. [Block Authorization Flows to Improve Security](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_disable_username_password_flow.htm&language=en_US&type=5)
- L7. [Restrict Customers and Partners from Accessing APIs](https://help.salesforce.com/apex/HTViewHelpDoc?id=security_api_access_control_external_users.htm&language=en_US)
- L8. [OAuth 2.0 Authorization Errors](https://help.salesforce.com/apex/HTViewHelpDoc?id=sf.remoteaccess_oauth_flow_errors.htm&language=en_US)
- L9. [Which API Do I Use?](https://help.salesforce.com/s/articleView?id=platform.integrate_what_is_api.htm&language=en_US&type=5)
- L10. [Sign In Error 'Login Rate Exceeded'](https://help.salesforce.com/s/articleView?id=000381578&language=en_US&type=1)

### Vistas só no resumo do buscador [B]

- B1. [Create an OAuth-Enabled External Client App](https://developer.salesforce.com/docs/platform/headless-identity-impl-guide/guide/headless-identity-create-connected-app.html)
- B2. [Headless Login: Send an Authorization Request](https://developer.salesforce.com/docs/platform/headless-identity-impl-guide/guide/headless-identity-postman-login-authorize.html) e [Headless Login Overview](https://developer.salesforce.com/docs/platform/headless-identity-impl-guide/guide/headless-identity-login-overview.html)
- B3. [DCG Troubleshooting](https://developer.salesforce.com/docs/industries/cme/guide/comms-t-dcg-troubleshooting.html) e [Salesforce OAuth JWT Connection fails with invalid_grant](https://help.salesforce.com/s/articleView?id=001122219&language=en_US&type=1)
- B4. [Resolve Common Authorization Errors](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-troubleshoot-auth-errors.html)
- B5. [Retirement of OAuth 2.0 Username-Password Flow for Connected Apps (Release Update)](https://help.salesforce.com/s/articleView?language=en_US&id=release-notes.rn_security_oauth_unpw.htm&release=264&type=5) e [Release Updates](https://help.salesforce.com/s/articleView?id=release-notes.rn_ru.htm&release=264&type=5&language=en_US)
- B6. [Grant API Access to Users](https://developer.salesforce.com/docs/platform/mobile-sdk/guide/communities-users-api-access.html) e [Create a Permission Set and Grant API Enabled Access](https://help.salesforce.com/s/articleView?id=xcloud.branded_apps_commun_api_permset.htm&language=en_US&type=5)
- B7. [Limit Access to Apex Classes](https://developer.salesforce.com/docs/platform/communities-dev/guide/communities-dev-security-guest-users-apex-access.html)
- B8. [API Request Limits and Allocations](https://developer.salesforce.com/docs/platform/salesforce-app-limits-cheatsheet/guide/salesforce-app-limits-platform-api.html)
- B9. [Status Codes and Error Responses](https://developer.salesforce.com/docs/platform/api-rest/guide/errorcodes.html)
- B10. Documentação Apex REST para desenvolvedores, citada no resumo da busca de limites sem URL própria identificada. Confirmar.

### Tentadas sem conteúdo útil

- `developer.salesforce.com/docs/...`: as três páginas tentadas (Headless Login Overview, Send an Authorization Request e `meta_oauthoidcsettings`) devolveram HTTP 403 ao WebFetch.
- [Nota de versão do bloqueio por padrão (release 244)](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_username-password_flow_blocked_by_default.htm&language=en_US&release=244&type=5), B5 e [Experience Cloud License Limitations](https://help.salesforce.com/s/articleView?id=limits_communities_licenses.htm&language=en_US): só carregaram a tela de erro "Sorry to interrupt".
