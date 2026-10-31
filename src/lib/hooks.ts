"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErroApi, paraErroApi } from "./api-client";

/** Carrega dados ao montar. `carregar` precisa ser estável, como as funções de `api`. */
export function useRecurso<T>(carregar: () => Promise<T>) {
  const [estado, setEstado] = useState<{ dados?: T; erro?: ErroApi; carregando: boolean }>({ carregando: true });
  const ultimaChamada = useRef(0);

  const recarregar = useCallback(async () => {
    const chamada = ++ultimaChamada.current;
    setEstado((atual) => ({ ...atual, carregando: true }));
    try {
      const dados = await carregar();
      if (chamada === ultimaChamada.current) setEstado({ dados, carregando: false });
    } catch (erro) {
      if (chamada === ultimaChamada.current) {
        setEstado((atual) => ({ dados: atual.dados, erro: paraErroApi(erro), carregando: false }));
      }
    }
  }, [carregar]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return { ...estado, recarregar };
}

/** Executa uma escrita, guardando o andamento e o erro. Devolve se deu certo. */
export function useAcao() {
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<ErroApi>();

  const executar = useCallback(async (acao: () => Promise<unknown>): Promise<boolean> => {
    setExecutando(true);
    setErro(undefined);
    try {
      await acao();
      return true;
    } catch (e) {
      setErro(paraErroApi(e));
      return false;
    } finally {
      setExecutando(false);
    }
  }, []);

  return { executando, erro, executar };
}
