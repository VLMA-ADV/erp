// Competência de faturamento — o mês em que a cobrança sai, não o mês do
// trabalho (hora de agosto = competência setembro). A Revisão de fatura tem
// uma aba por competência e o botão "Gerar faturamento do mês" usa a aba
// ativa; os dois falam pelo mesmo formato ('YYYY-MM-01') e pela mesma chave
// de localStorage, para a escolha sobreviver ao F5 sem passar pelo servidor.

const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** 'YYYY-MM-01' do mês corrente (fuso local). */
export function competenciaAtual(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

/** Normaliza 'YYYY-MM' ou 'YYYY-MM-DD' para 'YYYY-MM-01'. Inválido devolve null. */
export function normalizarCompetencia(value: unknown): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(value ?? '').trim())
  if (!m) return null
  const mes = Number(m[2])
  if (mes < 1 || mes > 12) return null
  return `${m[1]}-${m[2]}-01`
}

/** Soma meses a uma competência ('YYYY-MM-01'). */
export function somarMeses(competencia: string, meses: number): string {
  const [ano, mes] = competencia.split('-').map(Number)
  const d = new Date(ano, mes - 1 + meses, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Primeiro e último dia do mês da competência — o gerador compara o período
 *  exato para não duplicar, então tem de ser sempre o mês inteiro. */
export function periodoDaCompetencia(competencia: string): { inicio: string; fim: string } {
  const [ano, mes] = competencia.split('-').map(Number)
  const ultimo = new Date(ano, mes, 0).getDate()
  const prefixo = `${ano}-${String(mes).padStart(2, '0')}`
  return { inicio: `${prefixo}-01`, fim: `${prefixo}-${String(ultimo).padStart(2, '0')}` }
}

/** "setembro de 2026" */
export function mesPorExtenso(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number)
  return `${MESES_PT[(mes || 1) - 1]} de ${ano}`
}

/** Rótulo da aba: "Faturamento de setembro de 2026". */
export function rotuloCompetencia(competencia: string): string {
  return `Faturamento de ${mesPorExtenso(competencia)}`
}

const STORAGE_PREFIX = 'faturamento:competencia:'

export function lerCompetenciaSalva(userId: string): string | null {
  try {
    return normalizarCompetencia(window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`))
  } catch {
    return null
  }
}

export function salvarCompetencia(userId: string, competencia: string) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, competencia)
  } catch {
    // localStorage indisponível (modo privado, etc.): a aba só não persiste.
  }
}
