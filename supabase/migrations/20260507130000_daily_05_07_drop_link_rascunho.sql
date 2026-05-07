-- Item 8 daily 2026-05-07: desvincular auto-criação de contrato em Solicitação.
-- Filipe quer ZERO auto-criação. Solicitação fica sem contrato algum até aprovação manual
-- (concluir_solicitacao_contrato já cria contrato 'rascunho' no momento do "Aprovar").
--
-- Remove o caminho RF-011 (link_contrato_rascunho_para_solicitacao). A coluna
-- contracts.solicitacoes_contrato.contrato_rascunho_id permanece (backward-compat;
-- todas as 7 linhas atuais estão NULL nessa coluna — verificado antes da migration).

DROP FUNCTION IF EXISTS public.link_contrato_rascunho_para_solicitacao(uuid, uuid);
