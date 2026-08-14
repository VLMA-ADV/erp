/** Rodar: deno test --allow-env src/lib/itau/webhook-auth.test.ts */
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1"
import {
  comparaSegura,
  credenciaisWebhookValidas,
  emitirTokenWebhook,
  tokenWebhookValido,
} from "./webhook-auth.ts"

const SEGREDO = "segredo-de-teste-nao-usado-em-lugar-nenhum"

function comAmbiente(vars: Record<string, string | undefined>, fn: () => void) {
  const antes: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    antes[k] = Deno.env.get(k)
    if (v === undefined) Deno.env.delete(k)
    else Deno.env.set(k, v)
  }
  try {
    fn()
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) Deno.env.delete(k)
      else Deno.env.set(k, v)
    }
  }
}

Deno.test("token emitido e aceito de volta", () => {
  comAmbiente({ ITAU_WEBHOOK_TOKEN_SECRET: SEGREDO }, () => {
    const t = emitirTokenWebhook()!
    assertEquals(t.token_type, "Bearer")
    assertEquals(t.expires_in, 3600)
    assert(tokenWebhookValido(`Bearer ${t.access_token}`))
  })
})

Deno.test("token expirado e recusado", () => {
  comAmbiente({ ITAU_WEBHOOK_TOKEN_SECRET: SEGREDO }, () => {
    const t = emitirTokenWebhook(Date.now() - 4000 * 1000)!
    assertFalse(tokenWebhookValido(`Bearer ${t.access_token}`))
  })
})

Deno.test("assinatura adulterada e recusada", () => {
  comAmbiente({ ITAU_WEBHOOK_TOKEN_SECRET: SEGREDO }, () => {
    const t = emitirTokenWebhook()!
    const [corpo, sig] = t.access_token.split(".")
    // Troca um caractere da assinatura.
    const outra = sig.slice(0, -1) + (sig.at(-1) === "A" ? "B" : "A")
    assertFalse(tokenWebhookValido(`Bearer ${corpo}.${outra}`))
    // Troca o corpo mantendo a assinatura antiga (tentativa de esticar o exp).
    const futuro = btoa(JSON.stringify({ exp: 9999999999, jti: "x" }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    assertFalse(tokenWebhookValido(`Bearer ${futuro}.${sig}`))
  })
})

Deno.test("token de outro segredo e recusado", () => {
  let alheio = ""
  comAmbiente({ ITAU_WEBHOOK_TOKEN_SECRET: "outro-segredo" }, () => {
    alheio = emitirTokenWebhook()!.access_token
  })
  comAmbiente({ ITAU_WEBHOOK_TOKEN_SECRET: SEGREDO }, () => {
    assertFalse(tokenWebhookValido(`Bearer ${alheio}`))
  })
})

Deno.test("sem segredo configurado nao emite nem aceita nada", () => {
  comAmbiente({ ITAU_WEBHOOK_TOKEN_SECRET: undefined }, () => {
    assertEquals(emitirTokenWebhook(), null)
    assertFalse(tokenWebhookValido("Bearer qualquer.coisa"))
  })
})

Deno.test("cabecalho malformado e recusado", () => {
  comAmbiente({ ITAU_WEBHOOK_TOKEN_SECRET: SEGREDO }, () => {
    assertFalse(tokenWebhookValido(null))
    assertFalse(tokenWebhookValido(""))
    assertFalse(tokenWebhookValido("Basic abc"))
    assertFalse(tokenWebhookValido("Bearer semponto"))
  })
})

Deno.test("credenciais do webhook conferidas contra o ambiente", () => {
  comAmbiente(
    { ITAU_WEBHOOK_CLIENT_ID: "vlma-erp", ITAU_WEBHOOK_CLIENT_SECRET: "s3nh4" },
    () => {
      assert(credenciaisWebhookValidas("vlma-erp", "s3nh4"))
      assertFalse(credenciaisWebhookValidas("vlma-erp", "errada"))
      assertFalse(credenciaisWebhookValidas("outro", "s3nh4"))
      assertFalse(credenciaisWebhookValidas("", ""))
    },
  )
  comAmbiente({ ITAU_WEBHOOK_CLIENT_ID: undefined, ITAU_WEBHOOK_CLIENT_SECRET: undefined }, () => {
    assertFalse(credenciaisWebhookValidas("vlma-erp", "s3nh4"))
  })
})

Deno.test("comparaSegura nao vaza por tamanho diferente", () => {
  assert(comparaSegura("abc", "abc"))
  assertFalse(comparaSegura("abc", "abcd"))
  assertFalse(comparaSegura("abc", "abd"))
})
