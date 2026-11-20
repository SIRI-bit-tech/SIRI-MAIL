import { NextResponse } from "next/server";
import { checkPasscode } from "@/lib/auth";
import { deleteEmailById, getEmailById } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const { id } = await context.params;
  const email = await getEmailById(id);
  if (!email) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }
  return NextResponse.json({ email });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const { id } = await context.params;
  const removed = await deleteEmailById(id);
  if (!removed) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
