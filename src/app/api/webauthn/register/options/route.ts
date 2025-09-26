import { NextResponse } from "next/server"

import { generateRegistrationOptions } from "@simplewebauthn/server"
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialDescriptorJSON } from "@simplewebauthn/types"

import { getStoredPasskey } from "@/lib/passkeys"
import {
  getRpID,
  getRpName,
  getUserHandle,
  rememberRegistrationChallenge,
} from "@/lib/webauthn"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const rpID = getRpID(request)
  const existing = await getStoredPasskey()

  const excludeCredentials: PublicKeyCredentialDescriptorJSON[] = existing
    ? [
        {
          id: existing.credentialID,
          type: "public-key",
          transports: existing.transports,
        },
      ]
    : []

  const options = await generateRegistrationOptions({
    rpName: getRpName(),
    rpID,
    userName: "1Pass user",
    userID: new TextEncoder().encode(getUserHandle()),
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
    excludeCredentials,
  })

  rememberRegistrationChallenge(options.challenge)

  const json: PublicKeyCredentialCreationOptionsJSON = {
    ...options,
    challenge:
      typeof options.challenge === "string"
        ? options.challenge
        : Buffer.from(options.challenge).toString("base64url"),
    user: {
      ...options.user,
      id: Buffer.from(options.user.id).toString("base64url"),
    },
    excludeCredentials: options.excludeCredentials?.map((item) => ({
      ...item,
      id: Buffer.from(item.id).toString("base64url"),
    })),
  }

  return NextResponse.json(json)
}
