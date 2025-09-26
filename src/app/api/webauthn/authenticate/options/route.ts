import { NextResponse } from "next/server"

import { generateAuthenticationOptions } from "@simplewebauthn/server"
import type {
  PublicKeyCredentialDescriptorJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/types"

import { getStoredPasskey } from "@/lib/passkeys"
import {
  getRpID,
  normalizeAuthenticatorTransports,
  rememberAuthenticationChallenge,
} from "@/lib/webauthn"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const stored = await getStoredPasskey()

  if (!stored) {
    return NextResponse.json({ error: "No Face ID credential registered" }, { status: 404 })
  }

  const allowCredentials: PublicKeyCredentialDescriptorJSON[] = [
    {
      id: stored.credentialID,
      type: "public-key",
      transports: normalizeAuthenticatorTransports(stored.transports),
    },
  ]

  const options = await generateAuthenticationOptions({
    rpID: getRpID(request),
    userVerification: "required",
    allowCredentials,
  })

  rememberAuthenticationChallenge(options.challenge)

  const json: PublicKeyCredentialRequestOptionsJSON = {
    ...options,
    challenge:
      typeof options.challenge === "string"
        ? options.challenge
        : Buffer.from(options.challenge).toString("base64url"),
    allowCredentials: options.allowCredentials?.map((item) => ({
      ...item,
      id: Buffer.from(item.id).toString("base64url"),
    })),
  }

  return NextResponse.json(json)
}
