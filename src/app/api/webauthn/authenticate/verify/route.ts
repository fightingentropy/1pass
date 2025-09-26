import { NextResponse } from "next/server"

import { isoBase64URL } from "@simplewebauthn/server/helpers"
import { verifyAuthenticationResponse } from "@simplewebauthn/server"
import type { AuthenticationResponseJSON } from "@simplewebauthn/types"

import { getStoredPasskey, updateStoredPasskeyCounter } from "@/lib/passkeys"
import { consumeAuthenticationChallenge, getExpectedOrigin, getRpID } from "@/lib/webauthn"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RequestBody = {
  credential: AuthenticationResponseJSON
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as RequestBody | null
  const credential = body?.credential

  if (!credential) {
    return NextResponse.json({ error: "Credential response is required" }, { status: 400 })
  }

  const stored = await getStoredPasskey()
  if (!stored) {
    return NextResponse.json({ error: "No Face ID credential registered" }, { status: 404 })
  }

  const expectedChallenge = consumeAuthenticationChallenge()
  if (!expectedChallenge) {
    return NextResponse.json({ error: "No authentication challenge pending" }, { status: 400 })
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: getExpectedOrigin(request),
      expectedRPID: getRpID(request),
      requireUserVerification: true,
      authenticator: {
        credentialID: isoBase64URL.toBuffer(stored.credentialID),
        credentialPublicKey: isoBase64URL.toBuffer(stored.credentialPublicKey),
        counter: stored.counter,
        transports: stored.transports,
      },
    })

    if (!verification.verified || !verification.authenticationInfo) {
      return NextResponse.json({ error: "Unable to verify credential" }, { status: 400 })
    }

    await updateStoredPasskeyCounter(verification.authenticationInfo.newCounter)

    return NextResponse.json({ success: true, masterPassword: stored.masterPassword })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to verify credential" }, { status: 400 })
  }
}
