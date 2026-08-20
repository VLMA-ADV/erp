# Registros de DNS para enviar como @vlma.com.br

Domínio criado no Resend em 20/08/2026, região `sa-east-1` (mesma do
`erp.vlma.com.br`, que já funciona). Status: **aguardando os registros abaixo**.

## Os três registros

Adicionar na zona de `vlma.com.br`. O campo "Nome" é relativo ao domínio —
alguns painéis pedem o nome completo (`send.vlma.com.br`), outros só o prefixo
(`send`).

| Tipo | Nome | Valor | Prioridade |
|---|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDnn2wjT61p5Oy6yDiu52do9SZz3Yo3R8LHcWcqECeNGvXK5f3TNFa7js4R11TWPyiXjq6jAUEMTTm7XTWPu6wYsQ8k9jfS3lRqcnnGcGJaerB+qJQ2P8/vh9vx8PkabKNZNE6pFM4lR6LuEsfZWybQ/DzetMwJs78vllvaI1szzQIDAQAB` | — |
| MX | `send` | `feedback-smtp.sa-east-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |

## Por que isto NÃO quebra o e-mail do escritório

Esta é a parte que costuma dar medo, então vale explicar.

O e-mail de vocês é Google Workspace, e o SPF do domínio hoje é:

```
v=spf1 a mx include:_spf.uni5.net include:_spf.google.com ~all
```

**Nenhum dos três registros toca nisso.** O SPF e o MX que o Resend pede ficam
no subdomínio `send.vlma.com.br`, que não existe hoje e não é usado por
ninguém — é só o endereço técnico de retorno das mensagens. O MX de
`vlma.com.br` continua apontando para o Google, e o SPF do domínio raiz fica
exatamente como está.

O terceiro registro, o DKIM, é um TXT novo num nome que também não existe
(`resend._domainkey`). O Google usa `google._domainkey`. Não colidem.

Resumindo: **não altere nem remova nada que já exista.** Só adicione os três.

## Depois de adicionar

A propagação costuma levar de minutos a poucas horas. Quando o Resend
verificar, o remetente das faturas passa de `financeiro@erp.vlma.com.br` para
o endereço que vocês escolherem em `@vlma.com.br` — é uma linha de código, sem
refazer nada.

## Sobre usar o endereço da Jessika como remetente

Funciona, mas vale a escolha consciente:

* **`jessika.lira@vlma.com.br`** — o cliente vê o nome dela. Pessoal, e boa
  para relacionamento. O custo é que a cobrança fica amarrada a uma pessoa: se
  ela sair de férias ou do escritório, o histórico com o cliente aponta para um
  endereço que ninguém acompanha.
* **`financeiro@vlma.com.br`** — impessoal, mas sobrevive a troca de pessoa, e
  a resposta cai numa caixa que mais de uma pessoa lê.

Dá para ter os dois: enviar de `financeiro@` e colocar o `reply-to` na Jessika.
O cliente responde e cai direto nela.
