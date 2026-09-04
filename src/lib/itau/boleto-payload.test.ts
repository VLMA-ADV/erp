/**
 * Testes do tradutor de boleto. Rodar: deno test src/lib/itau/
 *
 * Os valores esperados sao copiados da colecao Postman oficial do Itau
 * (arquivo "Boletos_new 4.json", recebido em 14/08/2026), nao inventados.
 */
import { assertEquals, assertThrows } from "jsr:@std/assert@1"
import {
  centavos17,
  lerNotificacoes,
  lerRespostaEmissao,
  montarPayloadEmissao,
  nossoNumero8,
  percentual12,
  percentual5,
  somarDias,
  textoItau,
  valor2,
  validarPagador,
  type BoletoConfig,
  type BoletoPagador,
} from "./boleto-payload.ts"

Deno.test("centavos17 reproduz o exemplo oficial (R$ 50,00)", () => {
  assertEquals(centavos17(50), "00000000000005000")
  assertEquals(centavos17(0), "00000000000000000")
  assertEquals(centavos17(1234.56), "00000000000123456")
})

Deno.test("centavos17 arredonda em vez de truncar o centavo", () => {
  // 0.1 + 0.2 = 0.30000000000000004 em float; truncando sairia 0.30 -> ok,
  // mas 8.115 * 100 = 811.4999... e truncar cobraria um centavo a menos.
  assertEquals(centavos17(8.115), "00000000000000812")
  assertEquals(centavos17(0.1 + 0.2), "00000000000000030")
})

Deno.test("centavos17 recusa valor negativo", () => {
  assertThrows(() => centavos17(-1))
})

Deno.test("percentual12 reproduz o exemplo oficial (1%)", () => {
  assertEquals(percentual12(1), "000000100000")
  assertEquals(percentual12(2.5), "000000250000")
  assertEquals(percentual12(0), "000000000000")
})

Deno.test("percentual5 e valor2 usam o formato do PATCH, nao o da emissao", () => {
  assertEquals(percentual5(15), "15.00000")
  assertEquals(valor2(10), "10.00")
})

Deno.test("nossoNumero8 completa com zeros e recusa numero longo demais", () => {
  assertEquals(nossoNumero8(1), "00000001")
  assertEquals(nossoNumero8("12343138"), "12343138")
  assertThrows(() => nossoNumero8(123456789))
})

Deno.test("somarDias nao vira o dia por fuso", () => {
  assertEquals(somarDias("2026-08-14", 5), "2026-08-19")
  assertEquals(somarDias("2026-08-31", 1), "2026-09-01")
  assertEquals(somarDias("2026-12-31", 1), "2027-01-01")
})

const CONFIG: BoletoConfig = {
  id_beneficiario: "150000572639",
  codigo_carteira: "109",
  codigo_especie: "01",
  juros: { codigo_tipo: "90", dias: 1, percentual_mes: 1 },
  multa: { codigo_tipo: "02", dias: 1, percentual: 1 },
  instrucoes: [{ codigo: "4", dias_apos_vencimento: 0, dia_util: false }],
  recebimento_divergente_codigo: "01",
  dias_limite_pagamento: null,
  desconto_expresso: false,
}

const PAGADOR: BoletoPagador = {
  nome: "Nome Valido",
  tipo: "F",
  documento: "265.569.232-22",
  logradouro: "Rua endereço,71",
  bairro: "Bairro",
  cidade: "Cidade",
  uf: "PE",
  cep: "51340-540",
}

