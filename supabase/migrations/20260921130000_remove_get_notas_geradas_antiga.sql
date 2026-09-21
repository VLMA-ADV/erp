-- A versao de maio (20260520010827) de get_notas_geradas, com 5 parametros,
-- continuava no banco ao lado da nova (7 parametros, 20260921120000). Duas
-- assinaturas com o mesmo nome deixam a chamada ambigua quando os ultimos
-- parametros sao omitidos. A edge sempre manda os 7, mas nao vale deixar a
-- armadilha armada.
DROP FUNCTION IF EXISTS public.get_notas_geradas(uuid, text, text, text, integer);
NOTIFY pgrst, 'reload schema';
