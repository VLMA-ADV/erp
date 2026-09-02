-- =====================================================================
-- Trocar o revisor no caso propaga para os itens em faturamento
--
-- Filipe, 02/09: "pode manter essa regra como fixa daqui pra frente".
--
-- A exibicao ja passou a ler o caso (migracao anterior), mas o campo gravado no
-- item tambem da ACESSO — é por ele que "o responsavel reatribuido da etapa ve
-- o item mesmo de outro centro de custo". Sem propagar, a nova revisora
-- apareceria como responsavel e nao conseguiria abrir o item.
--
-- Gatilho em vez de mexer em update_caso: o revisor pode ser alterado por mais
-- de um caminho (tela do caso, importacao, correcao em massa) e todos passam
-- por aqui. Um so lugar para lembrar.
-- =====================================================================

CREATE OR REPLACE FUNCTION contracts._propaga_revisor_para_faturamento()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_revisor_antes uuid;
  v_revisor_depois uuid;
BEGIN
  -- Só reage quando o revisor MUDOU: qualquer outra edição do caso não deve
  -- custar um update em toda a fila de faturamento dele.
  SELECT col.user_id INTO v_revisor_depois
    FROM people.colaboradores col
   WHERE col.id = NULLIF(NEW.timesheet_config->'revisores'->0->>'colaborador_id','')::uuid
     AND col.tenant_id = NEW.tenant_id;

  IF TG_OP = 'UPDATE' THEN
    SELECT col.user_id INTO v_revisor_antes
      FROM people.colaboradores col
     WHERE col.id = NULLIF(OLD.timesheet_config->'revisores'->0->>'colaborador_id','')::uuid
       AND col.tenant_id = OLD.tenant_id;
    IF v_revisor_antes IS NOT DISTINCT FROM v_revisor_depois THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_revisor_depois IS NULL THEN
    RETURN NEW;
  END IF;

  -- Item cancelado fica como está: é histórico encerrado.
  UPDATE finance.billing_items bi
     SET responsavel_revisao_id = v_revisor_depois, updated_at = now()
   WHERE bi.caso_id = NEW.id
     AND bi.tenant_id = NEW.tenant_id
     AND bi.status <> 'cancelado'
     AND bi.responsavel_revisao_id IS DISTINCT FROM v_revisor_depois;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_propaga_revisor_faturamento ON contracts.casos;
CREATE TRIGGER trg_propaga_revisor_faturamento
  AFTER INSERT OR UPDATE OF timesheet_config ON contracts.casos
  FOR EACH ROW EXECUTE FUNCTION contracts._propaga_revisor_para_faturamento();
