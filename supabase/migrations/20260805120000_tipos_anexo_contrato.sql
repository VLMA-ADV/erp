-- CT2 · Tipos de anexo no contrato (pedido Filipe 04/08).
-- Lista fixa confirmada pelo cliente: proposta assinada, contrato assinado,
-- aceite da proposta e cadeia de e-mail. 'outro' cobre o que nao se encaixa.
--
-- Coluna NULA de proposito: os 34 anexos que ja existem ficam sem tipo em vez
-- de receberem um palpite errado. Na tela aparecem como "Sem tipo".

ALTER TABLE contracts.contrato_anexos
  ADD COLUMN IF NOT EXISTS tipo text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contrato_anexos_tipo_check'
  ) THEN
    ALTER TABLE contracts.contrato_anexos
      ADD CONSTRAINT contrato_anexos_tipo_check
      CHECK (tipo IS NULL OR tipo IN (
        'proposta_assinada', 'contrato_assinado', 'aceite_proposta',
        'cadeia_email', 'outro'
      ));
  END IF;
END $$;

-- A assinatura ganha p_tipo no fim, com default, para a edge function que ja
-- esta publicada seguir chamando com 6 argumentos sem quebrar.
DROP FUNCTION IF EXISTS public.create_contrato_anexo(uuid, uuid, character varying, character varying, character varying, text);

CREATE OR REPLACE FUNCTION public.create_contrato_anexo(
  p_user_id uuid,
  p_contrato_id uuid,
  p_nome character varying,
  p_arquivo_nome character varying,
  p_mime_type character varying,
  p_arquivo_base64 text,
  p_tipo text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
  v_data bytea;
  v_tipo text;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao associado a tenant';
  END IF;

  IF COALESCE(trim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Nome do anexo e obrigatorio';
  END IF;

  IF COALESCE(trim(p_arquivo_nome), '') = '' THEN
    RAISE EXCEPTION 'Arquivo e obrigatorio';
  END IF;

  IF COALESCE(trim(p_arquivo_base64), '') = '' THEN
    RAISE EXCEPTION 'Conteudo do arquivo e obrigatorio';
  END IF;

  v_tipo := NULLIF(trim(COALESCE(p_tipo, '')), '');
  IF v_tipo IS NOT NULL AND v_tipo NOT IN (
    'proposta_assinada', 'contrato_assinado', 'aceite_proposta',
    'cadeia_email', 'outro'
  ) THEN
    RAISE EXCEPTION 'Tipo de anexo invalido: %', v_tipo;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM contracts.contratos c
    WHERE c.id = p_contrato_id AND c.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Contrato nao encontrado';
  END IF;

  v_data := decode(p_arquivo_base64, 'base64');

  INSERT INTO contracts.contrato_anexos (
    tenant_id, contrato_id, nome, arquivo_nome, mime_type,
    tamanho_bytes, arquivo, created_by, tipo
  ) VALUES (
    v_tenant_id, p_contrato_id, p_nome, p_arquivo_nome, p_mime_type,
    octet_length(v_data), v_data, p_user_id, v_tipo
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_contrato(p_user_id uuid, p_contrato_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT jsonb_build_object(
    'contrato', jsonb_build_object(
      'id', c.id,
      'numero', c.numero,
      'cliente_id', c.cliente_id,
      'cliente_nome', cli.nome,
      'nome_contrato', c.nome_contrato,
      'regime_fiscal', c.regime_fiscal,
      'forma_entrada', c.forma_entrada,
      'responsavel_prospeccao_id', c.responsavel_prospeccao_id,
      'canal_prospeccao', c.canal_prospeccao,
      'grupo_imposto_id', c.grupo_imposto_id,
      'grupo_imposto_nome', gi.nome,
      'servico_id', c.servico_id,
      'produto_id', c.produto_id,
      'status', c.status,
      'created_at', c.created_at,
      'updated_at', c.updated_at
    ),
    'anexos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'nome', a.nome,
        'arquivo_nome', a.arquivo_nome,
        'tipo', a.tipo,
        'mime_type', a.mime_type,
        'tamanho_bytes', a.tamanho_bytes,
        'created_at', a.created_at
      ) ORDER BY a.created_at DESC)
      FROM contracts.contrato_anexos a
      WHERE a.contrato_id = c.id
    ), '[]'::jsonb),
    'casos', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', cs.id,
          'numero', cs.numero,
          'parte_de_carteira_id', cs.parte_de_carteira_id,
          'processos_carteira_count', (
            SELECT COUNT(*) FROM contracts.casos f WHERE f.parte_de_carteira_id = cs.id
          ),
          'polo', cs.polo,
          'nome', cs.nome,
          'observacao', cs.observacao,
          'servico_id', cs.servico_id,
          'servico_nome', srv.nome,
          'produto_id', cs.produto_id,
          'responsavel_id', cs.responsavel_id,
          'moeda', cs.moeda,
          'tipo_cobranca_documento', cs.tipo_cobranca_documento,
          'data_inicio_faturamento', cs.data_inicio_faturamento,
          'dia_inicio_faturamento', COALESCE(cs.dia_inicio_faturamento, EXTRACT(DAY FROM cs.data_inicio_faturamento)::integer),
          'pagamento_dia_mes', cs.pagamento_dia_mes,
          'inicio_vigencia', cs.inicio_vigencia,
          'periodo_reajuste', cs.periodo_reajuste,
          'data_proximo_reajuste', cs.data_proximo_reajuste,
          'data_ultimo_reajuste', cs.data_ultimo_reajuste,
          'indice_reajuste', cs.indice_reajuste,
          'regra_cobranca', cs.regra_cobranca,
          'regra_cobranca_config', cs.regra_cobranca_config,
          'regras_financeiras', COALESCE(cs.regras_financeiras, '[]'::jsonb),
          'centro_custo_rateio', cs.centro_custo_rateio,
          'pagadores_servico', cs.pagadores_servico,
          'despesas_config', cs.despesas_config,
          'pagadores_despesa', cs.pagadores_despesa,
          'timesheet_config', cs.timesheet_config,
          'indicacao_config', cs.indicacao_config,
          'status', cs.status,
          'ativo', (cs.status <> 'inativo'),
          'anexos', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', ca.id,
              'nome', ca.nome,
              'arquivo_nome', ca.arquivo_nome,
              'mime_type', ca.mime_type,
              'tamanho_bytes', ca.tamanho_bytes,
              'created_at', ca.created_at
            ) ORDER BY ca.created_at DESC)
            FROM contracts.caso_anexos ca
            WHERE ca.caso_id = cs.id
          ), '[]'::jsonb)
        )
        ORDER BY cs.created_at DESC
      )
      FROM contracts.casos cs
      LEFT JOIN operations.categorias_servico srv ON srv.id = cs.servico_id
      WHERE cs.contrato_id = c.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM contracts.contratos c
  JOIN crm.clientes cli ON cli.id = c.cliente_id
  LEFT JOIN contracts.grupos_impostos gi ON gi.id = c.grupo_imposto_id AND gi.tenant_id = c.tenant_id
  WHERE c.id = p_contrato_id AND c.tenant_id = v_tenant_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  RETURN v_result;
END;
$function$;
