import { describe, expect, it } from "vitest";
import { createLoginRegistry, loginRegistry } from "./registry";
import type { LoginAdapter } from "./types";

const adaptador = (type: string): LoginAdapter => ({
  type,
  login: async () => ({ ok: false, kind: "configuracao" }),
});

describe("registro de adaptadores", () => {
  it("traz os dois fluxos da fase", () => {
    expect(loginRegistry.tipos()).toEqual(["headless", "username-password"]);
    expect(loginRegistry.has("headless")).toBe(true);
    expect(loginRegistry.get("username-password")?.type).toBe("username-password");
  });

  it("não reconhece tipo sem adaptador, nem nomes herdados de Object", () => {
    expect(loginRegistry.has("sem-adaptador")).toBe(false);
    expect(loginRegistry.has("__proto__")).toBe(false);
    expect(loginRegistry.get("constructor")).toBeUndefined();
  });

  it("recusa tipo duplicado", () => {
    expect(() => createLoginRegistry([adaptador("a"), adaptador("a")])).toThrow(/duas vezes/);
  });
});
