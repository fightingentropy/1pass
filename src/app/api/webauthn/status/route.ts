import { NextResponse } from "next/server"

import { passkeyExists } from "@/lib/passkeys"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const enabled = await passkeyExists()
  return NextResponse.json({ enabled })
}
