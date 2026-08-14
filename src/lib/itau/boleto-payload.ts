/**
 * Boleto Itau — traducao do lancamento a receber para o formato do banco.
 *
 * Este arquivo NAO fala com o Itau e nao le credencial nenhuma: e so a
 * montagem do payload e as validacoes que dao para fazer antes de chamar o
 * banco. Fica separado da edge function de proposito, porque e a parte que da
 * para testar sem certificado — e e justamente onde mora o risco, ja que o
 * Itau usa tres formatos numericos diferentes para a mesma ideia de
 * "porcentagem" e "valor".
 *
 * OS FORMATOS (conferidos contra a colecao Postman oficial "Boletos",
 * enviada pelo Itau em 14/08/2026):
 *
 *   emissao  POST /cash_management/v2/boletos
 *     valor_titulo      -> centavos, 17 digitos com zeros a esquerda
 *                          R$ 50,00  => "00000000000005000"
 *     percentual_multa  -> 12 digitos, 5 casas decimais implicitas
 *     percentual_juros     1,00%     => "000000100000"
 *
 *   alteracao  PATCH /cash_management/v2/boletos/{id}/juros (multa, desconto...)
 *     percentual_juros  -> string decimal com 5 casas: "15.00000"
 *     valor_multa       -> string decimal com 2 casas: "10.00"
 *
 * Ou seja: o MESMO campo percentual_juros tem representacao diferente na
 * emissao e na alteracao. Errar isso nao da erro de validacao obvio — da um
 * boleto com juros mil vezes maior ou menor do que o combinado, cobrado de um
 * cliente do escritorio. Por isso cada conversao aqui tem teste.
 */

// ---------------------------------------------------------------- formatos

/** Reais -> centavos em 17 digitos (emissao). R$ 50,00 => "00000000000005000" */
export function centavos17(valorReais: number): string {
  if (!Number.isFinite(valorReais) || valorReais < 0) {
    throw new Error(`valor invalido para boleto: ${valorReais}`)
  }
  // Math.round e obrigatorio: 0.1 + 0.2 em float da 0.30000000000000004, e
  // truncar centavo faz o boleto sair um centavo menor que a nota fiscal.
  const centavos = Math.round(valorReais * 100)
  const s = String(centavos)
  if (s.length > 17) throw new Error(`valor acima do limite do boleto: ${valorReais}`)
  return s.padStart(17, "0")
}

/** Percentual -> 12 digitos com 5 casas implicitas (emissao). 1% => "000000100000" */
export function percentual12(percentual: number): string {
  if (!Number.isFinite(percentual) || percentual < 0) {
    throw new Error(`percentual invalido: ${percentual}`)
  }
  const s = String(Math.round(percentual * 100000))
  if (s.length > 12) throw new Error(`percentual acima do limite: ${percentual}`)
  return s.padStart(12, "0")
}

/** Percentual -> decimal com 5 casas (alteracao/PATCH). 15% => "15.00000" */
export function percentual5(percentual: number): string {
  if (!Number.isFinite(percentual) || percentual < 0) {
    throw new Error(`percentual invalido: ${percentual}`)
  }
  return percentual.toFixed(5)
}

/** Reais -> decimal com 2 casas (alteracao/PATCH). 10 => "10.00" */
export function valor2(valorReais: number): string {
  if (!Number.isFinite(valorReais) || valorReais < 0) {
    throw new Error(`valor invalido: ${valorReais}`)
  }
  return valorReais.toFixed(2)
}

/** Nosso numero em 8 digitos, como no exemplo do Itau ("00000001"). */
export function nossoNumero8(numero: number | string): string {
  const d = String(numero).replace(/\D/g, "")
  if (!d.length) throw new Error("nosso numero vazio")
  if (d.length > 8) throw new Error(`nosso numero acima de 8 digitos: ${numero}`)
  return d.padStart(8, "0")
}

function somenteDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "")
}

/** Data em YYYY-MM-DD. Aceita Date ou string ja no formato. */
export function dataIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  throw new Error(`data invalida para boleto: ${v}`)
}

// ------------------------------------------------------------------ tipos

export interface BoletoJuros {
  /** "90" no exemplo do Itau, tanto na emissao quanto no PATCH. */
  codigo_tipo: string
  dias: number
  percentual_mes: number
}

export interface BoletoMulta {
  /** "01" = valor fixo, "02" = percentual (colecao Postman). */
  codigo_tipo: string
  dias: number
  percentual?: number
  valor?: number
}

export interface BoletoInstrucao {
  codigo: string
  dias_apos_vencimento: number
  dia_util: boolean
}

export interface BoletoConfig {
  id_beneficiario: string
  codigo_carteira: string
  codigo_especie: string
  juros: BoletoJuros | null
  multa: BoletoMulta | null
  instrucoes: BoletoInstrucao[]
  /** "01" no exemplo; null omite o bloco. */
  recebimento_divergente_codigo: string | null
  /** Dias apos o vencimento em que o boleto para de aceitar pagamento. */
  dias_limite_pagamento: number | null
  desconto_expresso: boolean
}

