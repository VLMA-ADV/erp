# Guia de Teste - Redefinição de Senha no Localhost

Este guia explica como testar o fluxo completo de redefinição de senha no ambiente local.

## 📋 Pré-requisitos

1. **Variáveis de ambiente configuradas**
   - Certifique-se de que o arquivo `.env.local` existe na raiz do projeto
   - Deve conter:
     ```env
     NEXT_PUBLIC_SUPABASE_URL=https://xwubxpcixxwfoduwyzmo.supabase.co
     NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anon_aqui
     ```

2. **Configuração no Supabase Dashboard**
   - Acesse: https://supabase.com/dashboard/project/xwubxpcixxwfoduwyzmo/auth/url-configuration
   - Em **Redirect URLs**, adicione:
     ```
     http://localhost:3000/redefinir-senha
     ```
   - Em **Site URL**, certifique-se de que está configurado como:
     ```
     http://localhost:3000
     ```
   - Clique em **Save**

3. **Usuário de teste criado**
   - Você precisa ter um usuário cadastrado no Supabase Auth
   - Pode criar via dashboard ou usar um existente

## 🚀 Passo a Passo para Testar

### 1. Iniciar o servidor de desenvolvimento

```bash
npm run dev
```

O servidor estará disponível em: `http://localhost:3000`

### 2. Acessar a página de recuperação de senha

1. Abra o navegador e acesse: `http://localhost:3000/recuperar-senha`
2. Digite o email de um usuário cadastrado no Supabase Auth
3. Clique em **"Enviar link de recuperação"**

### 3. Verificar o email

O Supabase enviará um email com o link de recuperação. O email contém:
- Um link com o formato: `http://localhost:3000/redefinir-senha?code=XXXXX&email=usuario@email.com`

### 4. Acessar o link de recuperação

1. **Opção 1: Usar o link do email**
   - Clique no link recebido por email
   - O navegador abrirá a página de redefinição de senha

2. **Opção 2: Copiar o código manualmente** (para debug)
   - Copie o código (`code=XXXXX`) da URL do email
   - Acesse: `http://localhost:3000/redefinir-senha?code=XXXXX&email=usuario@email.com`
   - Substitua `XXXXX` pelo código real e `usuario@email.com` pelo email usado

### 5. Redefinir a senha

1. Na página de redefinição, você verá dois campos:
   - **Nova Senha**: Digite uma nova senha (mínimo 8 caracteres, com maiúsculas, minúsculas e números)
   - **Confirmar Senha**: Digite a mesma senha novamente

2. Clique em **"Redefinir Senha"**

3. Se tudo estiver correto, você será redirecionado para: `http://localhost:3000/login?passwordReset=success`

### 6. Testar o login com a nova senha

1. Acesse: `http://localhost:3000/login`
2. Digite o email e a **nova senha** que você acabou de definir
3. Clique em **"Entrar"**
4. Você deve conseguir fazer login com sucesso

## 🔍 Debug e Verificação

### Abrir o Console do Navegador

1. Pressione `F12` ou `Cmd+Option+I` (Mac) / `Ctrl+Shift+I` (Windows/Linux)
2. Vá para a aba **Console**
3. Você verá logs como:
   - `Recovery session created successfully: [user-id]`
   - `Session confirmed saved: [user-id]`
   - `Current session before update: [user-id]`
   - `Updating password for user: [user-id]`

### Verificar a Aba Network

1. No DevTools, vá para a aba **Network** (Rede)
2. Filtre por **Fetch/XHR**
3. Você verá as requisições:
   - `verify` - Verificação do OTP
   - `token` - Criação da sessão
   - `user` - Atualização da senha

### Verificar Cookies

1. No DevTools, vá para **Application** > **Cookies** > `http://localhost:3000`
2. Procure por cookies do Supabase:
   - `sb-xxxxx-auth-token`
   - `sb-xxxxx-auth-token-code-verifier`

## ⚠️ Problemas Comuns e Soluções

### Problema 1: "Link inválido ou expirado"

**Causa:** O código de recovery expirou (geralmente após 1 hora)

**Solução:**
- Solicite um novo link de recuperação
- Use o link imediatamente após receber

### Problema 2: "Token has expired or is invalid"

**Causa:** O código foi usado ou expirou

**Solução:**
- Cada código só pode ser usado uma vez
- Solicite um novo link se necessário

### Problema 3: Erro 404 no endpoint `/auth/v1/token`

**Causa:** Configuração incorreta do Supabase ou problema com PKCE

**Solução:**
- Verifique se as variáveis de ambiente estão corretas
- Certifique-se de que o `redirectTo` está configurado corretamente no Supabase

### Problema 4: Sessão não encontrada ao atualizar senha

**Causa:** A sessão de recovery não foi criada ou não foi persistida

**Solução:**
- Verifique os logs no console
- O código tenta re-verificar o OTP automaticamente
- Se persistir, limpe os cookies e tente novamente

### Problema 5: Email não recebido

**Causa:** Email pode estar na pasta de spam ou configuração de email do Supabase

**Solução:**
- Verifique a pasta de spam
- No Supabase Dashboard, verifique os logs de email em **Authentication** > **Logs**
- Para desenvolvimento, você pode usar o email de teste do Supabase

## 🧪 Teste Rápido (Sem Email)

Se você quiser testar sem depender do email, pode usar a API do Supabase diretamente:

1. **Obter o código de recovery manualmente:**
   ```bash
   curl -X POST 'https://xwubxpcixxwfoduwyzmo.supabase.co/auth/v1/recover' \
     -H "apikey: SUA_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "email": "seu@email.com",
       "redirect_to": "http://localhost:3000/redefinir-senha"
     }'
   ```

2. **Verificar os logs do Supabase:**
   - Acesse: https://supabase.com/dashboard/project/xwubxpcixxwfoduwyzmo/auth/logs
   - Procure pelo email enviado e copie o código da URL

## 📝 Checklist de Teste

- [ ] Servidor rodando em `http://localhost:3000`
- [ ] Variáveis de ambiente configuradas
- [ ] Redirect URL configurado no Supabase
- [ ] Email de recuperação recebido
- [ ] Link de recuperação acessado
- [ ] Página de redefinição carregada sem erros
- [ ] Nova senha definida com sucesso
- [ ] Login com nova senha funcionando

## 🎯 Resultado Esperado

Ao final do teste, você deve:
1. ✅ Receber o email de recuperação
2. ✅ Acessar o link e ver a página de redefinição
3. ✅ Definir uma nova senha com sucesso
4. ✅ Ser redirecionado para a página de login
5. ✅ Conseguir fazer login com a nova senha

## 💡 Dicas

- **Use um email real** que você tenha acesso para receber o link
- **Teste rapidamente** após receber o email (códigos expiram em 1 hora)
- **Mantenha o console aberto** para ver os logs em tempo real
- **Limpe os cookies** entre testes se necessário
- **Use senhas fortes** que atendam aos requisitos (8+ caracteres, maiúsculas, minúsculas, números)
