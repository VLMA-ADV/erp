-- =====================================================================
-- BoleCode: chave Pix e liga/desliga na configuração de cobrança
--
-- Itaú confirmou em 16/09 que o CNPJ 14.491.612/0001-39 já tem escopo de
-- "API Recebimentos, Cobrança e Bolecode". Falta a nossa parte: guardar a
-- chave Pix da conta de cobrança e um interruptor.
--
-- Nasce DESLIGADO de proposito. Enquanto bolecode_ativo = false, o payload
-- enviado ao banco e exatamente o de hoje — nada muda para quem ja emite.
-- =====================================================================
ALTER TABLE finance.boleto_config
  ADD COLUMN IF NOT EXISTS chave_pix text,
  ADD COLUMN IF NOT EXISTS bolecode_ativo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN finance.boleto_config.chave_pix IS
  'Chave Pix da conta de cobrança, exigida pelo BoleCode (boleto com QR Code).';
COMMENT ON COLUMN finance.boleto_config.bolecode_ativo IS
  'Liga o bloco de Pix no payload do Itaú. Só depois de validado com o banco.';

-- bol_preparar devolve a config inteira (to_jsonb), entao os campos novos ja
-- chegam na rota de emissao sem mudar assinatura.
NOTIFY pgrst, 'reload schema';
