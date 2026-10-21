// Ativação de contratos "em validação" (questionário out/2026).
//
// No banco o status é 'em_analise'; a tela mostra "validação". Dados antigos
// ainda podem trazer 'validacao'. Só esses dois entram na ativação em massa —
// rascunho é contrato incompleto e encerrado tem botão próprio de reativar.

export const STATUS_EM_VALIDACAO = 'em_analise'

export function estaEmValidacao(status?: string | null): boolean {
  return status === 'em_analise' || status === 'validacao'
}

/** Dos selecionados, só os que estão em validação na lista carregada. */
export function idsParaAtivar(
  contratos: ReadonlyArray<{ id: string; status?: string | null }>,
  selecionados: ReadonlySet<string>,
): string[] {
  return contratos.filter((c) => selecionados.has(c.id) && estaEmValidacao(c.status)).map((c) => c.id)
}

export function rotuloQuantidadeContratos(n: number): string {
  return n === 1 ? '1 contrato' : `${n} contratos`
}