export interface BoletoPagador {
  nome: string
  /** "F" pessoa fisica, "J" juridica. */
  tipo: "F" | "J"
  documento: string
  logradouro: string
  bairro: string
  cidade: string
  uf: string
  cep: string
}

export interface BoletoTitulo {
  nosso_numero: number | string
  /** Referencia do escritorio que volta no webhook (usamos o id do lancamento). */
  seu_numero: string
  uso_beneficiario: string
  valor: number
  vencimento: string
  data_emissao: string
}

export interface EmissaoInput {
  config: BoletoConfig
  pagador: BoletoPagador
  titulo: BoletoTitulo
  /**
   * "validacao" so confere o payload no Itau e nao registra nada — e o que a
   * tela usa no botao de conferir. "efetivacao" registra o boleto de verdade.
   */
  etapa: "validacao" | "efetivacao"
}

// ------------------------------------------------------------- validacoes

const UFS = new Set([
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
])

/**
 * O que falta no cadastro do cliente para ele poder receber boleto.
 *
 * Existe porque hoje boa parte dos clientes esta sem endereco completo, e o
 * erro do Itau nesse caso volta generico. Melhor dizer na tela "falta bairro e
 * CEP" antes de chamar o banco do que devolver "400 Bad Request" para quem
 * esta tentando cobrar.
 */
export function validarPagador(p: Partial<BoletoPagador> | null | undefined): string[] {
  const faltando: string[] = []
  if (!p) return ["cadastro do cliente"]
  if (!p.nome?.trim()) faltando.push("nome")

  const doc = somenteDigitos(p.documento)
  if (!doc) faltando.push("CPF/CNPJ")
  else if (p.tipo === "F" && doc.length !== 11) faltando.push("CPF com 11 digitos")
  else if (p.tipo === "J" && doc.length !== 14) faltando.push("CNPJ com 14 digitos")

  if (!p.logradouro?.trim()) faltando.push("rua")
  if (!p.bairro?.trim()) faltando.push("bairro")
  if (!p.cidade?.trim()) faltando.push("cidade")

  const uf = (p.uf ?? "").trim().toUpperCase()
  if (!uf) faltando.push("estado")
  else if (!UFS.has(uf)) faltando.push(`estado invalido (${p.uf})`)

  const cep = somenteDigitos(p.cep)
  if (!cep) faltando.push("CEP")
  else if (cep.length !== 8) faltando.push("CEP com 8 digitos")

  return faltando
}

