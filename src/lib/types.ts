export interface StoredEmail {
  id: string;
  recipient: string;
  sender: string;
  senderName: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  otpCode: string;
  isRead: boolean;
  receivedAt: number;
}

export interface InboxSummary {
  recipient: string;
  totalCount: number;
  unreadCount: number;
  latestAt: number;
}

export function extractOtpCode(subject: string, textBody: string): string {
  const combined = `${subject}\n${textBody}`;
  const contextualPatterns = [
    /(?:code|otp|pin|verification|passcode|token|confirm)[^\d]{0,24}\b(\d{4,8})\b/i,
    /\b(\d{4,8})\b[^\d]{0,24}(?:is your|verification|code|otp|pin|passcode)/i,
    /\b(\d{3}-\d{3})\b/,
  ];

  for (const pattern of contextualPatterns) {
    const match = combined.match(pattern);
    if (match?.[1]) {
      return match[1].replace("-", "");
    }
  }
  return "";
}

export function normalizeEmailAddress(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const angleMatch = trimmed.match(/<([^>]+)>/);
  return (angleMatch ? angleMatch[1] : trimmed).trim();
}
