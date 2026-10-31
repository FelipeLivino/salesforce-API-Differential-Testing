import type { StatusResponse, TipoLoginDto } from "@/shared/dto";
import { createLoginService, type LoginService } from "../auth/login-service";
import { loginRegistry } from "../auth/registry";
import { getTokenCache } from "../auth/token-cache";
import { assertEncryptionKeyConfigured, SecretsCryptoError } from "../crypto/secrets";
import { getDatabase, type Db } from "../db/connection";
import {
  createAmbientesRepository,
  createContextosRepository,
  createPerfisRepository,
} from "../db/repositories";
import { createAmbientesService } from "./ambientes-service";
import { createContextosService } from "./contextos-service";
import { createPerfisService } from "./perfis-service";
import type { InvalidadorTokens, ValidadorTipoLogin } from "./portas";
import { createTesteLoginService, type TesteLoginService } from "./teste-login-service";

export { CadastroError } from "./erros";

export interface DependenciasCadastros {
  tokens: InvalidadorTokens;
  tipoLoginValido: ValidadorTipoLogin;
}

export type Cadastros = ReturnType<typeof createCadastros>;

export function createCadastros(db: Db, dependencias: DependenciasCadastros) {
  const ambientes = createAmbientesRepository(db);
  const perfis = createPerfisRepository(db);
  const contextos = createContextosRepository(db);
  return {
    ambientes: createAmbientesService(ambientes, dependencias.tokens),
    perfis: createPerfisService(perfis, dependencias.tokens, dependencias.tipoLoginValido),
    contextos: createContextosService(contextos, ambientes, perfis, dependencias.tokens),
  };
}

const dependenciasPadrao: DependenciasCadastros = {
  tokens: {
    // A chave do cache é texto; o id do contexto no banco é número.
    invalidate: (contextoId) => getTokenCache().invalidate(String(contextoId)),
    invalidateAll: () => getTokenCache().invalidateAll(),
  },
  tipoLoginValido: (tipoLogin) => loginRegistry.has(tipoLogin),
};

/** Abre o banco só quando chamado, para que importar uma rota durante o build não o toque. */
export function getCadastros(): Cadastros {
  return createCadastros(getDatabase(), dependenciasPadrao);
}

export function getLoginService(): LoginService {
  const db = getDatabase();
  return createLoginService({
    contextos: createContextosRepository(db),
    ambientes: createAmbientesRepository(db),
    perfis: createPerfisRepository(db),
  });
}

export function getTesteLogin(): TesteLoginService {
  const db = getDatabase();
  return createTesteLoginService(createContextosRepository(db), createPerfisRepository(db), getLoginService());
}

/** Não abre o banco: os tipos vêm só do registro de adaptadores. */
export function listarTiposLogin(): TipoLoginDto[] {
  return loginRegistry.tipos().map((tipo) => ({ tipo }));
}

/** Não abre o banco. A mensagem do erro é fixa: cita o motivo, nunca a chave. */
export function statusDoServico(): StatusResponse {
  try {
    assertEncryptionKeyConfigured();
    return { chaveCriptografia: { configurada: true } };
  } catch (error) {
    if (error instanceof SecretsCryptoError) {
      return { chaveCriptografia: { configurada: false, aviso: error.message } };
    }
    throw error;
  }
}
