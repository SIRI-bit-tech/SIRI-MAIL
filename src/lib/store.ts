import { promises as fs } from "node:fs";
import path from "node:path";
import type { InboxSummary, StoredEmail } from "./types";

const MAX_STORED_EMAILS = 500;
const REDIS_LIST_KEY = "siridev:emails:v1";

function hasUpstash(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

async function upstashCommand<T = unknown>(command: unknown[]): Promise<T> {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Upstash Redis error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { result: T };
  return data.result;
}

const LOCAL_DATA_DIR = path.join(process.cwd(), ".data");
const LOCAL_DATA_FILE = path.join(LOCAL_DATA_DIR, "emails.json");

async function readLocalEmails(): Promise<StoredEmail[]> {
  try {
    const raw = await fs.readFile(LOCAL_DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredEmail[]) : [];
  } catch {
    return [];
  }
}

async function writeLocalEmails(emails: StoredEmail[]): Promise<void> {
  await fs.mkdir(LOCAL_DATA_DIR, { recursive: true });
  await fs.writeFile(LOCAL_DATA_FILE, JSON.stringify(emails, null, 2), "utf8");
}

async function loadAllEmails(): Promise<StoredEmail[]> {
  if (hasUpstash()) {
    const rawItems = await upstashCommand<string[]>([
      "LRANGE",
      REDIS_LIST_KEY,
      0,
      MAX_STORED_EMAILS - 1,
    ]);
    if (!Array.isArray(rawItems)) return [];
    const parsed: StoredEmail[] = [];
    for (const item of rawItems) {
      try {
        parsed.push(JSON.parse(item) as StoredEmail);
      } catch {
        // skip malformed entry
      }
    }
    return parsed.sort((a, b) => b.receivedAt - a.receivedAt);
  }
  const local = await readLocalEmails();
  return local.sort((a, b) => b.receivedAt - a.receivedAt);
}

async function saveAllEmails(emails: StoredEmail[]): Promise<void> {
  const trimmed = emails
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, MAX_STORED_EMAILS);

  if (hasUpstash()) {
    await upstashCommand(["DEL", REDIS_LIST_KEY]);
    if (trimmed.length > 0) {
      await upstashCommand([
        "RPUSH",
        REDIS_LIST_KEY,
        ...trimmed.map((e) => JSON.stringify(e)),
      ]);
    }
    return;
  }
  await writeLocalEmails(trimmed);
}

export async function addEmail(email: StoredEmail): Promise<StoredEmail> {
  if (hasUpstash()) {
    await upstashCommand(["LPUSH", REDIS_LIST_KEY, JSON.stringify(email)]);
    await upstashCommand(["LTRIM", REDIS_LIST_KEY, 0, MAX_STORED_EMAILS - 1]);
    return email;
  }
  const existing = await readLocalEmails();
  existing.unshift(email);
  await writeLocalEmails(existing.slice(0, MAX_STORED_EMAILS));
  return email;
}

export async function listEmails(options: {
  recipient?: string;
  query?: string;
}): Promise<StoredEmail[]> {
  const all = await loadAllEmails();
  const recipient = options.recipient?.trim().toLowerCase();
  const q = options.query?.trim().toLowerCase();

  return all.filter((email) => {
    if (recipient && recipient !== "all" && email.recipient !== recipient) {
      return false;
    }
    if (q) {
      const hay =
        `${email.subject} ${email.sender} ${email.senderName} ${email.recipient} ${email.textBody} ${email.otpCode}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export async function getEmailById(id: string): Promise<StoredEmail | null> {
  const all = await loadAllEmails();
  const idx = all.findIndex((e) => e.id === id);
  if (idx === -1) return null;

  if (!all[idx].isRead) {
    all[idx] = { ...all[idx], isRead: true };
    await saveAllEmails(all);
  }
  return all[idx];
}

export async function deleteEmailById(id: string): Promise<boolean> {
  const all = await loadAllEmails();
  const next = all.filter((e) => e.id !== id);
  if (next.length === all.length) return false;
  await saveAllEmails(next);
  return true;
}

export async function deleteEmailsByRecipient(
  recipient: string
): Promise<number> {
  const normalized = recipient.trim().toLowerCase();
  const all = await loadAllEmails();
  const next =
    normalized === "all"
      ? []
      : all.filter((e) => e.recipient !== normalized);
  const removed = all.length - next.length;
  if (removed > 0) {
    await saveAllEmails(next);
  }
  return removed;
}

export async function listInboxSummaries(): Promise<InboxSummary[]> {
  const all = await loadAllEmails();
  const map = new Map<string, InboxSummary>();

  for (const email of all) {
    const prev = map.get(email.recipient);
    if (!prev) {
      map.set(email.recipient, {
        recipient: email.recipient,
        totalCount: 1,
        unreadCount: email.isRead ? 0 : 1,
        latestAt: email.receivedAt,
      });
    } else {
      prev.totalCount += 1;
      if (!email.isRead) prev.unreadCount += 1;
      if (email.receivedAt > prev.latestAt) prev.latestAt = email.receivedAt;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.latestAt - a.latestAt);
}
