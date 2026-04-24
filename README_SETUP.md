# Configuração do Projeto ERP-VLMA

## 1. Configurar Variáveis de Ambiente

1. Copie o arquivo `.env.example` para `.env`:
```bash
cp .env.example .env
```

2. Obtenha as credenciais do Supabase:
   - Acesse: https://supabase.com/dashboard/project/ozcsntxyvrajlmfcnddh/settings/api
   - Copie a **URL do projeto** e cole em `NEXT_PUBLIC_SUPABASE_URL`
   - Copie a **chave anon/public** e cole em `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Copie a **chave service_role** e cole em `SUPABASE_SERVICE_ROLE_KEY`

## 2. Instalar Dependências

```bash
npm install
```

## 3. Criar Usuários no Supabase Auth

Os colaboradores de teste já foram criados no banco de dados. Agora você precisa criar as contas correspondentes no Supabase Auth:

1. Acesse: https://supabase.com/dashboard/project/ozcsntxyvrajlmfcnddh/auth/users
2. Crie os seguintes usuários (ou use a API):

### Usuários de Teste Criados:

1. **João Silva** (Sócio)
   - Email: `joao.silva@teste.com`
   - Senha: `senha123` (ou qualquer senha de sua escolha)
   - Categoria: Sócio

2. **Maria Santos** (Advogado)
   - Email: `maria.santos@teste.com`
   - Senha: `senha123`
   - Categoria: Advogado
   - OAB: OAB/SP 123456

3. **Pedro Oliveira** (Administrativo)
   - Email: `pedro.oliveira@teste.com`
   - Senha: `senha123`
   - Categoria: Administrativo

4. **Ana Costa** (Estagiário)
   - Email: `ana.costa@teste.com`
   - Senha: `senha123`
   - Categoria: Estagiário

### Criar via API (opcional):

Você pode criar os usuários via API do Supabase usando o script abaixo ou diretamente no painel.

## 4. Executar o Projeto

```bash
npm run dev
```

O projeto estará disponível em: http://localhost:3000

## 5. Login

Use qualquer um dos emails acima com a senha configurada no Supabase Auth para fazer login.

## Notas Importantes

- A tabela `colaboradores_beneficios` existe e está funcionando corretamente
- Os colaboradores de teste já foram criados no banco de dados
- Você precisa criar as contas correspondentes no Supabase Auth para poder fazer login
- Os emails devem ser exatamente os mesmos entre a tabela `colaboradores` e o Supabase Auth
