// Helper function for creating audit logs in Edge Functions
// Reusable across all Edge Functions

import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

interface AuditLogParams {
  supabase: SupabaseClient;
  tenantId: string;
  tipoEntidade: string;
  entidadeId: string;
  acao: 'create' | 'update' | 'delete';
  userId: string;
  dadosAnteriores?: any;
  dadosNovos?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Cria um audit log usando a função RPC create_audit_log
 * Trata erros silenciosamente mas loga para debug
 */
export async function createAuditLog(params: AuditLogParams): Promise<string | null> {
  const {
    supabase,
    tenantId,
    tipoEntidade,
    entidadeId,
    acao,
    userId,
    dadosAnteriores = null,
    dadosNovos = null,
    ipAddress = null,
    userAgent = null,
  } = params;

  try {
    const { data: auditLogId, error } = await supabase.rpc('create_audit_log', {
      p_tenant_id: tenantId,
      p_tipo_entidade: tipoEntidade,
      p_entidade_id: entidadeId,
      p_acao: acao,
      p_user_id: userId,
      p_dados_anteriores: dadosAnteriores ? JSON.stringify(dadosAnteriores) : null,
      p_dados_novos: dadosNovos ? JSON.stringify(dadosNovos) : null,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
    });

    if (error) {
      console.error('Error creating audit log:', error);
      // Não falhar a operação principal se audit log falhar
      return null;
    }

    return auditLogId;
  } catch (error) {
    console.error('Unexpected error creating audit log:', error);
    // Não falhar a operação principal se audit log falhar
    return null;
  }
}

/**
 * Extrai IP address do request
 */
export function getIpAddress(req: Request): string | null {
  // Tentar pegar do header X-Forwarded-For (comum em proxies)
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // Pegar o primeiro IP da lista (IP original do cliente)
    return forwardedFor.split(',')[0].trim();
  }

  // Tentar pegar do header X-Real-IP
  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Se não encontrar, retornar null
  return null;
}

/**
 * Extrai User-Agent do request
 */
export function getUserAgent(req: Request): string | null {
  return req.headers.get('user-agent');
}
