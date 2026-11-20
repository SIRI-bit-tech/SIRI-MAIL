import PostalMime from "postal-mime";

interface Env {
  WEBHOOK_URL: string;
  WEBHOOK_SECRET: string;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parser = new PostalMime();
    const parsed = await parser.parse(rawEmail);

    const payload = {
      to: message.to,
      from: parsed.from?.address || message.from,
      fromName: parsed.from?.name || "",
      subject: parsed.subject || "(No subject)",
      text: parsed.text || "",
      html: parsed.html || "",
      receivedAt: Date.now(),
    };

    const res = await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": env.WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Failed to forward email to Next.js webhook:", res.status, errText);
    }
  },
};
