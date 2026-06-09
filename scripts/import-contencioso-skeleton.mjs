#!/usr/bin/env node
/**
 * Import one-off — Contencioso Tributário (casos esqueleto, sem cobrança).
 *
 * Decisões (daily Filipe, jun/2026):
 *  - 1 linha = 1 caso; casos do mesmo cliente agrupam em 1 contrato.
 *  - Contrato nomeado "Contencioso Tributário — <Cliente>", grupo PJ Nacional.
 *  - Cliente casado por CPF/CNPJ (102). Sem documento → cria cliente novo (50).
 *  - Casos ESQUELETO: sem regra de cobrança / vencimento / vigência / reajuste.
 *    (o RPC create_caso tolera; exige só nome, status, polo p/ contencioso e natureza.)
 *
 * Uso:
 *   node scripts/import-contencioso-skeleton.mjs [casos.json] [--apply]
 *   (token em ~/.vlma_sb_token; dry-run por padrão)
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const TOKEN = readFileSync(homedir() + '/.vlma_sb_token', 'utf8').trim()
const REF = 'xwubxpcixxwfoduwyzmo'
const TENANT = 'd51463dd-a6b3-40e7-9488-854eba80a210'
const AUTHOR = 'bec1acd3-da50-4ce3-bdd0-af39729601c6' // lucas.carmo (admin) — autor dos registros
const GRUPO_PJ = '5c3b7da6-31a8-43e1-923d-cb944d5ad097'
const AREA_TRIBUTARIO = 'bff57def-945c-46a2-938b-403542bc58ef'
const RESP_LEONARDO = '96019f13-6c2f-4ed2-9d06-4405b66a00e2'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const jsonPath = args.find(a => !a.startsWith('--')) || '/tmp/casos_full.json'

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const b = await r.json(); if (!r.ok || b.message) throw new Error(b.message || r.status); return b
}
const norm = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase().replace(/\s+/g,' ')
const digits = s => (s||'').replace(/\D/g,'')
const esc = s => String(s).replace(/'/g, "''")

console.log(`Projeto ${REF} — ${APPLY ? '*** APPLY ***' : 'DRY-RUN'}\n`)

// ---- carga ----
const casos = JSON.parse(readFileSync(jsonPath, 'utf8'))
const base = await sql(`SELECT id, nome, COALESCE(cnpj,'') cnpj FROM crm.clientes WHERE tenant_id='${TENANT}'`)
const byDoc = new Map(base.filter(c => digits(c.cnpj)).map(c => [digits(c.cnpj), c]))
const byNome = new Map(base.map(c => [norm(c.nome), c]))
// contratos já existentes (idempotência: re-rodar não duplica)
const ctExist = await sql(`SELECT nome_contrato, cliente_id FROM contracts.contratos WHERE tenant_id='${TENANT}'`)
const contratoSet = new Set(ctExist.map(c => `${norm(c.nome_contrato)}|${c.cliente_id}`))

// ---- agrupa por cliente ----
const grupos = new Map() // key=norm(nome) -> {nome, doc, casos:[], cliente, novo}
for (const r of casos) {
  const k = norm(r.cliente_nome)
  if (!grupos.has(k)) grupos.set(k, { nome: r.cliente_nome, doc: r.doc, casos: [] })
  const g = grupos.get(k)
  if (r.doc && !g.doc) g.doc = r.doc
  g.casos.push(r)
}

const errors = [], warnings = []
let existentes = 0, novos = 0
for (const g of grupos.values()) {
  // resolve cliente
  if (g.doc && byDoc.has(g.doc)) { g.cliente = byDoc.get(g.doc); existentes++ }
  else {
    g.novo = true; novos++
    const hit = byNome.get(norm(g.nome))
    if (hit) warnings.push(`"${g.nome}" será criado novo, mas já existe cliente com esse nome (id ${hit.id}) — possível duplicata`)
  }
  // valida área/responsável por caso
  for (const c of g.casos) {
    if (norm(c.area) !== 'tributario') errors.push(`caso "${c.nome_caso}": área "${c.area}" != Tributário`)
    if (norm(c.responsavel) !== norm('Leonardo Pimentel da Silva Orth')) errors.push(`caso "${c.nome_caso}": responsável inesperado "${c.responsavel}"`)
    if (!c.nome_caso) errors.push(`cliente "${g.nome}": caso sem nome`)
    if (norm(c.polo) !== 'ativo') warnings.push(`caso "${c.nome_caso}": polo "${c.polo}"`)
  }
}

// ---- relatório ----
const totCasos = casos.length
console.log(`Clientes (contratos): ${grupos.size}  | Casos: ${totCasos}`)
console.log(`  clientes existentes (match por doc): ${existentes}`)
console.log(`  clientes NOVOS a criar (sem doc):    ${novos}`)
if (warnings.length) { console.log(`\n⚠️  WARNINGS (${warnings.length}):`); warnings.slice(0,20).forEach(w=>console.log('  '+w)); if(warnings.length>20)console.log(`  ...+${warnings.length-20}`) }
if (errors.length) { console.log(`\n❌ ERROS (${errors.length}):`); errors.slice(0,20).forEach(e=>console.log('  '+e)); process.exit(2) }

// monta payload de caso esqueleto
function casoPayload(c, clienteId) {
  return {
    nome: c.nome_caso,
    status: 'ativo',
    servico_id: AREA_TRIBUTARIO,
    responsavel_id: RESP_LEONARDO,
    moeda: 'real',
    tipo_cobranca_documento: 'nf',
    observacao: c.observacao || null,
    polo: 'ativo',
    possui_reajuste: false,
    regra_cobranca: '',
    regra_cobranca_config: { natureza_caso: 'contencioso' },
    indice_reajuste: 'nao_tem',
    periodo_reajuste: 'nao_tem',
    pagadores_servico: [{ cliente_id: clienteId, percentual: 100 }],
  }
}

if (!APPLY) {
  console.log(`\n--- amostra do plano (5 contratos) ---`)
  let i = 0
  for (const g of grupos.values()) {
    if (i++ >= 5) break
    console.log(`  Contencioso Tributário — ${g.nome} ${g.novo ? '[CRIAR CLIENTE]' : '[existente]'} | ${g.casos.length} caso(s)`)
  }
  console.log(`\nDry-run OK. ${novos} clientes a criar + ${grupos.size} contratos / ${totCasos} casos. Rode com --apply para gravar.`)
  process.exit(0)
}

// ---- APPLY ----
console.log(`\nCriando ${novos} clientes novos...`)
let okCli = 0
for (const g of grupos.values()) {
  if (!g.novo) continue
  try {
    const [row] = await sql(`SELECT public.create_cliente('${AUTHOR}'::uuid, '${esc(g.nome)}'::varchar) AS r`)
    g.cliente = { id: row.r.id || row.r.cliente_id || row.r, nome: g.nome }
    okCli++
  } catch (e) { console.log(`  ❌ cliente "${g.nome}": ${e.message}`) }
}
console.log(`  ${okCli}/${novos} clientes criados.`)

console.log(`\nCriando contratos...`)
let okCt = 0
let jaExistia = 0
for (const g of grupos.values()) {
  if (!g.cliente) { console.log(`  ⏭️  "${g.nome}" sem cliente_id — pulado`); continue }
  if (contratoSet.has(`${norm(`Contencioso Tributário — ${g.nome}`)}|${g.cliente.id}`)) { jaExistia++; continue }
  const payload = {
    cliente_id: g.cliente.id,
    nome_contrato: `Contencioso Tributário — ${g.nome}`,
    grupo_imposto_id: GRUPO_PJ,
    servico_id: AREA_TRIBUTARIO,
    status: 'ativo',
    casos: g.casos.map(c => casoPayload(c, g.cliente.id)),
  }
  try {
    const [row] = await sql(`SELECT public.create_contrato('${AUTHOR}'::uuid, '${esc(JSON.stringify(payload))}'::jsonb) AS r`)
    console.log(`  ✅ ${g.nome} → contrato ${row.r.numero || row.r.id}`)
    okCt++
  } catch (e) { console.log(`  ❌ ${g.nome}: ${e.message}`) }
}
console.log(`\n${okCt} contratos criados | ${jaExistia} já existiam (pulados) | total alvo ${grupos.size}.`)
process.exit((okCt + jaExistia) === grupos.size ? 0 : 3)