/** Soma dias a uma data ISO sem passar por fuso (evita virar o dia). */
export function somarDias(dataIsoStr: string, dias: number): string {
  const [a, m, d] = dataIso(dataIsoStr).split("-").map(Number)
  const dt = new Date(Date.UTC(a, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + dias)
  return dt.toISOString().slice(0, 10)
}

// -------------------------------------------------------------- montagem

/**
 * Monta o corpo do POST /cash_management/v2/boletos.
 *
 * A estrutura (data > dado_boleto > dados_individuais_boleto[]) e o
 * aninhamento estranho de pessoa/tipo_pessoa vem tal e qual da colecao
 * oficial; nao e escolha nossa.
 */
export function montarPayloadEmissao(input: EmissaoInput): Record<string, unknown> {
  const { config, pagador, titulo, etapa } = input

  const faltando = validarPagador(pagador)
  if (faltando.length) {
    throw new Error(`Cadastro do cliente incompleto para boleto: ${faltando.join(", ")}.`)
  }

  const doc = somenteDigitos(pagador.documento)
  const tipoPessoa: Record<string, string> = { codigo_tipo_pessoa: pagador.tipo }
  if (pagador.tipo === "F") tipoPessoa.numero_cadastro_pessoa_fisica = doc
  else tipoPessoa.numero_cadastro_nacional_pessoa_juridica = doc

  const dadoBoleto: Record<string, unknown> = {
    descricao_instrumento_cobranca: "boleto",
    tipo_boleto: "a vista",
    codigo_carteira: config.codigo_carteira,
    codigo_especie: config.codigo_especie,
    // "000" e o que a colecao oficial envia quando nao ha abatimento. Nao e o
    // mesmo padding de 17 digitos do valor_titulo — mantido igual ao exemplo
    // de proposito, ate o Itau confirmar o layout deste campo.
    valor_abatimento: "000",
    data_emissao: dataIso(titulo.data_emissao),
    pagador: {
      pessoa: {
        nome_pessoa: pagador.nome.trim().slice(0, 50),
        tipo_pessoa: tipoPessoa,
      },
      endereco: {
        nome_logradouro: pagador.logradouro.trim().slice(0, 45),
        nome_bairro: pagador.bairro.trim().slice(0, 15),
        nome_cidade: pagador.cidade.trim().slice(0, 20),
        sigla_UF: pagador.uf.trim().toUpperCase(),
        numero_CEP: somenteDigitos(pagador.cep),
      },
    },
    dados_individuais_boleto: [
      {
        numero_nosso_numero: nossoNumero8(titulo.nosso_numero),
        data_vencimento: dataIso(titulo.vencimento),
        valor_titulo: centavos17(titulo.valor),
        texto_uso_beneficiario: titulo.uso_beneficiario,
        texto_seu_numero: titulo.seu_numero,
      },
    ],
    desconto_expresso: config.desconto_expresso,
  }

  if (config.multa) {
    const multa: Record<string, unknown> = {
      codigo_tipo_multa: config.multa.codigo_tipo,
      quantidade_dias_multa: config.multa.dias,
    }
    // "01" cobra valor fixo, "02" cobra percentual. Mandar o campo errado para
    // o codigo escolhido e recusado pelo banco.
    if (config.multa.codigo_tipo === "01") {
      multa.valor_multa = centavos17(config.multa.valor ?? 0)
    } else {
      multa.percentual_multa = percentual12(config.multa.percentual ?? 0)
    }
    dadoBoleto.multa = multa
  }

  if (config.juros) {
    dadoBoleto.juros = {
      // Numero, nao string, na emissao — a colecao manda 90 sem aspas aqui e
      // "90" com aspas no PATCH.
      codigo_tipo_juros: Number(config.juros.codigo_tipo),
      quantidade_dias_juros: config.juros.dias,
      percentual_juros: percentual12(config.juros.percentual_mes),
    }
  }

  if (config.recebimento_divergente_codigo) {
    dadoBoleto.recebimento_divergente = {
      codigo_tipo_autorizacao: config.recebimento_divergente_codigo,
    }
  }

  if (config.instrucoes.length) {
    dadoBoleto.instrucao_cobranca = config.instrucoes.map((i) => ({
      codigo_instrucao_cobranca: i.codigo,
      quantidade_dias_apos_vencimento: i.dias_apos_vencimento,
      dia_util: i.dia_util,
    }))
  }

  if (config.dias_limite_pagamento && config.dias_limite_pagamento > 0) {
    dadoBoleto.data_limite_pagamento = somarDias(titulo.vencimento, config.dias_limite_pagamento)
  }

  return {
    data: {
      etapa_processo_boleto: etapa,
      codigo_canal_operacao: "API",
      beneficiario: { id_beneficiario: config.id_beneficiario },
      dado_boleto: dadoBoleto,
    },
  }
}

// ------------------------------------------------------- retorno do banco

export interface BoletoRegistrado {
  id_boleto: string | null
  nosso_numero: string | null
  codigo_barras: string | null
  linha_digitavel: string | null
  pix_copia_cola: string | null
}

/**
 * Le a resposta da emissao. O Itau varia o nivel do envelope entre ambientes
 * (as vezes o corpo util vem em `data`, as vezes na raiz), entao procuramos os
 * campos nos dois lugares em vez de fixar um caminho.
 */
export function lerRespostaEmissao(resposta: unknown): BoletoRegistrado {
  const raiz = (resposta ?? {}) as Record<string, any>
  const d = (raiz.data ?? raiz) as Record<string, any>
  const individual = d?.dado_boleto?.dados_individuais_boleto?.[0] ?? {}

  const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v))

  return {
    id_boleto: str(d.id_boleto ?? d.dado_boleto?.id_boleto),
    nosso_numero: str(individual.numero_nosso_numero),
    codigo_barras: str(individual.codigo_barras ?? d.codigo_barras),
    linha_digitavel: str(individual.numero_linha_digitavel ?? d.numero_linha_digitavel),
    pix_copia_cola: str(d.dado_boleto?.pix?.pix_copia_e_cola ?? d.pix_copia_e_cola),
  }
}

/**
 * Uma notificacao do webhook, ja normalizada.
 *
 * Atencao ao detalhe: o webhook fala camelCase (numeroNossoNumero) enquanto a
 * API de emissao fala snake_case (numero_nosso_numero). Sao times diferentes
 * do banco; nao ha padrao unico a assumir.
 */
export interface NotificacaoBoleto {
  id_boleto: string | null
  nosso_numero: string | null
  seu_numero: string | null
  valor_pago: number | null
  data_credito: string | null
  data_notificacao: string | null
  tipo_liquidacao: string | null
}

export function lerNotificacoes(corpo: unknown): NotificacaoBoleto[] {
  const raiz = (corpo ?? {}) as Record<string, any>
  const lista = Array.isArray(raiz.boletos) ? raiz.boletos : []
  const num = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null
    const n = Number(String(v).replace(",", "."))
    return Number.isFinite(n) ? n : null
  }
  const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v))

  return lista.map((b: Record<string, any>) => ({
    id_boleto: str(b.idBoleto),
    nosso_numero: str(b.numeroNossoNumero),
    seu_numero: str(b.seuNumero ?? b.textoSeuNumero),
    valor_pago: num(b.valorPagoTotalCobranca ?? b.valorCreditado),
    data_credito: str(b.dataCredito),
    data_notificacao: str(b.dataNotificacao),
    tipo_liquidacao: str(b.tipoLiquidacao),
  }))
}
