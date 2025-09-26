import { NextResponse } from "next/server"

import { isoBase64URL } from "@simplewebauthn/server/helpers"
import { verifyRegistrationResponse } from "@simplewebauthn/server"
import type { RegistrationResponseJSON } from "@simplewebauthn/types"

import { saveStoredPasskey } from "@/lib/passkeys"
import {
  consumeRegistrationChallenge,
  getExpectedOrigin,
  getRpID,
  normalizeAuthenticatorTransports,
  getUserHandle,
} from "@/lib/webauthn"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RequestBody = {
  credential: RegistrationResponseJSON
  masterPassword?: string
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as RequestBody | null
  const credentialResponse = body?.credential
  const masterPassword = body?.masterPassword

  if (!credentialResponse || !masterPassword) {
    return NextResponse.json({ error: "Credential response and master password are required" }, { status: 400 })
  }

  const expectedChallenge = consumeRegistrationChallenge()
  if (!expectedChallenge) {
    return NextResponse.json({ error: "No registration challenge pending" }, { status: 400 })
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: credentialResponse,
      expectedChallenge,
      expectedOrigin: getExpectedOrigin(request),
      expectedRPID: getRpID(request),
      requireUserVerification: true,
    })

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Unable to verify credential" }, { status: 400 })
    }

    const {
      credential: verifiedCredential,
      credentialDeviceType,
      credentialBackedUp,
    } = verification.registrationInfo
    const { publicKey, id: credentialID, counter, transports } = verifiedCredential

    await saveStoredPasskey({
      credentialID,
      credentialPublicKey: isoBase64URL.fromBuffer(publicKey),
      counter,
      transports: normalizeAuthenticatorTransports(transports),
      userHandle: getUserHandle(),
      masterPassword,
    })

    return NextResponse.json({ success: true, deviceType: credentialDeviceType, backedUp: credentialBackedUp })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to verify credential" }, { status: 400 })
  }
}
