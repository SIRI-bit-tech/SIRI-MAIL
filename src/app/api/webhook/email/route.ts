import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { addEmail } from "@/lib/store";
import { extractOtpCode, normalizeEmailAddress } from "@/lib/types";

export const dynamic = "force-dynamic";

interface IncomingWebhookPayload {
  to?: string;
  from?: string;
  fromName?: string;
  subject?: string;
  text?: string;
  html?: string;
  receivedAt?: number;
}

export async function POST(request: Request) {
  const expectedSecret = process.env.WEBHOOK_SECRET?.trim();
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "WEBHOOK_SECRET is not configured on the server" },
      { status: 500 }
    );
  }

  const providedSecret =
    request.headers.get("x-webhook-secret")?.trim() ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
    "";

  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: IncomingWebhookPayload;
  try {
    body = (await request.json()) as IncomingWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const recipient = normalizeEmailAddress(body.to ?? "");
  const sender = normalizeEmailAddress(body.from ?? "unknown@sender");

  if (!recipient || !recipient.includes("@")) {
    return NextResponse.json(
      { error: "Valid 'to' recipient address is required" },
      { status: 400 }
    );
  }

  const subject = (body.subject ?? "").trim() || "(No subject)";
  const textBody = typeof body.text === "string" ? body.text : "";
  const htmlBody = typeof body.html === "string" ? body.html : "";
  const plainForOtp =
    textBody || htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const stored = await addEmail({
    id: crypto.randomUUID(),
    recipient,
    sender,
    senderName: (body.fromName ?? "").trim(),
    subject,
    textBody,
    htmlBody,
    otpCode: extractOtpCode(subject, plainForOtp),
    isRead: false,
    receivedAt:
      typeof body.receivedAt === "number" && Number.isFinite(body.receivedAt)
        ? body.receivedAt
        : Date.now(),
  });

  return NextResponse.json({ ok: true, id: stored.id }, { status: 201 });
}
