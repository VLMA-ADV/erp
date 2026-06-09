-- =====================================================================
-- TESTE DE EMISSÃO DE NFS-e — VLMA ERP
-- Rodar no Supabase Dashboard → SQL Editor (projeto xwubxpcixxwfoduwyzmo)
-- Tenant VLMA = d51463dd-a6b3-40e7-9488-854eba80a210
--
-- Ordem de uso:
--   1) Query 1 — escolher um contrato candidato (itens aprovados + tomador COMPLETO)
--   2) Emitir pela UI (Financeiro → Fluxo de Faturamento → botão "$"/Prévia)
--   3) Query 3 — conferir o resultado em billing_notes
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- QUERY 1 — CANDIDATOS À EMISSÃO
-- Contratos com billing_items aprovados + diagnóstico do tomador.
-- Escolha uma linha com itens_aprovados > 0 e tomador_status = 'COMPLETO'.
-- ─────────────────────────────────────────────────────────────────────
WITH base AS (
  SELECT
    ct.id                                                                   AS contrato_id,
    ct.numero                                                               AS contrato,
    ct.nome_contrato,
    cli.nome                                                                AS cliente,
    cli.cliente_estrangeiro,
    COUNT(bi.id)                                                            AS itens_aprovados,
    SUM(COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor, 0))::numeric(14,2) AS valor_total,
    NULLIF(regexp_replace(COALESCE(cli.cnpj, ''), '\D', '', 'g'), '')       AS doc_digits,
    cli.rua, cli.numero, cli.bairro, cli.cidade, cli.estado, cli.cep, cli.codigo_ibge
  FROM finance.billing_items bi
  JOIN contracts.contratos ct ON ct.id = bi.contrato_id
  JOIN crm.clientes cli       ON cli.id = ct.cliente_id
  WHERE bi.tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
    AND bi.status = 'aprovado'
  GROUP BY ct.id, ct.numero, ct.nome_contrato, cli.nome, cli.cliente_estrangeiro,
           cli.cnpj, cli.rua, cli.numero, cli.bairro, cli.cidade, cli.estado, cli.cep, cli.codigo_ibge
)
SELECT
  contrato, nome_contrato, cliente, itens_aprovados, valor_total,
  CASE
    WHEN length(doc_digits) IN (11, 14)
         AND rua IS NOT NULL AND cidade IS NOT NULL
         AND cep IS NOT NULL AND codigo_ibge IS NOT NULL
      THEN 'COMPLETO'
    ELSE 'INCOMPLETO'
  END AS tomador_status,
  -- o que falta, se INCOMPLETO:
  concat_ws(', ',
    CASE WHEN length(doc_digits) NOT IN (11,14) THEN 'doc(cnpj/cpf)' END,
    CASE WHEN rua IS NULL          THEN 'rua' END,
    CASE WHEN cidade IS NULL       THEN 'cidade' END,
    CASE WHEN cep IS NULL          THEN 'cep' END,
    CASE WHEN codigo_ibge IS NULL  THEN 'codigo_ibge' END
  ) AS faltando,
  length(doc_digits) AS doc_len,
  contrato_id
FROM base
ORDER BY (CASE WHEN length(doc_digits) IN (11,14) AND rua IS NOT NULL
               AND cidade IS NOT NULL AND cep IS NOT NULL AND codigo_ibge IS NOT NULL
          THEN 0 ELSE 1 END),   -- COMPLETO primeiro
         itens_aprovados DESC, valor_total DESC;


-- ─────────────────────────────────────────────────────────────────────
-- QUERY 2 — DETALHE DO TOMADOR DE UM CONTRATO (opcional)
-- Troque o contrato_id pelo escolhido na Query 1 para ver exatamente o
-- que vai pro bloco `tomador` do payload Focus NFe.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  cli.nome              AS razao_social,
  regexp_replace(COALESCE(cli.cnpj,''), '\D', '', 'g') AS doc,
  cli.email,
  cli.rua               AS logradouro,
  cli.numero, cli.complemento, cli.bairro,
  cli.codigo_ibge       AS codigo_municipio,
  cli.estado            AS uf,
  regexp_replace(COALESCE(cli.cep,''), '\D', '', 'g')  AS cep
FROM contracts.contratos ct
JOIN crm.clientes cli ON cli.id = ct.cliente_id
WHERE ct.tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
  AND ct.id = '<COLE_AQUI_O_contrato_id>';


-- ─────────────────────────────────────────────────────────────────────
-- QUERY 3 — RESULTADO DAS EMISSÕES (rodar DEPOIS de emitir pela UI)
-- Mostra as notas geradas. Após o deploy do fix, `tomador_enviado` = true
-- e `tomador_nome` preenchido confirmam que a correção funcionou.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  bn.created_at,
  ct.numero                                          AS contrato,
  bn.focus_ref,
  bn.focus_status,
  bn.status,
  bn.metadata->>'tomador_enviado'                    AS tomador_enviado,  -- aparece só após deploy do fix
  bn.metadata->'tomador'->>'razao_social'            AS tomador_nome,
  bn.metadata->'tomador'->'endereco'->>'codigo_municipio' AS tomador_ibge,
  bn.metadata->'focus_response'->>'status'           AS focus_resp_status,
  bn.metadata->'focus_response'                      AS focus_response_raw
FROM finance.billing_notes bn
LEFT JOIN contracts.contratos ct ON ct.id = bn.contrato_id
WHERE bn.tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
ORDER BY bn.created_at DESC
LIMIT 20;
