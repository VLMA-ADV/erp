-- Bucket colaboradores-fotos vai virar privado. Para que usuários LOGADOS ainda
-- consigam gerar signed URLs (ex.: avatar próprio no Timesheet, assinado no
-- client), é preciso uma policy de SELECT para o papel authenticated. O acesso
-- público (internet sem login) deixa de existir — que é justamente o objetivo.
-- As edges (service role) ignoram RLS e continuam assinando normalmente.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'auth_read_colaboradores_fotos'
  ) THEN
    CREATE POLICY "auth_read_colaboradores_fotos"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (bucket_id = 'colaboradores-fotos');
  END IF;
END $$;
