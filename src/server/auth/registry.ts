import { headlessAdapter } from "./adapters/headless";
import { usernamePasswordAdapter } from "./adapters/username-password";
import type { LoginAdapter } from "./types";

export interface LoginRegistry {
  get(tipoLogin: string): LoginAdapter | undefined;
  has(tipoLogin: string): boolean;
  tipos(): string[];
}

export function createLoginRegistry(adapters: readonly LoginAdapter[]): LoginRegistry {
  const porTipo = new Map<string, LoginAdapter>();
  for (const adapter of adapters) {
    if (porTipo.has(adapter.type)) {
      throw new Error(`Tipo de login registrado duas vezes: ${adapter.type}`);
    }
    porTipo.set(adapter.type, adapter);
  }
  return {
    get: (tipoLogin) => porTipo.get(tipoLogin),
    has: (tipoLogin) => porTipo.has(tipoLogin),
    tipos: () => [...porTipo.keys()],
  };
}

/** Novo fluxo: um arquivo em `adapters/` e uma linha nesta lista. */
export const loginRegistry = createLoginRegistry([headlessAdapter, usernamePasswordAdapter]);
