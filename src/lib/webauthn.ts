import type { AuthenticatorTransportFuture } from "@simplewebauthn/types"

const RP_NAME = "1Pass Vault"
const USER_HANDLE = "1pass-user"

function isAuthenticatorTransportFuture(
  transport: string,
): transport is AuthenticatorTransportFuture {
  switch (transport) {
    case "ble":
    case "cable":
    case "hybrid":
    case "internal":
    case "nfc":
    case "smart-card":
    case "usb":
      return true
    default:
      return false
  }
}

export function normalizeAuthenticatorTransports(
  transports?: readonly string[],
): AuthenticatorTransportFuture[] | undefined {
  if (!transports || transports.length === 0) {
    return undefined
  }

  const valid = transports.filter(isAuthenticatorTransportFuture)
  return valid.length > 0 ? valid : undefined
}

let registrationChallenge: string | null = null
let authenticationChallenge: string | null = null

export function getRpID(request: Request) {
  const host = request.headers.get("host")
  if (!host) {
    return "localhost"
  }

  return host.split(":")[0]
}

export function getExpectedOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (origin) {
    return origin
  }

  try {
    const url = new URL(request.url)
    if (url.origin) {
      return url.origin
    }
  } catch {
    // Ignore URL parsing failures and fall through to header-derived values.
  }

  const forwarded = request.headers.get("forwarded")
  let forwardedProto: string | null = null

  if (forwarded) {
    const entries = forwarded.split(",")
    for (const entry of entries) {
      const directives = entry.split(";")
      for (const directive of directives) {
        const [rawKey, rawValue] = directive.split("=")
        if (rawKey?.trim().toLowerCase() === "proto" && rawValue) {
          forwardedProto = rawValue.trim().replace(/^"|"$/g, "")
          break
        }
      }
      if (forwardedProto) {
        break
      }
    }
  }

  const proto = forwardedProto ?? request.headers.get("x-forwarded-proto") ?? "https"
  const host = request.headers.get("host") ?? "localhost"
  return `${proto}://${host}`
}

export function rememberRegistrationChallenge(challenge: string) {
  registrationChallenge = challenge
}

export function consumeRegistrationChallenge() {
  const challenge = registrationChallenge
  registrationChallenge = null
  return challenge
}

export function rememberAuthenticationChallenge(challenge: string) {
  authenticationChallenge = challenge
}

export function consumeAuthenticationChallenge() {
  const challenge = authenticationChallenge
  authenticationChallenge = null
  return challenge
}

export function getRpName() {
  return RP_NAME
}

export function getUserHandle() {
  return USER_HANDLE
}
