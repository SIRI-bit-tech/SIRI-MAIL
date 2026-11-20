import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { checkPasscode } from "@/lib/auth";
import { addEmail } from "@/lib/store";
import { normalizeEmailAddress } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.ENABLE_DEV_SIMULATE !== "true") {
    return NextResponse.json(
      { error: "Simulation endpoint is disabled" },
      { status: 403 }
    );
  }

  const denied = checkPasscode(request);
  if (denied) return denied;

  const domain = process.env.EMAIL_DOMAIN?.trim() || "siridev.me";
  let recipient = `demo@${domain}`;

  try {
    const body = (await request.json()) as { recipient?: string };
    if (body.recipient && body.recipient !== "all" && body.recipient.includes("@")) {
      recipient = normalizeEmailAddress(body.recipient);
    }
  } catch {
    // use default recipient
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const services = [
    { name: "Acme Cloud", sender: "no-reply@acmecloud.dev" },
    { name: "StreamBox", sender: "verify@streambox.io" },
    { name: "DevHub", sender: "security@devhub.app" },
  ];
  const service = services[Math.floor(Math.random() * services.length)];

  const stored = await addEmail({
    id: crypto.randomUUID(),
    recipient,
    sender: service.sender,
    senderName: service.name,
    subject: `${otp} is your ${service.name} verification code`,
    textBody: `Hi there,\n\nUse verification code ${otp} to finish signing in to ${service.name}.\n\nThis code expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
    htmlBody: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; color: #111827;">
        <p style="font-size: 13px; color: #6b7280; margin: 0 0 12px;">${service.name} Security</p>
        <h2 style="margin: 0 0 16px; font-size: 20px;">Verify your email address</h2>
        <p style="line-height: 1.6; color: #374151;">Enter the 6-digit code below to continue signing up with <strong>${recipient}</strong>:</p>
        <div style="margin: 24px 0; padding: 18px; background: #f3f4f6; border-radius: 10px; text-align: center; font-family: monospace; font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #111827;">
          ${otp}
        </div>
        <p style="font-size: 13px; color: #6b7280;">This code expires in 10 minutes.</p>
      </div>
    `,
    otpCode: otp,
    isRead: false,
    receivedAt: Date.now(),
  });

  return NextResponse.json({ email: stored }, { status: 201 });
}
