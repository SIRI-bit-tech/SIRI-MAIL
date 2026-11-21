"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Inbox,
  KeyRound,
  Lock,
  Mail,
  Menu,
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

type ConfirmDialogState =
  | { type: "delete-email"; email: StoredEmail }
  | { type: "clear-inbox"; inboxLabel: string; count: number }
  | null;

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
const AVATAR_COLORS = [
  "#4f46e5",
  "#0891b2",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#db2777",
  "#2563eb",
];

function generateRandomAddress(domain: string): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(10 + Math.random() * 89);
  return `${adj}-${noun}${num}@${domain}`;
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getAvatarMeta(nameOrEmail: string): { initial: string; color: string } {
  const clean = nameOrEmail.trim();
  const initial = (clean[0] || "?").toUpperCase();
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  }
  return {
    initial,
    color: AVATAR_COLORS[hash % AVATAR_COLORS.length],
  };
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

  // Mobile drawer & delete confirmation states
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const [clearConfirmText, setClearConfirmText] = useState<string>("");
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

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

    fetch("/api/config", {
      headers: storedPass ? { "x-passcode": storedPass } : {},
    })
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
          setActiveInbox("all");
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
    setDrawerOpen(false);
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

  const executeConfirmedDelete = async () => {
    if (!confirmDialog) return;
    setIsDeleting(true);
    try {
      if (confirmDialog.type === "delete-email") {
        const id = confirmDialog.email.id;
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
          await fetchMailData(true);
        }
      } else if (confirmDialog.type === "clear-inbox") {
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
          await fetchMailData(true);
        }
      }
      setConfirmDialog(null);
      setClearConfirmText("");
    } finally {
      setIsDeleting(false);
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
    activeInbox === "all" ? `All Mail (*@${config.domain})` : activeInbox;
  const copyTarget =
    activeInbox === "all" ? savedInboxes[0] || `inbox@${config.domain}` : activeInbox;
  const isMobileReading = Boolean(selectedId);

  return (
    <div className="shell">
      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="btn btn-icon btn-ghost mobile-only"
            aria-label="Open mailboxes menu"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={18} />
          </button>
          <div className="brand">
            <div className="brand-icon">
              <Mail size={16} />
            </div>
            <span>SiriDev Mail</span>
            <span className="brand-domain mono">@{config.domain}</span>
          </div>
        </div>

        {/* Desktop Address Bar */}
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
              className="btn desktop-only"
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
            <span className="desktop-only">Refresh</span>
          </button>
        </div>
      </header>

      {/* Mobile Active Address Strip (shown only on mobile when viewing inbox list) */}
      {!isMobileReading && (
        <div className="mobile-address-strip">
          <button
            type="button"
            className="mobile-address-pill"
            onClick={() => handleCopy(copyTarget, "mobile-addr")}
            title="Tap to copy email address"
          >
            <span className="mobile-address-text mono">
              {activeInbox === "all" ? `All Mail • ${copyTarget}` : activeInbox}
            </span>
            {copiedKey === "mobile-addr" ? (
              <Check size={14} style={{ color: "#86efac", flexShrink: 0 }} />
            ) : (
              <Copy size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            )}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerateRandom}
            title="Generate new random email"
          >
            <Shuffle size={14} />
            New
          </button>
        </div>
      )}

      {/* 3-Pane Workspace (Desktop) / Drawer + Master-Detail (Mobile) */}
      <div className={`workspace ${isMobileReading ? "mobile-reading" : ""}`}>
        {/* Mobile Drawer Backdrop */}
        <div
          className={`drawer-backdrop ${drawerOpen ? "open" : ""}`}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />

        {/* Sidebar / Mobile Mailboxes Drawer */}
        <aside className={`sidebar ${drawerOpen ? "open" : ""}`}>
          <div className="sidebar-mobile-header">
            <div className="brand">
              <div className="brand-icon">
                <Mail size={15} />
              </div>
              <span>Mailboxes</span>
            </div>
            <button
              type="button"
              className="btn btn-icon btn-ghost"
              aria-label="Close mailboxes menu"
              onClick={() => setDrawerOpen(false)}
            >
              <X size={17} />
            </button>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Create Custom Alias</div>
            <form className="custom-form" onSubmit={handleCreateCustom}>
              <input
                type="text"
                className="input mono"
                placeholder="alias"
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
              <Inbox
                size={15}
                style={{ color: "var(--text-muted)", flexShrink: 0 }}
              />
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
                  if (e.key === "Enter" || e.key === " ")
                    selectInbox(item.address);
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
                      title="Hide from saved list (emails are kept)"
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
                placeholder="Search mail, sender, OTP…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {emails.length > 0 && (
              <button
                type="button"
                className="btn btn-icon btn-ghost"
                title="Clear inbox (requires confirmation)"
                onClick={() => {
                  setClearConfirmText("");
                  setConfirmDialog({
                    type: "clear-inbox",
                    inboxLabel: displayAddress,
                    count: emails.length,
                  });
                }}
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
              emails.map((email) => {
                const avatar = getAvatarMeta(email.senderName || email.sender);
                return (
                  <button
                    key={email.id}
                    type="button"
                    className={`message-row ${
                      selectedId === email.id ? "selected" : ""
                    } ${!email.isRead ? "unread" : ""}`}
                    onClick={() => setSelectedId(email.id)}
                  >
                    <div
                      className="sender-avatar"
                      style={{ backgroundColor: avatar.color }}
                    >
                      {avatar.initial}
                    </div>
                    <div className="message-content">
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
                        <span className="message-to mono">
                          to {email.recipient}
                        </span>
                        {email.otpCode && (
                          <span
                            className="otp-pill mono"
                            title="Tap to copy OTP code"
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
                    </div>
                  </button>
                );
              })
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
              {/* Mobile Back Bar */}
              <div className="reader-mobile-nav">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setSelectedId(null);
                    setSelectedEmail(null);
                  }}
                >
                  <ArrowLeft size={16} />
                  Inbox
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() =>
                    setConfirmDialog({
                      type: "delete-email",
                      email: selectedEmail,
                    })
                  }
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>

              <div className="reader-header">
                <div className="reader-title-row">
                  <h2 className="reader-subject">{selectedEmail.subject}</h2>
                  <button
                    type="button"
                    className="btn btn-danger desktop-only"
                    onClick={() =>
                      setConfirmDialog({
                        type: "delete-email",
                        email: selectedEmail,
                      })
                    }
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
                      onClick={() =>
                        handleCopy(selectedEmail.otpCode, "reader-otp")
                      }
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

      {/* Delete Protection Confirmation Modal */}
      {confirmDialog && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!isDeleting) {
              setConfirmDialog(null);
              setClearConfirmText("");
            }
          }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-icon-danger">
                <AlertTriangle size={18} />
              </div>
              <h3 className="modal-title">
                {confirmDialog.type === "delete-email"
                  ? "Delete email permanently?"
                  : "Clear entire inbox?"}
              </h3>
            </div>

            {confirmDialog.type === "delete-email" ? (
              <>
                <p className="modal-desc">
                  This message will be permanently removed and cannot be
                  recovered.
                </p>
                <div className="modal-subject-box">
                  <strong>{confirmDialog.email.subject}</strong>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      marginTop: 4,
                    }}
                  >
                    From: {confirmDialog.email.senderName || confirmDialog.email.sender}
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="modal-desc">
                  This will permanently delete all{" "}
                  <strong>{confirmDialog.count}</strong> email
                  {confirmDialog.count === 1 ? "" : "s"} in{" "}
                  <span className="mono">{confirmDialog.inboxLabel}</span>. Type{" "}
                  <strong className="mono">CLEAR</strong> below to confirm.
                </p>
                <input
                  type="text"
                  className="input mono"
                  placeholder="Type CLEAR to confirm"
                  value={clearConfirmText}
                  onChange={(e) => setClearConfirmText(e.target.value)}
                  autoFocus
                />
              </>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                disabled={isDeleting}
                onClick={() => {
                  setConfirmDialog(null);
                  setClearConfirmText("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger-solid"
                disabled={
                  isDeleting ||
                  (confirmDialog.type === "clear-inbox" &&
                    clearConfirmText.trim().toUpperCase() !== "CLEAR")
                }
                onClick={executeConfirmedDelete}
              >
                {isDeleting
                  ? "Deleting…"
                  : confirmDialog.type === "delete-email"
                  ? "Delete Permanently"
                  : "Clear All Emails"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
