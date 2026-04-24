import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const part1 = fs.readFileSync(path.join(__dirname, "part1.sql"), "utf8");
const start = part1.indexOf("CREATE OR REPLACE FUNCTION public.update_revisao_fatura_item");
if (start < 0) throw new Error("update fn not found");
let body = part1.slice(start);

const oldBlock = `  IF p_payload ? 'horas_informadas'
    OR p_payload ? 'valor_informado'
    OR p_payload ? 'data_lancamento'
    OR p_payload ? 'responsavel_fluxo_id'
    OR v_snapshot_patch ? 'horas_informadas'
    OR v_snapshot_patch ? 'valor_informado'
    OR v_snapshot_patch ? 'data_lancamento'
    OR v_snapshot_patch ? 'responsavel_fluxo_id'
  THEN
    RAISE EXCEPTION 'Campo imutável: não é permitido alterar horas_informadas, valor_informado, data de lançamento ou responsável do fluxo via este endpoint';
  END IF;

`;

const newBlock = `  PERFORM public._enforce_imutable_fields(p_payload);

`;

if (!body.includes(oldBlock)) throw new Error("immutable block not found");
body = body.replace(oldBlock, newBlock);

const helper = `-- RF-071 Z-2: helper — validação de campos imutáveis no payload de revisão de fatura.
CREATE OR REPLACE FUNCTION public._enforce_imutable_fields(p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_snapshot_patch jsonb := COALESCE(p_payload->'snapshot_patch', '{}'::jsonb);
BEGIN
  IF p_payload ? 'horas_informadas'
    OR p_payload ? 'valor_informado'
    OR p_payload ? 'data_lancamento'
    OR p_payload ? 'responsavel_fluxo_id'
    OR v_snapshot_patch ? 'horas_informadas'
    OR v_snapshot_patch ? 'valor_informado'
    OR v_snapshot_patch ? 'data_lancamento'
    OR v_snapshot_patch ? 'responsavel_fluxo_id'
  THEN
    RAISE EXCEPTION 'Campo imutável: não é permitido alterar horas_informadas, valor_informado, data de lançamento ou responsável do fluxo via este endpoint';
  END IF;
END;
$function$;

`;

const out = path.join(__dirname, "..", "..", "supabase", "migrations", "20260416130002_rf071_revisao_fatura_rpc_update.sql");
fs.writeFileSync(out, helper + body, "utf8");
console.log("wrote", out, fs.statSync(out).size);
