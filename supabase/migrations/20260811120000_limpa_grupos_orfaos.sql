-- Grupo sem lancamento nao existe: quando o faturamento e zerado, os itens
-- somem e o grupo ficava para tras, aparecendo em relatorio e ocupando espaco.
-- Limpa os atuais e evita que voltem.
DELETE FROM finance.billing_item_grupos g
 WHERE NOT EXISTS (
   SELECT 1 FROM finance.billing_items b
    WHERE b.grupo_id = g.grupo_id AND b.tenant_id = g.tenant_id
 );