Deno.test("payload de emissao bate com o exemplo oficial", () => {
  const p = montarPayloadEmissao({
    config: CONFIG,
    pagador: PAGADOR,
    titulo: {
      nosso_numero: 1,
      seu_numero: "2",
      uso_beneficiario: "2",
      valor: 50,
      vencimento: "2025-12-30",
      data_emissao: "2025-10-06",
    },
    etapa: "validacao",
  }) as any

  const d = p.data
  assertEquals(d.etapa_processo_boleto, "validacao")
  assertEquals(d.codigo_canal_operacao, "API")
  assertEquals(d.beneficiario.id_beneficiario, "150000572639")

  const b = d.dado_boleto
  assertEquals(b.codigo_carteira, "109")
  assertEquals(b.codigo_especie, "01")
  assertEquals(b.valor_abatimento, "000")
  assertEquals(b.data_emissao, "2025-10-06")
  assertEquals(b.tipo_boleto, "a vista")
  assertEquals(b.descricao_instrumento_cobranca, "boleto")
  assertEquals(b.desconto_expresso, false)

  assertEquals(b.pagador.pessoa.nome_pessoa, "Nome Valido")
  assertEquals(b.pagador.pessoa.tipo_pessoa.codigo_tipo_pessoa, "F")
  // Pontuacao do CPF cai fora — o Itau quer so digitos.
  assertEquals(b.pagador.pessoa.tipo_pessoa.numero_cadastro_pessoa_fisica, "26556923222")
  assertEquals(b.pagador.endereco.numero_CEP, "51340540")
  assertEquals(b.pagador.endereco.sigla_UF, "PE")

  assertEquals(b.dados_individuais_boleto[0], {
    numero_nosso_numero: "00000001",
    data_vencimento: "2025-12-30",
    valor_titulo: "00000000000005000",
    texto_uso_beneficiario: "2",
    texto_seu_numero: "2",
  })

  assertEquals(b.multa, {
    codigo_tipo_multa: "02",
    quantidade_dias_multa: 1,
    percentual_multa: "000000100000",
  })
  assertEquals(b.juros, {
    codigo_tipo_juros: 90,
    quantidade_dias_juros: 1,
    percentual_juros: "000000100000",
  })
  assertEquals(b.recebimento_divergente, { codigo_tipo_autorizacao: "01" })
  assertEquals(b.instrucao_cobranca, [
    { codigo_instrucao_cobranca: "4", quantidade_dias_apos_vencimento: 0, dia_util: false },
  ])
  // Sem dias_limite_pagamento configurado, o campo nao vai no payload.
  assertEquals("data_limite_pagamento" in b, false)
})

Deno.test("pessoa juridica manda CNPJ no campo proprio", () => {
  const p = montarPayloadEmissao({
    config: CONFIG,
    pagador: { ...PAGADOR, tipo: "J", documento: "14.491.612/0001-39" },
    titulo: {
      nosso_numero: 7,
      seu_numero: "abc",
      uso_beneficiario: "VLMA",
      valor: 1200.5,
      vencimento: "2026-09-10",
      data_emissao: "2026-08-14",
    },
    etapa: "efetivacao",
  }) as any
  const tp = p.data.dado_boleto.pagador.pessoa.tipo_pessoa
  assertEquals(tp.codigo_tipo_pessoa, "J")
  assertEquals(tp.numero_cadastro_nacional_pessoa_juridica, "14491612000139")
  assertEquals("numero_cadastro_pessoa_fisica" in tp, false)
  assertEquals(p.data.dado_boleto.dados_individuais_boleto[0].valor_titulo, "00000000000120050")
})

Deno.test("multa por valor fixo usa valor_multa, nao percentual", () => {
  const p = montarPayloadEmissao({
    config: { ...CONFIG, multa: { codigo_tipo: "01", dias: 1, valor: 10 } },
    pagador: PAGADOR,
    titulo: {
      nosso_numero: 1, seu_numero: "1", uso_beneficiario: "1", valor: 50,
      vencimento: "2026-09-01", data_emissao: "2026-08-14",
    },
    etapa: "validacao",
  }) as any
  assertEquals(p.data.dado_boleto.multa.valor_multa, "00000000000001000")
  assertEquals("percentual_multa" in p.data.dado_boleto.multa, false)
})

Deno.test("sem juros e sem multa configurados, os blocos somem do payload", () => {
  const p = montarPayloadEmissao({
    config: { ...CONFIG, juros: null, multa: null, instrucoes: [], recebimento_divergente_codigo: null },
    pagador: PAGADOR,
    titulo: {
      nosso_numero: 1, seu_numero: "1", uso_beneficiario: "1", valor: 50,
      vencimento: "2026-09-01", data_emissao: "2026-08-14",
    },
    etapa: "validacao",
  }) as any
  const b = p.data.dado_boleto
  assertEquals("juros" in b, false)
  assertEquals("multa" in b, false)
  assertEquals("instrucao_cobranca" in b, false)
  assertEquals("recebimento_divergente" in b, false)
})

