import { NextResponse } from "next/server";
import { checkPasscode } from "@/lib/auth";
import { deleteEmailsByRecipient, listEmails } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const recipient = searchParams.get("recipient") ?? "all";
  const query = searchParams.get("q") ?? "";

  const emails = await listEmails({ recipient, query });
  return NextResponse.json({ emails });
}

export async function DELETE(request: Request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const recipient = searchParams.get("recipient") ?? "";
  if (!recipient) {
    return NextResponse.json(
      { error: "recipient query param is required" },
      { status: 400 }
    );
  }

  const deleted = await deleteEmailsByRecipient(recipient);
  return NextResponse.json({ deleted });
}
