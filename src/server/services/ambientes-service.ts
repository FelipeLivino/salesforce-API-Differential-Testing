import type { AmbienteDto } from "@/shared/dto";
import { encryptSecret } from "../crypto/secrets";
import type { AmbienteRecord, AmbientesRepository } from "../db/repositories";
import { naoEncontrado } from "./erros";
import type { InvalidadorTokens } from "./portas";
import { exigirObjeto, hostMudou, Validador, type Corpo } from "./validacao";

/** Lista explícita de campos: o valor cifrado nunca entra na resposta. */
function paraDto(ambiente: AmbienteRecord): AmbienteDto {
  return {
    id: ambiente.id,
    url: ambiente.url,
    tipo: ambiente.tipo,
    app: {
      clientId: ambiente.app.clientId,
      redirectUri: ambiente.app.redirectUri,
      clientSecretDefinido: ambiente.app.clientSecretCifrado !== null,
    },
    criadoEm: ambiente.criadoEm,
    atualizadoEm: ambiente.atualizadoEm,
  };
}

function lerApp(corpo: Corpo, v: Validador): Corpo {
  const app = corpo.app;
  if (app === undefined || app === null) return {};
  if (typeof app !== "object" || Array.isArray(app)) {
    v.erro("app", "App OAuth precisa ser um objeto.");
    return {};
  }
  return app as Corpo;
}

export type AmbientesService = ReturnType<typeof createAmbientesService>;

export function createAmbientesService(repo: AmbientesRepository, tokens: InvalidadorTokens) {
  return {
    listar: (): AmbienteDto[] => repo.listar().map(paraDto),

    buscar(id: number): AmbienteDto {
      const ambiente = repo.buscarPorId(id);
      if (!ambiente) throw naoEncontrado("Ambiente");
      return paraDto(ambiente);
    },

    criar(entrada: unknown): AmbienteDto {
      const corpo = exigirObjeto(entrada);
      const v = new Validador();
      const app = lerApp(corpo, v);
      const url = v.urlBase(corpo.url, "url", "URL");
      const tipo = v.tipoAmbiente(corpo.tipo, "tipo");
      const clientId = v.textoObrigatorio(app.clientId, "app.clientId", "Client ID");
      const redirectUri = v.redirectUri(app.redirectUri, "app.redirectUri", "Redirect URI");
      const clientSecret = v.segredoOpcional(app.clientSecret, "app.clientSecret", "Client Secret");
      v.concluir();

      return paraDto(
        repo.criar({
          url: url!,
          tipo: tipo!,
          app: {
            clientId: clientId!,
            redirectUri: redirectUri ?? null,
            clientSecretCifrado: clientSecret === null ? null : encryptSecret(clientSecret),
          },
        }),
      );
    },

    editar(id: number, entrada: unknown): AmbienteDto {
      const corpo = exigirObjeto(entrada);
      const atual = repo.buscarPorId(id);
      if (!atual) throw naoEncontrado("Ambiente");

      const v = new Validador();
      const app = lerApp(corpo, v);
      const url = corpo.url === undefined ? undefined : v.urlBase(corpo.url, "url", "URL");
      const tipo = corpo.tipo === undefined ? undefined : v.tipoAmbiente(corpo.tipo, "tipo");
      const clientId = v.textoEditavel(app.clientId, "app.clientId", "Client ID");
      const redirectUri = v.redirectUri(app.redirectUri, "app.redirectUri", "Redirect URI");
      const clientSecret = v.segredoEditavel(app.clientSecret, "app.clientSecret", "Client Secret");
      if (hostMudou(atual.url, url) && atual.app.clientSecretCifrado !== null && clientSecret === undefined) {
        v.erro("app.clientSecret", "Informe o Client Secret de novo, ou remova-o: o host da URL mudou.");
      }
      v.concluir();

      const atualizado = repo.atualizar(id, {
        url,
        tipo,
        app: {
          clientId,
          redirectUri,
          clientSecretCifrado: clientSecret ? encryptSecret(clientSecret) : clientSecret,
        },
      })!;
      // O app OAuth vale para todos os contextos do ambiente.
      tokens.invalidateAll();
      return paraDto(atualizado);
    },
  };
}
