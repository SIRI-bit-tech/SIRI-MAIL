import { NextResponse } from "next/server";

export function checkPasscode(request: Request): NextResponse | null {
  const expected = process.env.ACCESS_PASSCODE?.trim();
  if (!expected) return null;

  const provided = request.headers.get("x-passcode")?.trim() ?? "";
  if (provided !== expected) {
    return NextResponse.json(
      { error: "Passcode required", authRequired: true },
      { status: 401 }
    );
  }
  return null;
}
