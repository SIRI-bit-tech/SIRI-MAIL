"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Inbox,
  KeyRound,
  Lock,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { InboxSummary, StoredEmail } from "@/lib/types";

interface AppConfig {
  domain: string;
  authRequired: boolean;
  authenticated: boolean;
  devSimulateEnabled: boolean;
  storageMode: string;
}

const STORAGE_INBOXES_KEY = "siridev_mail_saved_inboxes_v1";
const STORAGE_ACTIVE_KEY = "siridev_mail_active_inbox_v1";
const STORAGE_PASSCODE_KEY = "siridev_mail_passcode_v1";

const ADJECTIVES = [
  "swift",
  "cobalt",
  "amber",
  "lunar",
  "pixel",
  "nova",
  "crisp",
  "velvet",
  "solar",
  "frost",
  "echo",
  "orbit",
];
const NOUNS = [
  "fox",
  "lynx",
  "kite",
  "wave",
  "spark",
  "cloud",
  "hawk",
  "mint",
  "pulse",
  "drift",
  "ridge",
  "comet",
];

function generateRandomAddress(domain: string): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(10 + Math.random() * 89);
  return `${adj}-${noun}${num}@${domain}`;
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function MailClient() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [passcode, setPasscode] = useState<string>("");
  const [passcodeInput, setPasscodeInput] = useState<string>("");
  const [authError, setAuthError] = useState<string>("");

  const [savedInboxes, setSavedInboxes] = useState<string[]>([]);
  const [serverInboxes, setServerInboxes] = useState<InboxSummary[]>([]);
  const [activeInbox, setActiveInbox] = useState<string>("all");
  const [customPrefix, setCustomPrefix] = useState<string>("");

  const [emails, setEmails] = useState<StoredEmail[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<StoredEmail | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewMode, setViewMode] = useState<"html" | "text">("html");

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const authHeaders = useCallback(
    (code?: string): HeadersInit => {
      const token = code ?? passcode;
      return token ? { "x-passcode": token } : {};
    },
    [passcode]
  );

  // Load initial config & saved browser inboxes
  useEffect(() => {
    const storedPass = sessionStorage.getItem(STORAGE_PASSCODE_KEY) ?? "";
    setPasscode(storedPass);

    fetch("/api/config", { headers: storedPass ? { "x-passcode": storedPass } : {} })
      .then((res) => res.json())
      .then((cfg: AppConfig) => {
        setConfig(cfg);
        const rawSaved = localStorage.getItem(STORAGE_INBOXES_KEY);
        let parsed: string[] = [];
        try {
          parsed = rawSaved ? (JSON.parse(rawSaved) as string[]) : [];
        } catch {
          parsed = [];
        }
        if (parsed.length === 0) {
          const initial = generateRandomAddress(cfg.domain);
          parsed = [initial];
          localStorage.setItem(STORAGE_INBOXES_KEY, JSON.stringify(parsed));
        }
        setSavedInboxes(parsed);

        const lastActive = localStorage.getItem(STORAGE_ACTIVE_KEY);
        if (lastActive && (lastActive === "all" || parsed.includes(lastActive))) {
          setActiveInbox(lastActive);
        } else {
          setActiveInbox(parsed[0]);
        }
      })
      .catch(() => {
        // handled by retry
      });
  }, []);

  const persistSavedInboxes = (next: string[]) => {
    setSavedInboxes(next);
    localStorage.setItem(STORAGE_INBOXES_KEY, JSON.stringify(next));
  };

  const selectInbox = (addr: string) => {
    setActiveInbox(addr);
    localStorage.setItem(STORAGE_ACTIVE_KEY, addr);
    setSelectedId(null);
    setSelectedEmail(null);
  };

  const fetchMailData = useCallback(
    async (silent = false) => {
      if (!config || (config.authRequired && !config.authenticated)) return;
      if (!silent) setIsRefreshing(true);
      try {
        const params = new URLSearchParams({ recipient: activeInbox });
        if (searchQuery.trim()) params.set("q", searchQuery.trim());

        const [emailsRes, inboxesRes] = await Promise.all([
          fetch(`/api/emails?${params.toString()}`, { headers: authHeaders() }),
          fetch("/api/inboxes", { headers: authHeaders() }),
        ]);

        if (emailsRes.status === 401 || inboxesRes.status === 401) {
          setConfig((prev) => (prev ? { ...prev, authenticated: false } : prev));
          return;
        }

        if (emailsRes.ok) {
          const data = (await emailsRes.json()) as { emails: StoredEmail[] };
          setEmails(data.emails);
        }
        if (inboxesRes.ok) {
          const data = (await inboxesRes.json()) as { inboxes: InboxSummary[] };
          setServerInboxes(data.inboxes);
        }
      } finally {
        if (!silent) setIsRefreshing(false);
      }
    },
    [activeInbox, authHeaders, config, searchQuery]
  );

  // Fetch on inbox/search change and poll every 5s
  useEffect(() => {
    fetchMailData();
    const timer = setInterval(() => fetchMailData(true), 5000);
    return () => clearInterval(timer);
  }, [fetchMailData]);

  // Fetch full selected email & mark read
  useEffect(() => {
    if (!selectedId) {
      setSelectedEmail(null);
      return;
    }
    fetch(`/api/emails/${encodeURIComponent(selectedId)}`, {
      headers: authHeaders(),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { email: StoredEmail } | null) => {
        if (data?.email) {
          setSelectedEmail(data.email);
          setViewMode(data.email.htmlBody ? "html" : "text");
          setEmails((prev) =>
            prev.map((e) => (e.id === data.email.id ? { ...e, isRead: true } : e))
          );
        }
      });
  }, [selectedId, authHeaders]);

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
    } catch {
      // clipboard blocked
    }
  };

  const handleGenerateRandom = () => {
    const domain = config?.domain || "siridev.me";
    const fresh = generateRandomAddress(domain);
    const next = [fresh, ...savedInboxes.filter((x) => x !== fresh)];
    persistSavedInboxes(next);
    selectInbox(fresh);
  };

  const handleCreateCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const domain = config?.domain || "siridev.me";
    const cleaned = customPrefix
      .trim()
      .toLowerCase()
      .replace(/@.*$/, "")
      .replace(/[^a-z0-9._+-]/g, "");
    if (!cleaned) return;
    const addr = `${cleaned}@${domain}`;
    const next = [addr, ...savedInboxes.filter((x) => x !== addr)];
    persistSavedInboxes(next);
    selectInbox(addr);
    setCustomPrefix("");
  };

  const handleRemoveSavedInbox = (addr: string) => {
    const next = savedInboxes.filter((x) => x !== addr);
    persistSavedInboxes(next);
    if (activeInbox === addr) {
      selectInbox(next[0] ?? "all");
    }
  };

  const handleDeleteEmail = async (id: string) => {
    const res = await fetch(`/api/emails/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.ok) {
      setEmails((prev) => prev.filter((e) => e.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setSelectedEmail(null);
      }
      fetchMailData(true);
    }
  };

  const handleClearInbox = async () => {
    const res = await fetch(
      `/api/emails?recipient=${encodeURIComponent(activeInbox)}`,
      {
        method: "DELETE",
        headers: authHeaders(),
      }
    );
    if (res.ok) {
      setEmails([]);
      setSelectedId(null);
      setSelectedEmail(null);
      fetchMailData(true);
    }
  };

  const handleSimulateEmail = async () => {
    setIsSimulating(true);
    try {
      const target =
        activeInbox === "all"
          ? savedInboxes[0] || `demo@${config?.domain || "siridev.me"}`
          : activeInbox;
      const res = await fetch("/api/dev/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ recipient: target }),
      });
      if (res.ok) {
        await fetchMailData(true);
      }
    } finally {
      setIsSimulating(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const res = await fetch("/api/config", {
      headers: { "x-passcode": passcodeInput.trim() },
    });
    const cfg = (await res.json()) as AppConfig;
    if (cfg.authenticated) {
      sessionStorage.setItem(STORAGE_PASSCODE_KEY, passcodeInput.trim());
      setPasscode(passcodeInput.trim());
      setConfig(cfg);
    } else {
      setAuthError("Incorrect passcode. Please try again.");
    }
  };

  // Merge saved browser inboxes + any catch-all addresses discovered from incoming mail
  const mergedInboxes = useMemo(() => {
    const summaryMap = new Map(serverInboxes.map((s) => [s.recipient, s]));
    const allAddrs = new Set<string>([...savedInboxes, ...summaryMap.keys()]);
    return Array.from(allAddrs).map((addr) => ({
      address: addr,
      isSaved: savedInboxes.includes(addr),
      totalCount: summaryMap.get(addr)?.totalCount ?? 0,
      unreadCount: summaryMap.get(addr)?.unreadCount ?? 0,
    }));
  }, [savedInboxes, serverInboxes]);

  const totalUnread = useMemo(
    () => serverInboxes.reduce((sum, item) => sum + item.unreadCount, 0),
    [serverInboxes]
  );

  if (!config) {
    return (
      <div className="lock-screen">
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Loading SiriDev Mail…
        </p>
      </div>
    );
  }

  if (config.authRequired && !config.authenticated) {
    return (
      <div className="lock-screen">
        <form className="lock-card" onSubmit={handleUnlock}>
          <div className="brand">
            <div className="brand-icon">
              <Lock size={16} />
            </div>
            <span>SiriDev Mail</span>
            <span className="brand-domain">@{config.domain}</span>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Enter your access passcode to view incoming emails.
          </p>
          <input
            type="password"
            className="input"
            placeholder="Access passcode"
            value={passcodeInput}
            onChange={(e) => setPasscodeInput(e.target.value)}
            autoFocus
          />
          {authError && <p className="lock-error">{authError}</p>}
          <button type="submit" className="btn btn-primary" style={{ height: 36 }}>
            Unlock Inbox
          </button>
        </form>
      </div>
    );
  }

  const displayAddress =
    activeInbox === "all" ? `*@${config.domain} (All Catch-All Mail)` : activeInbox;

  return (
    <div className="shell">
      {/* Top Bar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <Mail size={16} />
          </div>
          <span>SiriDev Mail</span>
          <span className="brand-domain mono">@{config.domain}</span>
        </div>

        <div className="address-bar">
          <span className="address-value mono" title={displayAddress}>
            {displayAddress}
          </span>
          {activeInbox !== "all" && (
            <button
              type="button"
              className={`btn ${copiedKey === "addr" ? "btn-success" : ""}`}
              onClick={() => handleCopy(activeInbox, "addr")}
            >
              {copiedKey === "addr" ? <Check size={14} /> : <Copy size={14} />}
              {copiedKey === "addr" ? "Copied" : "Copy"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerateRandom}
          >
            <Shuffle size={14} />
            New Email
          </button>
        </div>

        <div className="topbar-actions">
          {config.devSimulateEnabled && (
            <button
              type="button"
              className="btn"
              onClick={handleSimulateEmail}
              disabled={isSimulating}
              title="Send a simulated OTP email to test locally"
            >
              <Sparkles size={14} />
              {isSimulating ? "Sending…" : "Test Email"}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => fetchMailData()}
            disabled={isRefreshing}
            title="Refresh inbox"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </header>

      {/* 3-Pane Workspace */}
      <div className="workspace">
        {/* Sidebar: Inboxes */}
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="sidebar-label">Create Custom Alias</div>
            <form className="custom-form" onSubmit={handleCreateCustom}>
              <input
                type="text"
                className="input mono"
                placeholder={`alias`}
                value={customPrefix}
                onChange={(e) => setCustomPrefix(e.target.value)}
                aria-label="Custom alias prefix"
              />
              <button
                type="submit"
                className="btn btn-icon"
                title={`Add @${config.domain}`}
              >
                <Plus size={15} />
              </button>
            </form>
          </div>

          <div className="inbox-list">
            <button
              type="button"
              className={`inbox-item ${activeInbox === "all" ? "active" : ""}`}
              onClick={() => selectInbox("all")}
            >
              <Inbox size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span className="inbox-item-name">All Mail (*@{config.domain})</span>
              {totalUnread > 0 && (
                <span className="badge badge-unread">{totalUnread}</span>
              )}
            </button>

            <div className="sidebar-label" style={{ padding: "10px 8px 4px" }}>
              Your Addresses ({mergedInboxes.length})
            </div>

            {mergedInboxes.map((item) => (
              <div
                key={item.address}
                className={`inbox-item ${
                  activeInbox === item.address ? "active" : ""
                }`}
                onClick={() => selectInbox(item.address)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") selectInbox(item.address);
                }}
              >
                <span className="inbox-item-name mono" title={item.address}>
                  {item.address.split("@")[0]}
                </span>
                <div className="inbox-item-right">
                  {item.unreadCount > 0 ? (
                    <span className="badge badge-unread">{item.unreadCount}</span>
                  ) : item.totalCount > 0 ? (
                    <span className="badge">{item.totalCount}</span>
                  ) : null}
                  {item.isSaved && (
                    <button
                      type="button"
                      className="remove-inbox-btn"
                      title="Remove from saved list"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveSavedInbox(item.address);
                      }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Middle Pane: Message List */}
        <section className="list-pane">
          <div className="list-header">
            <div className="search-wrap">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                className="input search-input"
                placeholder="Search subject, sender, OTP…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {emails.length > 0 && (
              <button
                type="button"
                className="btn btn-icon btn-ghost"
                title="Clear messages in this inbox"
                onClick={handleClearInbox}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>

          <div className="message-list">
            {emails.length === 0 ? (
              <div className="empty-state">
                <Mail size={26} style={{ color: "var(--text-dim)" }} />
                <h3>Waiting for emails</h3>
                <p>
                  Anything sent to{" "}
                  <span className="mono" style={{ color: "var(--text)" }}>
                    {activeInbox === "all" ? `*@${config.domain}` : activeInbox}
                  </span>{" "}
                  will appear here automatically every 5 seconds.
                </p>
              </div>
            ) : (
              emails.map((email) => (
                <button
                  key={email.id}
                  type="button"
                  className={`message-row ${
                    selectedId === email.id ? "selected" : ""
                  }`}
                  onClick={() => setSelectedId(email.id)}
                >
                  <div className="message-row-top">
                    <span className="message-sender">
                      {!email.isRead && <span className="unread-dot" />}
                      {email.senderName || email.sender}
                    </span>
                    <span className="message-time">
                      {formatRelativeTime(email.receivedAt)}
                    </span>
                  </div>
                  <div className="message-subject">{email.subject}</div>
                  <div className="message-meta-row">
                    <span className="message-to mono">to {email.recipient}</span>
                    {email.otpCode && (
                      <span
                        className="otp-pill mono"
                        title="Click to copy OTP code"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(email.otpCode, `otp-${email.id}`);
                        }}
                      >
                        <KeyRound size={11} />
                        {copiedKey === `otp-${email.id}`
                          ? "Copied!"
                          : email.otpCode}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        {/* Right Pane: Email Reader */}
        <main className="reader-pane">
          {!selectedEmail ? (
            <div className="empty-state">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--text-dim)",
                }}
              >
                <span className="status-dot" />
                Live catch-all active for @{config.domain}
              </div>
              <h3>Select an email to read</h3>
              <p>
                Copy any address above and use it on any signup form. Verification
                codes are detected automatically.
              </p>
            </div>
          ) : (
            <>
              <div className="reader-header">
                <div className="reader-title-row">
                  <h2 className="reader-subject">{selectedEmail.subject}</h2>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => handleDeleteEmail(selectedEmail.id)}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>

                <div className="reader-meta">
                  <span>
                    <strong>From:</strong>{" "}
                    {selectedEmail.senderName
                      ? `${selectedEmail.senderName} <${selectedEmail.sender}>`
                      : selectedEmail.sender}
                  </span>
                  <span className="mono">
                    <strong>To:</strong> {selectedEmail.recipient}
                  </span>
                  <span>
                    <strong>Received:</strong>{" "}
                    {new Date(selectedEmail.receivedAt).toLocaleString()}
                  </span>
                </div>

                {selectedEmail.otpCode && (
                  <div className="otp-banner">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <KeyRound size={16} style={{ color: "#86efac" }} />
                      <div>
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                          Detected Verification Code
                        </div>
                        <div className="otp-banner-code mono">
                          {selectedEmail.otpCode}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={() => handleCopy(selectedEmail.otpCode, "reader-otp")}
                    >
                      {copiedKey === "reader-otp" ? (
                        <Check size={14} />
                      ) : (
                        <Copy size={14} />
                      )}
                      {copiedKey === "reader-otp" ? "Copied" : "Copy Code"}
                    </button>
                  </div>
                )}
              </div>

              <div className="reader-toolbar">
                <div className="view-tabs">
                  {selectedEmail.htmlBody && (
                    <button
                      type="button"
                      className={`btn ${
                        viewMode === "html" ? "btn-primary" : "btn-ghost"
                      }`}
                      onClick={() => setViewMode("html")}
                    >
                      HTML
                    </button>
                  )}
                  <button
                    type="button"
                    className={`btn ${
                      viewMode === "text" || !selectedEmail.htmlBody
                        ? "btn-primary"
                        : "btn-ghost"
                    }`}
                    onClick={() => setViewMode("text")}
                  >
                    Plain Text
                  </button>
                </div>
              </div>

              <div className="reader-body">
                {viewMode === "html" && selectedEmail.htmlBody ? (
                  <iframe
                    title="Email content"
                    className="email-iframe"
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    srcDoc={selectedEmail.htmlBody}
                  />
                ) : (
                  <pre className="email-plaintext">
                    {selectedEmail.textBody || "(No plain text body)"}
                  </pre>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