Deno.test("data limite de pagamento e contada a partir do vencimento", () => {
  const p = montarPayloadEmissao({
    config: { ...CONFIG, dias_limite_pagamento: 30 },
    pagador: PAGADOR,
    titulo: {
      nosso_numero: 1, seu_numero: "1", uso_beneficiario: "1", valor: 50,
      vencimento: "2026-08-31", data_emissao: "2026-08-14",
    },
    etapa: "validacao",
  }) as any
  assertEquals(p.data.dado_boleto.data_limite_pagamento, "2026-09-30")
})

Deno.test("validarPagador aponta exatamente o que falta no cadastro", () => {
  assertEquals(validarPagador(PAGADOR), [])
  assertEquals(
    validarPagador({ ...PAGADOR, bairro: "", cep: "", cidade: "  " }),
    ["bairro", "cidade", "CEP"],
  )
  assertEquals(validarPagador({ ...PAGADOR, uf: "XX" }), ["estado invalido (XX)"])
  assertEquals(validarPagador({ ...PAGADOR, documento: "123" }), ["CPF com 11 digitos"])
  assertEquals(validarPagador(null), ["cadastro do cliente"])
})

Deno.test("emissao recusa cadastro incompleto antes de chamar o banco", () => {
  assertThrows(
    () =>
      montarPayloadEmissao({
        config: CONFIG,
        pagador: { ...PAGADOR, bairro: "" },
        titulo: {
          nosso_numero: 1, seu_numero: "1", uso_beneficiario: "1", valor: 50,
          vencimento: "2026-09-01", data_emissao: "2026-08-14",
        },
        etapa: "efetivacao",
      }),
    Error,
    "bairro",
  )
})

Deno.test("lerRespostaEmissao acha os campos com ou sem envelope data", () => {
  const corpo = {
    data: {
      id_boleto: "81610015315310920000002",
      dado_boleto: {
        dados_individuais_boleto: [{
          numero_nosso_numero: "00000001",
          codigo_barras: "34191942700000300001570000796551500572639000",
          numero_linha_digitavel: "34191570070079655150505726390007194270000030000",
        }],
      },
    },
  }
  assertEquals(lerRespostaEmissao(corpo), {
    id_boleto: "81610015315310920000002",
    nosso_numero: "00000001",
    codigo_barras: "34191942700000300001570000796551500572639000",
    linha_digitavel: "34191570070079655150505726390007194270000030000",
    pix_copia_cola: null,
  })
  assertEquals(lerRespostaEmissao(corpo.data).id_boleto, "81610015315310920000002")
  assertEquals(lerRespostaEmissao({}).id_boleto, null)
})

Deno.test("lerNotificacoes le o exemplo de webhook do Itau (camelCase)", () => {
  const corpo = {
    boletos: [{
      dataNotificacao: "2022-07-27",
      tipoLiquidacao: "95",
      idBoleto: "139bbd22-a164-4128-bb2d-8ef1e22e1213",
      numeroNossoNumero: "00007965",
      valorTitulo: "300.00",
      valorPagoTotalCobranca: "300.00",
      valorCreditado: null,
      dataCredito: "2022-03-31",
    }],
  }
  assertEquals(lerNotificacoes(corpo), [{
    id_boleto: "139bbd22-a164-4128-bb2d-8ef1e22e1213",
    nosso_numero: "00007965",
    seu_numero: null,
    valor_pago: 300,
    data_credito: "2022-03-31",
    data_notificacao: "2022-07-27",
    tipo_liquidacao: "95",
  }])
  assertEquals(lerNotificacoes({}), [])
  assertEquals(lerNotificacoes(null), [])
})

Deno.test("textoItau tira acento e travessao — o caso real recusado pelo Itau", () => {
  // Resposta do banco em 03/09: "possui caracteres especiais nao aceitos".
  assertEquals(textoItau("Honorários — 7 Holding Ltda", 25), "Honorarios - 7 Holding Lt")
  assertEquals(textoItau("Juçara Augustini", 50), "Jucara Augustini")
  assertEquals(textoItau("Rua Cândido Xavier, 602 — Água Verde", 45), "Rua Candido Xavier, 602 - Agua Verde")
})

Deno.test("textoItau corta depois de limpar e nao deixa espaco duplo", () => {
  assertEquals(textoItau("  Honorários   advocatícios  ", 100), "Honorarios advocaticios")
  assertEquals(textoItau("Nota nº 12 (setembro/2026)", 100), "Nota n 12 setembro/2026")
  assertEquals(textoItau(null, 10), "")
})
