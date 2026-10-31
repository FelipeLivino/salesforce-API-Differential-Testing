"use client";

import { api } from "@/lib/api-client";
import { useRecurso } from "@/lib/hooks";

/** Avisa em todas as telas quando a chave falta, antes de a pessoa tentar gravar um segredo. */
export function AvisoChave() {
  const { dados } = useRecurso(api.status.obter);
  const chave = dados?.chaveCriptografia;
  if (!chave || chave.configurada) return null;
  return (
    <div className="caixa caixa-erro aviso-global" role="alert">
      <strong>Chave de criptografia não configurada</strong>
      <p className="literal">{chave.aviso}</p>
    </div>
  );
}
