-- =====================================================================
-- PJ Nacional e PF Nacional: preencher os códigos fiscais
--
-- Filipe travou ao emitir, 20/08 às 02:23: "Grupo de impostos do contrato
-- incompleto para NFS-e. Falta: código de tributação nacional do ISS, código
-- NBS, alíquota de ISS."
--
-- São os dois grupos que cobrem quase tudo: PJ Nacional em 396 contratos e
-- PF Nacional em 87. Sem eles nenhuma nota sai.
--
-- DE ONDE VÊM OS NÚMEROS — não foram inventados. O próprio escritório já
-- cadastrou um grupo completo e correto, chamado "Advocacia Curitiba (NFSe
-- Nacional)", com ISS 3,50%, código de tributação nacional 171401 e NBS
-- 113012000. Ele está com zero contratos: foi configurado e nunca ligado.
--
-- Os códigos batem com o serviço:
--   * 171401 = item 17.14 da lista da LC 116/2003, que é ADVOCACIA;
--   * NBS 1.1301 = serviços jurídicos.
--
-- E os outros dois grupos preenchidos do sistema ("PJ sem mínimo" e "IRRF sem
-- mínimo") usam 130501, que é o item 13.05 — composição gráfica, fotocomposição,
-- clicheria. Não é advocacia; parecem cópia de um modelo. Por isso a referência
-- aqui é o grupo de advocacia, e não eles.
--
-- O QUE FICA PARA O CONTADOR CONFIRMAR: a ALÍQUOTA. Copiei os 3,50% do grupo
-- que o escritório montou, mas há indício de que a sociedade recolha ISS por
-- valor fixo (é sociedade de advogados) — o emit-nfse até trata alíquota zero
-- como válida por causa disso. Os dois códigos são seguros; a alíquota é o
-- único número que vale bater antes de emitir em volume.
--
-- Não toco em "Estrangeiro" (6 contratos): serviço exportado tem tratamento
-- próprio de ISS e merece decisão à parte.
-- =====================================================================

UPDATE contracts.grupos_impostos g
SET aliquota_iss = COALESCE(g.aliquota_iss, ref.aliquota_iss),
    codigo_tributacao_nacional_iss = COALESCE(g.codigo_tributacao_nacional_iss, ref.codigo_tributacao_nacional_iss),
    codigo_nbs = COALESCE(g.codigo_nbs, ref.codigo_nbs),
    updated_at = now()
FROM (
  SELECT aliquota_iss, codigo_tributacao_nacional_iss, codigo_nbs
  FROM contracts.grupos_impostos
  WHERE nome = 'Advocacia Curitiba (NFSe Nacional)'
  LIMIT 1
) ref
WHERE g.nome IN ('PJ Nacional', 'PF Nacional')
  AND (g.aliquota_iss IS NULL
    OR g.codigo_tributacao_nacional_iss IS NULL
    OR g.codigo_nbs IS NULL);

-- ---------------------------------------------------------------------
-- Contrato brasileiro parado no grupo "Estrangeiro"
--
-- O caso em que o Filipe travou (Vox Haus Serviço de Produção Musical LTDA)
-- não era falta de configuração: o contrato estava no grupo "Estrangeiro",
-- que de propósito não tem ISS preenchido — serviço exportado tem tratamento
-- próprio.
--
-- Só que a Vox Haus não é estrangeira: cliente_estrangeiro = false, CNPJ
-- 24.697.414/0001-80, Porto Alegre/RS. Os outros cinco contratos do grupo são
-- de verdade (Billor Holding LLC, CS Holdings em George Town, Tern Capital
-- INC, The Small Market) e continuam onde estão.
--
-- A regra abaixo corrige por CRITÉRIO, não por nome: contrato no grupo
-- Estrangeiro cujo cliente não está marcado como estrangeiro E tem CNPJ
-- brasileiro volta para PJ Nacional. Hoje isso atinge uma linha só.
-- ---------------------------------------------------------------------
UPDATE contracts.contratos ct
SET grupo_imposto_id = (SELECT id FROM contracts.grupos_impostos WHERE nome = 'PJ Nacional' LIMIT 1),
    updated_at = now()
WHERE ct.grupo_imposto_id = (SELECT id FROM contracts.grupos_impostos WHERE nome = 'Estrangeiro' LIMIT 1)
  AND EXISTS (
    SELECT 1 FROM crm.clientes cl
    WHERE cl.id = ct.cliente_id
      AND COALESCE(cl.cliente_estrangeiro, false) = false
      AND length(regexp_replace(COALESCE(cl.cnpj, ''), '\D', '', 'g')) = 14
  );
