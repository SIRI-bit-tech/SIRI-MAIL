import { NextResponse } from "next/server";
import { checkPasscode } from "@/lib/auth";
import { listInboxSummaries } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const inboxes = await listInboxSummaries();
  return NextResponse.json({ inboxes });
}
