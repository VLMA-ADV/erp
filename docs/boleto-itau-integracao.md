# Boleto Itaú — o que já está pronto e o que falta

Situação em 14/08/2026.

## O que esta entrega cobre

| Peça | Onde | Testado |
|---|---|---|
| Tradução do lançamento para o formato do Itaú | `src/lib/itau/boleto-payload.ts` | 16 testes contra os exemplos oficiais |
| Autenticação do webhook (OAuth do nosso lado) | `src/lib/itau/webhook-auth.ts` | 8 testes |
| Cliente HTTP com mTLS | `src/lib/itau/client.ts` | **não** — depende do certificado |
| Tabelas, configuração e baixa automática | `supabase/migrations/20260814120000_boleto_itau_base.sql` | fluxo completo em transação com rollback |
| Rotas HTTP | `src/app/api/boletos/…` | caminhos de autenticação testados local |

Rodar os testes:

```bash
deno test --allow-env src/lib/itau/
```

## Por que a integração mora na Vercel e não numa edge function

O Itaú exige mTLS: a chamada precisa apresentar um certificado de cliente.
Isso depende de controlar o socket TLS, coisa que o `fetch` do runtime Deno das
edge functions do Supabase não expõe. O runtime Node da Vercel expõe, via
`https.request({ cert, key })`. O resto da integração fiscal (NFS-e) continua
nas edge functions; só a conversa com o banco ficou aqui, por causa disso.

## Variáveis de ambiente

Nenhum segredo entra no repositório nem em mensagem. São todas na Vercel
(Production + Preview), e o valor você põe direto lá.

### Credenciais que o Itaú nos dá

| Nome | O que é |
|---|---|
| `ITAU_CLIENT_ID` | client_id da credencial de cobrança |
| `ITAU_CLIENT_SECRET` | client_secret da mesma credencial |
| `ITAU_CERT_PEM` | certificado assinado, devolvido pelo Itaú a partir do CSR |
| `ITAU_KEY_PEM` | chave privada gerada junto com o CSR — **nunca sai de quem gerou** |
| `ITAU_AMBIENTE` | `producao` ou `homologacao` (padrão: `producao`) |

### Credenciais que nós criamos para o Itaú usar

O banco exige que o integrador exponha o próprio OAuth: no cadastro do webhook
informamos uma URL de token, um client_id e um client_secret, e o Itaú pega um
token nessa URL antes de notificar cada baixa.

| Nome | O que é |
|---|---|
| `ITAU_WEBHOOK_CLIENT_ID` | inventado por nós; vai no cadastro do webhook |
| `ITAU_WEBHOOK_CLIENT_SECRET` | idem — gerar aleatório, 32+ caracteres |
| `ITAU_WEBHOOK_TOKEN_SECRET` | chave que assina os tokens que emitimos; só nossa, não vai para o banco |

URLs para o cadastro do webhook no Itaú:

- `webhook_oauth_url`: `https://<domínio>/api/boletos/webhook/token`
- `webhook_url`: `https://<domínio>/api/boletos/webhook`

## O que ainda falta

**Do Itaú** — nada anda sem isto:

1. Token temporário novo. O que veio no pacote venceu em 02/06/2026, e é ele
   que autoriza o envio do CSR. Sem CSR não há certificado, sem certificado não
   há chamada.
2. `id_beneficiario` da conta de cobrança.
3. Confirmar carteira (109) e espécie do título para honorários advocatícios.
4. Faixa de nosso número liberada para a conta.
5. Ambiente de homologação: existe? qual URL?
6. Confirmar que `x-itau-apikey` é mesmo o `client_id` (é o que a coleção faz).
7. Confirmar os códigos de tipo de juros e de multa. A coleção manda
   `codigo_tipo_juros: 90` junto com um percentual, o que é ambíguo.
8. Habilitar o webhook de notificações para a credencial.
9. Boleto simples ou BoleCode (com Pix embutido).

**Do escritório** — as seis decisões. Todas já existem como configuração em
`finance.boleto_config`; responder é preencher um formulário, não refazer nada:

| Decisão | Padrão hoje |
|---|---|
| Multa por atraso | isenta |
| Juros por atraso | isento |
| Desconto por antecipação | desligado |
| Protesto | desligado |
| Negativação | desligada |
| Data limite de pagamento | sem limite |
| Quem entrega o boleto ao cliente | escritório (anexo no e-mail da fatura) |

Os padrões são deliberadamente conservadores: um boleto que cobra a menos é um
problema comercial; um que cobra juros que o cliente nunca combinou é um
problema jurídico.

**Do cadastro** — vale para NFS-e e para boleto: cerca de 38 dos 85 clientes
estão sem endereço completo. O boleto precisa de rua, bairro, cidade, UF e CEP
do pagador. `validarPagador()` diz exatamente o que falta em cada cadastro
antes de chamar o banco.

## O que falta construir depois que o certificado chegar

- Tela de configuração (`finance.boleto_config` já existe; falta o formulário).
- Botão de gerar boleto na fatura, e o anexo no e-mail.
- Cadastro do webhook no Itaú (uma chamada, feita uma vez).
- Uma emissão real em homologação, conferindo linha digitável e baixa.
