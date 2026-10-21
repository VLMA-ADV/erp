// deno test supabase/functions/_shared/discriminacao-nfse.test.ts
import {
  competenciaDoServicoDosItens,
  incluirCompetenciaNaDiscriminacao,
  LIMITE_DISCRIMINACAO_NFSE,
  linhaCompetenciaDoServico,
  montarDiscriminacao,
  naturezaDoItem,
} from "./discriminacao-nfse.ts"

function eq(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`)
}

Deno.test("natureza do item pelo snapshot", () => {
  eq(naturezaDoItem({ origem: "timesheet", timesheet_horas: 2 }), "timesheet")
  eq(naturezaDoItem({ origem: "despesa", regra_cobranca: "despesa" }), "despesa")
  eq(naturezaDoItem({ origem: "regra_financeira", regra_cobranca: "mensal" }), "mensal")
  eq(naturezaDoItem({ origem: "regra_financeira", regra_cobranca: "projeto" }), "projeto")
  eq(naturezaDoItem({ timesheet_horas: 1 }), "timesheet") // snapshot antigo sem 'origem'
  eq(naturezaDoItem(null), "regra")
})

Deno.test("mês do serviço: horas, despesas e mensalidade = kit − 1; demais = o próprio mês", () => {
  eq(competenciaDoServicoDosItens("2026-10-01", ["timesheet"]), "2026-09-01")
  eq(competenciaDoServicoDosItens("2026-10", ["mensal"]), "2026-09-01")
  eq(competenciaDoServicoDosItens("2026-10-01", ["mensalidade_carteira"]), "2026-09-01")
  eq(competenciaDoServicoDosItens("2026-10-01", ["projeto"]), "2026-10-01")
  eq(competenciaDoServicoDosItens("2026-10-01", ["pro_labore", "exito", "mensalidade_processo", "salario_minimo"]), "2026-10-01")
  // Mistura: vale o mês das horas/mensalidade.
  eq(competenciaDoServicoDosItens("2026-10-01", ["projeto", "timesheet"]), "2026-09-01")
  // Virada de ano.
  eq(competenciaDoServicoDosItens("2027-01-01", ["timesheet"]), "2026-12-01")
  // Sem competência do kit não há mês.
  eq(competenciaDoServicoDosItens(null, ["timesheet"]), null)
  eq(competenciaDoServicoDosItens("", ["timesheet"]), null)
})

Deno.test("linha da competência", () => {
  eq(linhaCompetenciaDoServico("2026-09-01"), "Competência do serviço: setembro/2026")
  eq(linhaCompetenciaDoServico("2026-03-01"), "Competência do serviço: março/2026")
  eq(linhaCompetenciaDoServico(null), null)
})

const FIXA = "Honorários Advocatícios\nPagamento conforme boleto bancário em anexo"

Deno.test("descrição automática: caso, competência, bloco fixo", () => {
  eq(
    montarDiscriminacao({ casoNomes: ["Caso A", "Caso B"], linhaCompetencia: "Competência do serviço: setembro/2026", descricaoFixa: FIXA }),
    "Caso A; Caso B\nCompetência do serviço: setembro/2026\n" + FIXA,
  )
  eq(montarDiscriminacao({ casoNomes: [], linhaCompetencia: null, descricaoFixa: FIXA }), FIXA)
  eq(montarDiscriminacao({ casoNomes: ["X"], linhaCompetencia: null, descricaoFixa: FIXA }), "X\n" + FIXA)
})

Deno.test("descrição automática respeita o limite encurtando só os nomes dos casos", () => {
  const nomes = Array.from({ length: 300 }, (_, i) => `Caso numero ${i}`)
  const linha = "Competência do serviço: setembro/2026"
  const t = montarDiscriminacao({ casoNomes: nomes, linhaCompetencia: linha, descricaoFixa: FIXA })
  if (t.length > LIMITE_DISCRIMINACAO_NFSE) throw new Error(`passou do limite: ${t.length}`)
  if (!t.endsWith("\n" + linha + "\n" + FIXA)) throw new Error("bloco fixo/competência foram cortados")
  if (!t.split("\n")[0].endsWith("…")) throw new Error("nomes dos casos sem reticências")
})

Deno.test("descrição editada: inclui a linha se faltar, não duplica", () => {
  const linha = "Competência do serviço: setembro/2026"
  eq(incluirCompetenciaNaDiscriminacao("Caso A\n" + FIXA, linha), "Caso A\n" + linha + "\n" + FIXA)
  const comLinha = "Caso A\nCompetência do serviço: agosto/2026\n" + FIXA
  eq(incluirCompetenciaNaDiscriminacao(comLinha, linha), comLinha)
  eq(incluirCompetenciaNaDiscriminacao("Caso A", null), "Caso A")
  eq(incluirCompetenciaNaDiscriminacao("", linha), linha)
})
