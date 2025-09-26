const RP_NAME = "1Pass Vault"
const USER_HANDLE = "1pass-user"

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

  const proto = request.headers.get("x-forwarded-proto") ?? "https"
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
