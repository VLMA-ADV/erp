-- Backstop de defesa em profundidade: liga RLS nas 11 tabelas de finance/contracts
-- que ainda estavam com RLS desligado. NÃO adiciona policies de propósito: o app
-- acessa essas tabelas só via service_role (edges) e SECURITY DEFINER (RPCs), que
-- têm BYPASSRLS; anon/authenticated não têm USAGE nesses schemas. Logo, RLS on +
-- 0 policies = deny-all apenas para quem já estava barrado (nenhuma perda de acesso).
--
-- Não usa FORCE ROW LEVEL SECURITY: o dono da tabela e roles com BYPASSRLS
-- continuam passando. Mesmo estado que casos/contratos/lancamentos já têm em prod.
--
-- Reversível: ALTER TABLE ... DISABLE ROW LEVEL SECURITY.

ALTER TABLE contracts.caso_parcela_conciliacao     ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.reajuste_log                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.solicitacoes_contrato        ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.billing_batches                ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.billing_item_audit             ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.billing_items                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.billing_notes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.plano_contas                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.revisao_fatura_itens_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.tenant_counters                ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.tenant_focus_nfe_config        ENABLE ROW LEVEL SECURITY;
