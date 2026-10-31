// Pontos de ligação com src/server/auth, que os cadastros usam sem depender da implementação.

/** Subconjunto do cache de tokens de que os cadastros precisam. */
export interface InvalidadorTokens {
  invalidate(contextoId: number): void;
  invalidateAll(): void;
}

/** Diz se existe adaptador registrado para o tipo de login. */
export type ValidadorTipoLogin = (tipoLogin: string) => boolean;
