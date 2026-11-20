import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const expected = process.env.ACCESS_PASSCODE?.trim();
  const provided = request.headers.get("x-passcode")?.trim() ?? "";

  return NextResponse.json({
    domain: process.env.EMAIL_DOMAIN?.trim() || "siridev.me",
    authRequired: Boolean(expected),
    authenticated: !expected || provided === expected,
    devSimulateEnabled: process.env.ENABLE_DEV_SIMULATE === "true",
    storageMode:
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
        ? "upstash-redis"
        : "local-file",
  });
}
