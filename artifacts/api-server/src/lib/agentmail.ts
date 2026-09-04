import * as fs from "fs";
import * as path from "path";

const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY || "";
const AGENTMAIL_BASE = "https://api.agentmail.to/v0";
const INBOX_USERNAME = "rmone";
const INBOX_DOMAIN = "mail.vyaasai.com";
const INBOX_EMAIL = `${INBOX_USERNAME}@${INBOX_DOMAIN}`;
const INBOX_EMAIL_OLD = `rmone-prime@agentmail.to`;
const INBOX_EMAIL_LEGACY = `rmone@vyaasai.com`;
const INBOX_CLIENT_ID = "rmone-mail-vyaasai-v1";
const isOurAddress = (addr: string) => {
  const lower = addr.toLowerCase();
  return lower.includes(INBOX_EMAIL.toLowerCase()) || lower.includes(INBOX_EMAIL_OLD.toLowerCase()) || lower.includes(INBOX_EMAIL_LEGACY.toLowerCase());
};

const OWNER_FILE = path.join(process.cwd(), ".data/thread_owners.json");
const DELETED_FILE = path.join(process.cwd(), ".data/deleted_messages.json");

let inboxReady: Promise<void> | null = null;
let inboxConfirmed = false;

function authHeaders(): Record<string, string> {
  if (!AGENTMAIL_API_KEY) throw new Error("AGENTMAIL_API_KEY not configured");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AGENTMAIL_API_KEY}`,
  };
}

async function ensureInbox(): Promise<void> {
  if (inboxConfirmed) return;
  if (inboxReady) return inboxReady;

  inboxReady = (async () => {
    try {
      const resp = await fetch(`${AGENTMAIL_BASE}/inboxes`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          username: INBOX_USERNAME,
          domain: INBOX_DOMAIN,
          displayName: "RM ONE Service Prime",
          clientId: INBOX_CLIENT_ID,
        }),
      });

      if (resp.ok) {
        inboxConfirmed = true;
        console.log(`[agentmail] inbox created: ${INBOX_EMAIL}`);
        return;
      }

      const data = await resp.json().catch(() => ({}));
      const errName = (data as any)?.name || "";
      if (resp.status === 409 || resp.status === 403 || errName === "ConflictError" || errName === "AlreadyExistsError") {
        inboxConfirmed = true;
        console.log(`[agentmail] inbox already exists: ${INBOX_EMAIL}`);
        return;
      }

      console.error("[agentmail] inbox creation failed:", resp.status, data);
      throw new Error(`Inbox creation failed (${resp.status})`);
    } catch (err) {
      inboxReady = null;
      throw err;
    }
  })();

  try {
    await inboxReady;
  } catch (err) {
    inboxReady = null;
    throw err;
  }
}

function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function generateMeetingCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const seg = (len: number) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `RM ONE-${seg(4)}-${Date.now().toString(36)}`;
}

function generateICS(params: {
  summary: string;
  description?: string;
  location?: string;
  startDate: string;
  startTime: string;
  endTime: string;
  organizerEmail: string;
  attendees: string[];
  timezone?: string;
  meetingUrl?: string;
}): string {
  const { summary, description, location, startDate, startTime, endTime, organizerEmail, attendees, timezone, meetingUrl } = params;
  const uid = `rmone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@agentmail.to`;
  const now = new Date();
  const dtstamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const dateMatch = startDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const startMatch = startTime.match(/^(\d{1,2}):(\d{2})$/);
  const endMatch = endTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !startMatch || !endMatch) {
    throw new Error(`Invalid date/time format: date=${startDate} start=${startTime} end=${endTime}`);
  }

  const startH = parseInt(startMatch[1], 10);
  const startM = parseInt(startMatch[2], 10);
  const endH = parseInt(endMatch[1], 10);
  const endM = parseInt(endMatch[2], 10);
  if (startH > 23 || startM > 59 || endH > 23 || endM > 59) {
    throw new Error(`Invalid time values: start=${startTime} end=${endTime}`);
  }

  const d = startDate.replace(/-/g, "");
  const timeStr = (h: number, m: number) => `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;

  const dtstartVal = timezone
    ? `DTSTART;TZID=${timezone}:${d}T${timeStr(startH, startM)}`
    : `DTSTART:${d}T${timeStr(startH, startM)}`;
  const dtendVal = timezone
    ? `DTEND;TZID=${timezone}:${d}T${timeStr(endH, endM)}`
    : `DTEND:${d}T${timeStr(endH, endM)}`;

  const attendeeLines = attendees.map(email =>
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`
  ).join("\r\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RM ONE//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    dtstartVal,
    dtendVal,
    `SUMMARY:${escapeICSText(summary)}`,
    description ? `DESCRIPTION:${escapeICSText(meetingUrl ? `${description}\n\nJoin video call: ${meetingUrl}` : description)}` : (meetingUrl ? `DESCRIPTION:${escapeICSText(`Join video call: ${meetingUrl}`)}` : ""),
    meetingUrl ? `LOCATION:${escapeICSText(meetingUrl)}` : (location ? `LOCATION:${escapeICSText(location)}` : ""),
    meetingUrl ? `URL:${meetingUrl}` : "",
    `ORGANIZER;CN=RM ONE:mailto:${organizerEmail}`,
    attendeeLines,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Meeting starts in 30 minutes",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

function buildTimelineHtml(phases: { label: string; start: string; end: string }[]): string {
  const fmtShort = (d: string) => {
    const t = new Date(d).getTime();
    if (isNaN(t)) return d || "N/A";
    const dt = new Date(t);
    const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${mo[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
  };
  const toMs = (d: string) => { const t = new Date(d).getTime(); return isNaN(t) ? null : t; };
  const isValid = (d: string) => d && !/^n\/?a$/i.test(d.trim()) && !isNaN(new Date(d).getTime());

  const BAR_COLORS = ["#6BA539", "#E87722", "#A9C23F", "#3B82F6", "#F2C94C"];

  let html = '<table style="border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 14px;" cellpadding="0" cellspacing="0">';
  html += '<tr><td colspan="3" style="padding: 8px 10px; font-weight: bold; font-size: 14px; color: #253746; border-bottom: 2px solid #6BA539;">Project Schedule</td></tr>';

  phases.forEach((p, idx) => {
    const color = BAR_COLORS[idx % BAR_COLORS.length];
    const s = toMs(p.start);
    const e = toMs(p.end);
    const days = s !== null && e !== null ? Math.round((e - s) / 86400000) : null;
    html += `<tr><td style="padding: 8px 10px; border-bottom: 1px solid #e0e0e0;">`;
    html += `<span style="color: ${color}; font-weight: bold;">&#9679;</span> `;
    html += `<strong style="color: #253746;">${p.label}</strong>`;
    if (days !== null) html += ` <span style="color: #888; font-size: 12px;">(${days} days)</span>`;
    html += `<br><span style="color: #555; font-size: 13px;">${isValid(p.start) ? fmtShort(p.start) : "N/A"} &rarr; ${isValid(p.end) ? fmtShort(p.end) : "N/A"}</span>`;
    html += `</td></tr>`;
  });
  html += '</table>';

  return html;
}

function markdownToHtml(text: string): string {
  text = text.replace(/\[TIMELINE\]\s*\n([\s\S]*?)\n\s*\[\/TIMELINE\]/gi, (_match, inner: string) => {
    const rows = inner.trim().split("\n").map((r: string) => r.trim()).filter(Boolean);
    if (rows.length === 0) return "";
    const phases = rows.map((row: string) => {
      const cells = row.split("|").map((c: string) => c.trim());
      return { label: cells[0] ?? "", start: cells[1] ?? "", end: cells[2] ?? "" };
    });
    return buildTimelineHtml(phases);
  });

  text = text.replace(/(?:^|\n)(?:#{1,3}\s*\*{0,2}|(?:\*{2}))?\s*(?:Project\s+)?(?:Timeline|Phases?|Schedule|Phase\s+Dates?)\s*:?\s*\*{0,2}\s*\n((?:\s*[-•*]\s*.+(?:to|[-–—])\s*[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}\s*\n?)+)/gi, (_match, inner: string) => {
    const phases: { label: string; start: string; end: string }[] = [];
    const lines = inner.trim().split("\n").map((l: string) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const m = line.match(/[-•*]\s*\*{0,2}(.+?)\*{0,2}\s*:?\s*([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})\s+(?:to|[-–—])\s+([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})/i);
      if (m) phases.push({ label: m[1].replace(/:\s*$/, "").trim(), start: m[2], end: m[3] });
    }
    if (phases.length === 0) return _match;
    return "\n" + buildTimelineHtml(phases);
  });

  const lines = text.split("\n");
  const htmlLines: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  function flushTable() {
    if (tableRows.length === 0) return;
    let html = '<table style="border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 14px;">';
    tableRows.forEach((cols, idx) => {
      const tag = idx === 0 ? "th" : "td";
      const style = idx === 0
        ? 'font-weight: bold; color: #253746; border-bottom: 2px solid #6BA539;'
        : `border-bottom: 1px solid #e0e0e0;${idx % 2 === 0 ? ' background-color: #f9f9f9;' : ''}`;
      html += "<tr>";
      for (const col of cols) {
        html += `<${tag} style="padding: 6px 10px; text-align: left; ${style}">${col.trim()}</${tag}>`;
      }
      html += "</tr>";
    });
    html += "</table>";
    htmlLines.push(html);
    tableRows = [];
    inTable = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\|.*\|$/.test(trimmed)) {
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;
      const cells = trimmed.slice(1, -1).split("|").map(c => c.trim());
      tableRows.push(cells);
      inTable = true;
      continue;
    }

    if (!trimmed.startsWith("|") && /^[^|]+\|[^|]+\|/.test(trimmed)) {
      const cells = trimmed.split("|").map(c => c.trim());
      tableRows.push(cells);
      inTable = true;
      continue;
    }

    if (inTable) flushTable();

    // Headings — check longest-prefix first so "#### " doesn't get caught by "### ".
    // Levels 4-6 collapse to the smallest heading (level 3 size).
    if (trimmed.startsWith("###### ")) {
      htmlLines.push(`<p style="margin: 12px 0 4px; font-weight: bold; color: #253746;">${formatInline(trimmed.slice(7))}</p>`);
    } else if (trimmed.startsWith("##### ")) {
      htmlLines.push(`<p style="margin: 12px 0 4px; font-weight: bold; color: #253746;">${formatInline(trimmed.slice(6))}</p>`);
    } else if (trimmed.startsWith("#### ")) {
      htmlLines.push(`<p style="margin: 12px 0 4px; font-weight: bold; color: #253746;">${formatInline(trimmed.slice(5))}</p>`);
    } else if (trimmed.startsWith("### ")) {
      htmlLines.push(`<p style="margin: 14px 0 4px; font-weight: bold; color: #253746;">${formatInline(trimmed.slice(4))}</p>`);
    } else if (trimmed.startsWith("## ")) {
      htmlLines.push(`<p style="margin: 14px 0 4px; font-weight: bold; font-size: 15px; color: #253746;">${formatInline(trimmed.slice(3))}</p>`);
    } else if (trimmed.startsWith("# ")) {
      htmlLines.push(`<p style="margin: 14px 0 4px; font-weight: bold; font-size: 16px; color: #253746;">${formatInline(trimmed.slice(2))}</p>`);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      htmlLines.push(`<div style="margin: 2px 0 2px 16px;">• ${formatInline(trimmed.slice(2))}</div>`);
    } else if (/^\d+\.\s/.test(trimmed)) {
      const content = trimmed.replace(/^\d+\.\s+/, "");
      htmlLines.push(`<div style="margin: 2px 0 2px 16px;">${trimmed.match(/^\d+/)![0]}. ${formatInline(content)}</div>`);
    } else if (trimmed === "---" || trimmed === "***") {
      htmlLines.push('<hr style="border: none; border-top: 1px solid #dee2e6; margin: 16px 0;">');
    } else if (trimmed === "") {
      htmlLines.push("<br>");
    } else {
      htmlLines.push(`<p style="margin: 4px 0; line-height: 1.6;">${formatInline(trimmed)}</p>`);
    }
  }

  if (inTable) flushTable();
  return htmlLines.join("\n");
}

function formatInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px; font-size: 13px;">$1</code>');
}

function formatUsername(username?: string): string {
  if (!username) return "";
  const name = username.replace(/_[a-z]{2,10}$/i, "").replace(/_/g, " ");
  return name.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function stripPlaceholders(text: string): string {
  return text
    .replace(/\[Your (?:Name|Position|Title|Company|Role|Department|Email|Phone)\]/gi, "")
    .replace(/\[(?:Sender'?s?\s*)?Name\]/gi, "")
    .replace(/\n+\s*RM ONE Team\s*$/i, "")
    .replace(/\n\s*\n\s*\n/g, "\n\n");
}

function buildEmailHtml(body: string, isAutoReply = false, senderName?: string): string {
  const content = markdownToHtml(stripPlaceholders(body));
  const signName = senderName || "";
  const signature = signName
    ? `<p style="margin-top: 24px; font-size: 13px; color: #333;">Best regards,<br><strong>${signName}</strong><br><span style="font-size: 12px; color: #888;">via <span style="color: #253746; font-weight: bold;">RM</span><span style="color: #6BA539; font-weight: bold;">ONE</span></span></p>`
    : `<p style="margin-top: 24px; font-size: 12px; color: #999;">Best regards,<br><span style="color: #253746; font-weight: bold;">RM</span><span style="color: #6BA539; font-weight: bold;">ONE</span></p>`;
  return `<div style="font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.7; color: #333;">
<p style="margin: 0 0 4px 0; font-size: 22px; font-weight: 900; letter-spacing: -0.5px;"><span style="color: #253746;">RM</span><span style="color: #6BA539;">ONE</span></p>
<hr style="border: none; border-top: 3px solid #6BA539; margin: 0 0 20px 0;">
${content}
${isAutoReply ? '<p style="font-size: 12px; color: #888; margin-top: 16px;">This is an automated response. For urgent matters, please contact your project manager directly.</p>' : ''}
${signature}
</div>`;
}

export interface SendEmailParams {
  to: string[];
  subject: string;
  body: string;
  /** Optional pre-built HTML that replaces the auto-generated HTML body.
   *  The plain-text `body` is still sent as the text/plain fallback. */
  htmlBody?: string;
  cc?: string[];
  sentBy?: string;
  senderDisplayName?: string;
  // Transactional/automated emails (e.g. password-set invites) where replies
  // should NOT land in the shared inbox. The thread is tagged with the special
  // NOREPLY_OWNER so listInboxMessages hides both the sent message AND any reply
  // on that thread, while every other email keeps arriving normally.
  noReply?: boolean;
}

export interface SendCalendarInviteParams {
  to: string[];
  subject: string;
  body: string;
  date: string;
  startTime: string;
  endTime: string;
  location?: string;
  cc?: string[];
  bcc?: string[];
  timezone?: string;
  sentBy?: string;
  senderDisplayName?: string;
  senderEmail?: string;
}

const _threadOwner = new Map<string, string>();
let _ownerDirty = false;

// Sentinel owner tag for transactional/no-reply threads (password-set invites).
// Any message whose owner OR thread owner equals this is hidden from every
// inbox view — so neither the outbound invite nor an inbound reply ever shows up.
const NOREPLY_OWNER = "__noreply__";

function loadOwnerMap() {
  try {
    if (fs.existsSync(OWNER_FILE)) {
      const raw = fs.readFileSync(OWNER_FILE, "utf-8");
      const obj = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) _threadOwner.set(k, v);
      console.log(`[agentmail] loaded ${_threadOwner.size} owner tags from disk`);
    }
  } catch (e) {
    console.error("[agentmail] failed to load owner map:", e);
  }
}

function saveOwnerMap() {
  if (!_ownerDirty) return;
  try {
    const dir = path.dirname(OWNER_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, string> = {};
    for (const [k, v] of _threadOwner.entries()) obj[k] = v;
    fs.writeFileSync(OWNER_FILE, JSON.stringify(obj), "utf-8");
    _ownerDirty = false;
  } catch (e) {
    console.error("[agentmail] failed to save owner map:", e);
  }
}

loadOwnerMap();

const _deletedMessages = new Set<string>();
let _deletedDirty = false;

function loadDeletedMessages() {
  try {
    if (fs.existsSync(DELETED_FILE)) {
      const raw = fs.readFileSync(DELETED_FILE, "utf-8");
      const arr = JSON.parse(raw) as string[];
      for (const id of arr) _deletedMessages.add(id);
      console.log(`[agentmail] loaded ${_deletedMessages.size} deleted message IDs from disk`);
    }
  } catch (e) {
    console.error("[agentmail] failed to load deleted messages:", e);
  }
}

function saveDeletedMessages() {
  if (!_deletedDirty) return;
  try {
    const dir = path.dirname(DELETED_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DELETED_FILE, JSON.stringify([..._deletedMessages]), "utf-8");
    _deletedDirty = false;
  } catch (e) {
    console.error("[agentmail] failed to save deleted messages:", e);
  }
}

loadDeletedMessages();

export function tagMessageOwner(messageId: string, username: string) {
  if (messageId && username) {
    _threadOwner.set(messageId, username.toLowerCase());
    _ownerDirty = true;
    saveOwnerMap();
  }
}

export function getMessageOwner(messageId: string): string | undefined {
  return _threadOwner.get(messageId);
}

async function claimUnownedThreadsFromSender(senderAddresses: string[], claimUser: string) {
  try {
    const resp = await fetch(`${AGENTMAIL_BASE}/inboxes/${INBOX_EMAIL}/messages?limit=50`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!resp.ok) return;
    const data = await resp.json() as Record<string, unknown>;
    const msgs = (data.messages || []) as any[];
    const senderLower = senderAddresses.map(s => s.toLowerCase());
    for (const m of msgs) {
      const from = ((m.from || "") as string).toLowerCase();
      const msgId = m.message_id || m.messageId;
      const threadId = m.thread_id || m.threadId;
      const isSent = isOurAddress(from);
      if (isSent) continue;
      const matchesSender = senderLower.some(s => from.includes(s));
      if (!matchesSender) continue;
      const existingMsgOwner = _threadOwner.get(msgId);
      const existingThreadOwner = threadId ? _threadOwner.get(`thread:${threadId}`) : undefined;
      if (!existingMsgOwner && !existingThreadOwner) {
        console.log(`[agentmail] auto-claiming incoming thread from ${from} for ${claimUser} (msgId=${msgId} threadId=${threadId})`);
        if (msgId) { _threadOwner.set(msgId, claimUser); _ownerDirty = true; }
        if (threadId) { _threadOwner.set(`thread:${threadId}`, claimUser); _ownerDirty = true; }
      }
    }
    if (_ownerDirty) saveOwnerMap();
  } catch (e) {
    console.error("[agentmail] claimUnownedThreadsFromSender error:", e);
  }
}

export async function sendEmail(params: SendEmailParams): Promise<{ ok: boolean; message: string; messageId?: string; error?: string }> {
  try {
    await ensureInbox();
    const cleanBody = stripPlaceholders(params.body);
    let subject = (params.subject || "").trim();
    if (!subject && cleanBody) {
      const firstLine = cleanBody.split(/[\n.!?]/)[0].trim();
      subject = firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
      if (!subject) subject = "RM ONE Notification";
      console.log(`[agentmail] auto-generated subject from body: "${subject}"`);
    }
    const fromName = params.senderDisplayName || formatUsername(params.sentBy) || "RM ONE";
    const resp = await fetch(`${AGENTMAIL_BASE}/inboxes/${INBOX_EMAIL}/messages/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        to: params.to,
        cc: params.cc,
        subject,
        text: cleanBody,
        html: params.htmlBody ?? buildEmailHtml(cleanBody, false, fromName),
        from_name: fromName,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[agentmail] send email failed: ${resp.status} ${err}`);
      return { ok: false, message: `Failed to send email (${resp.status}): ${err.slice(0, 200)}` };
    }

    const data = await resp.json() as Record<string, unknown>;
    const msgId = (data.message_id || data.messageId) as string;
    if (params.sentBy && msgId) {
      tagMessageOwner(msgId, params.sentBy);
      const threadId = (data.thread_id || data.threadId) as string;
      if (threadId) tagMessageOwner(`thread:${threadId}`, params.sentBy);
      claimUnownedThreadsFromSender(params.to, params.sentBy.toLowerCase());
    }
    if (params.noReply && msgId) {
      // Override any prior tag: a transactional invite thread is always hidden.
      const threadId = (data.thread_id || data.threadId) as string;
      tagMessageOwner(msgId, NOREPLY_OWNER);
      if (threadId) tagMessageOwner(`thread:${threadId}`, NOREPLY_OWNER);
    }
    console.log(`[agentmail] email sent to ${params.to.join(", ")} subject="${subject}" by=${params.sentBy || "unknown"}${params.noReply ? " (no-reply)" : ""}`);
    return { ok: true, message: `Email sent successfully to ${params.to.join(", ")}`, messageId: msgId };
  } catch (err: any) {
    console.error("[agentmail] send email failed:", err);
    return { ok: false, message: `Failed to send email: ${err.message || String(err)}` };
  }
}

export async function sendCalendarInvite(params: SendCalendarInviteParams): Promise<{ ok: boolean; message: string; messageId?: string }> {
  try {
    await ensureInbox();

    const icsAttendees = [...params.to];
    if (params.senderEmail) icsAttendees.push(params.senderEmail);
    const icsContent = generateICS({
      summary: params.subject,
      description: params.body,
      location: params.location,
      startDate: params.date,
      startTime: params.startTime,
      endTime: params.endTime,
      organizerEmail: INBOX_EMAIL,
      attendees: icsAttendees,
      timezone: params.timezone,
    });

    const icsBase64 = Buffer.from(icsContent).toString("base64");

    const d = params.date.replace(/-/g, "");
    const fmtTime = (t: string) => t.replace(":", "") + "00";
    const gcalDates = `${d}T${fmtTime(params.startTime)}/${d}T${fmtTime(params.endTime)}`;
    const gcalParams = new URLSearchParams({
      text: params.subject,
      dates: gcalDates,
      details: params.body,
    });
    if (params.location) gcalParams.set("location", params.location);
    gcalParams.set("vcon", "meet");
    const allAttendees = [...params.to];
    if (params.cc) allAttendees.push(...params.cc);
    if (params.senderEmail) allAttendees.push(params.senderEmail);
    if (allAttendees.length > 0) gcalParams.set("add", allAttendees.join(","));
    if (params.timezone) gcalParams.set("ctz", params.timezone);
    const gcalLink = `https://calendar.google.com/calendar/r/eventedit?${gcalParams.toString()}`;

    const cleanCalBody = stripPlaceholders(params.body);
    const calFromName = params.senderDisplayName || formatUsername(params.sentBy) || "RM ONE";
    const resp = await fetch(`${AGENTMAIL_BASE}/inboxes/${INBOX_EMAIL}/messages/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        to: params.to,
        cc: params.senderEmail ? [...(params.cc || []), params.senderEmail] : params.cc,
        subject: params.subject,
        text: `${cleanCalBody}\n\nMeeting Details:\nDate: ${params.date}\nTime: ${params.startTime} – ${params.endTime}${params.location ? `\nLocation: ${params.location}` : ""}\n\nAdd to Google Calendar with video call: ${gcalLink}`,
        from_name: calFromName,
        html: `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333;">
${buildEmailHtml(cleanCalBody, false, calFromName)}
<p style="margin-top: 14px; padding: 10px; border-left: 3px solid #6BA539;"><strong style="color: #253746;">Meeting Details</strong><br>
<span style="color: #555;">Date:</span> ${params.date}<br>
<span style="color: #555;">Time:</span> ${params.startTime} – ${params.endTime}${params.location ? `<br><span style="color: #555;">Location:</span> ${params.location}` : ""}</p>
<p style="font-size: 13px;"><a href="${gcalLink}" style="color: #1a73e8; text-decoration: none;">📅 Add to Google Calendar with Google Meet</a></p>
</div>`,
        attachments: [
          {
            filename: "invite.ics",
            content: icsBase64,
            content_type: "text/calendar; charset=utf-8; method=REQUEST",
          },
          {
            filename: "invite.ics",
            content: icsBase64,
            content_type: "application/ics; charset=utf-8; method=REQUEST",
          },
        ],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[agentmail] send calendar invite failed: ${resp.status} ${err}`);
      return { ok: false, message: `Failed to send invite (${resp.status}): ${err.slice(0, 200)}` };
    }

    const data = await resp.json() as Record<string, unknown>;
    const msgId = (data.message_id || data.messageId) as string;
    if (params.sentBy && msgId) {
      tagMessageOwner(msgId, params.sentBy);
      const threadId = (data.thread_id || data.threadId) as string;
      if (threadId) tagMessageOwner(`thread:${threadId}`, params.sentBy);
      claimUnownedThreadsFromSender(params.to, params.sentBy.toLowerCase());
    }
    console.log(`[agentmail] calendar invite sent to ${params.to.join(", ")} date=${params.date} ${params.startTime}-${params.endTime} by=${params.sentBy || "unknown"} bcc=${params.senderEmail || "none"}`);
    const ccNote = params.senderEmail ? ` You are CC'd at ${params.senderEmail} — accept the calendar invite from your inbox to add it to your calendar.` : "";
    return { ok: true, message: `Calendar invite sent to ${params.to.join(", ")} for ${params.date} at ${params.startTime}. Everyone will receive a calendar invite they can Accept/Decline directly.${ccNote}`, messageId: msgId };
  } catch (err: any) {
    console.error("[agentmail] send calendar invite failed:", err);
    return { ok: false, message: `Failed to send calendar invite: ${err.message || String(err)}` };
  }
}

async function fetchInboxRaw(inboxAddr: string, safeLimit: number): Promise<any[]> {
  try {
    const resp = await fetch(`${AGENTMAIL_BASE}/inboxes/${inboxAddr}/messages?limit=${safeLimit}`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as Record<string, unknown>;
    return ((data.messages || []) as any[]);
  } catch { return []; }
}

export async function listInboxMessages(limit = 10, forUser?: string, userRoles?: string): Promise<{ ok: boolean; messages: any[]; error?: string }> {
  try {
    await ensureInbox();
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const [newMsgs, oldMsgs] = await Promise.all([
      fetchInboxRaw(INBOX_EMAIL, safeLimit),
      fetchInboxRaw(INBOX_EMAIL_OLD, safeLimit),
    ]);
    const seenIds = new Set<string>();
    const allRaw: any[] = [];
    for (const m of [...newMsgs, ...oldMsgs]) {
      const msgId = m.message_id || m.messageId;
      if (seenIds.has(msgId)) continue;
      seenIds.add(msgId);
      allRaw.push(m);
    }
    allRaw.sort((a, b) => {
      const da = new Date(a.timestamp || a.created_at || a.createdAt || 0).getTime();
      const db = new Date(b.timestamp || b.created_at || b.createdAt || 0).getTime();
      return db - da;
    });
    const rawMsgs = allRaw.slice(0, safeLimit).filter((m: any) => {
      const msgId = m.message_id || m.messageId;
      return !_deletedMessages.has(msgId);
    });
    const msgs = rawMsgs.map((m: any) => {
      const fromStr = (m.from || "") as string;
      const isSent = isOurAddress(fromStr);
      const previewText = (m.preview || "").split(/\nOn .* wrote:/)[0].trim();
      const msgId = m.message_id || m.messageId;
      const threadId = m.thread_id || m.threadId;
      const attachments = Array.isArray(m.attachments) ? m.attachments : [];
      return {
        id: msgId,
        from: fromStr,
        to: Array.isArray(m.to) ? m.to.join(", ") : (m.to || ""),
        subject: m.subject,
        date: m.timestamp || m.created_at || m.createdAt,
        preview: previewText.slice(0, 500),
        direction: isSent ? "sent" : "received" as const,
        threadId: threadId || undefined,
        owner: _threadOwner.get(msgId) || (threadId ? _threadOwner.get(`thread:${threadId}`) : undefined),
        hasAttachments: attachments.length > 0,
        attachmentNames: attachments.map((a: any) => a.filename || "file").slice(0, 5),
      };
    });

    // Transactional/no-reply threads (password-set invites) are hidden from
    // EVERY inbox view — the outbound invite and any inbound reply both carry
    // the NOREPLY_OWNER tag on the thread, so this single guard suppresses both
    // while leaving all other mail untouched.
    const visibleMsgs = msgs.filter(m => {
      if (m.owner === NOREPLY_OWNER) return false;
      const threadOwner = m.threadId ? _threadOwner.get(`thread:${m.threadId}`) : undefined;
      if (threadOwner === NOREPLY_OWNER) return false;
      return true;
    });

    if (forUser) {
      const userLower = forUser.toLowerCase();
      const rolesList = (userRoles || "").split(",").map(r => r.trim().toLowerCase());
      const ADMIN_ROLES = ["admin", "super admin", "poradmingroup"];
      const isAdmin = rolesList.some(r => ADMIN_ROLES.includes(r));
      console.log(`[agentmail] inbox filter: user=${userLower} roles=[${rolesList.join(",")}] isAdmin=${isAdmin}`);
      const filtered = visibleMsgs.filter(m => {
        const threadOwner = m.threadId ? _threadOwner.get(`thread:${m.threadId}`) : undefined;
        if (m.owner === userLower) return true;
        if (threadOwner === userLower) return true;
        if (m.owner === "__auto__") return true;
        if (m.owner && m.owner !== userLower) return false;
        if (threadOwner && threadOwner !== userLower) return false;
        if (!m.owner && m.direction === "received") return isAdmin;
        if (!m.owner && m.direction === "sent") return false;
        return false;
      });
      return { ok: true, messages: filtered };
    }

    return { ok: true, messages: visibleMsgs };
  } catch (err: any) {
    return { ok: false, messages: [], error: err.message || String(err) };
  }
}

export async function deleteMessage(messageId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureInbox();
    const encoded = encodeURIComponent(messageId);
    const inboxes = [INBOX_EMAIL, INBOX_EMAIL_OLD, INBOX_EMAIL_LEGACY];
    let apiDeleted = false;
    for (const inbox of inboxes) {
      try {
        const resp = await fetch(`${AGENTMAIL_BASE}/inboxes/${inbox}/messages/${encoded}`, {
          method: "DELETE",
          headers: authHeaders(),
        });
        if (resp.ok || resp.status === 204) {
          console.log(`[agentmail] permanently deleted message ${messageId} from ${inbox}`);
          apiDeleted = true;
          break;
        }
        if (resp.status === 404) continue;
        console.warn(`[agentmail] delete from ${inbox} returned ${resp.status}`);
      } catch (e: any) {
        console.warn(`[agentmail] delete attempt from ${inbox} failed:`, e.message);
      }
    }
    _deletedMessages.add(messageId);
    _deletedDirty = true;
    saveDeletedMessages();
    if (!apiDeleted) {
      console.log(`[agentmail] message ${messageId} not found in API, soft-deleted locally`);
    }
    return { ok: true };
  } catch (err: any) {
    console.error("[agentmail] delete message failed:", err);
    return { ok: false, error: err.message || String(err) };
  }
}

export async function getMessageDetail(messageId: string): Promise<{ ok: boolean; body?: string; html?: string; imageAttachments?: Array<{ filename: string; dataUrl: string }>; error?: string }> {
  try {
    await ensureInbox();
    const encoded = encodeURIComponent(messageId);
    let inboxUsed = INBOX_EMAIL;
    let resp = await fetch(`${AGENTMAIL_BASE}/inboxes/${INBOX_EMAIL}/messages/${encoded}`, {
      headers: authHeaders(),
    });
    if (!resp.ok && INBOX_EMAIL_OLD) {
      inboxUsed = INBOX_EMAIL_OLD;
      resp = await fetch(`${AGENTMAIL_BASE}/inboxes/${INBOX_EMAIL_OLD}/messages/${encoded}`, {
        headers: authHeaders(),
      });
    }
    if (!resp.ok) {
      return { ok: false, error: `Failed to fetch message (${resp.status})` };
    }
    const detail = await resp.json() as Record<string, unknown>;
    const text = String(detail.extracted_text || detail.text || detail.preview || "");
    const html = detail.html ? String(detail.html) : undefined;
    const cleanText = text.split(/\nOn .* wrote:/)[0].trim();

    let attachmentText = "";
    const imageAttachments: Array<{ filename: string; dataUrl: string }> = [];
    const MAX_ATTACHMENTS = 5;
    const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
    const MAX_TOTAL_TEXT = 80000;
    const ALLOWED_DOWNLOAD_HOSTS = ["cdn.agentmail.to", "agentmail.to"];
    const FETCH_TIMEOUT_MS = 15000;
    const attachments = detail.attachments as Array<{
      attachment_id: string;
      filename: string;
      size: number;
      content_type: string;
    }> | undefined;
    if (attachments && attachments.length > 0) {
      const toProcess = attachments.slice(0, MAX_ATTACHMENTS);
      console.log(`[agentmail] message has ${attachments.length} attachment(s), processing ${toProcess.length}:`, toProcess.map(a => `${a.filename} (${a.content_type}, ${a.size}b)`).join(", "));
      let totalExtracted = 0;
      for (const att of toProcess) {
        if (att.size > MAX_ATTACHMENT_SIZE) {
          attachmentText += `\n\n[Attachment: ${att.filename} (${Math.round(att.size / 1024 / 1024)}MB) — too large to extract]`;
          console.log(`[agentmail] skipped oversized attachment ${att.filename} (${att.size}b)`);
          continue;
        }
        if (totalExtracted >= MAX_TOTAL_TEXT) {
          console.log(`[agentmail] reached total extraction limit, skipping remaining attachments`);
          break;
        }
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
          const attResp = await fetch(
            `${AGENTMAIL_BASE}/inboxes/${inboxUsed}/messages/${encoded}/attachments/${att.attachment_id}`,
            { headers: authHeaders(), signal: controller.signal },
          );
          clearTimeout(timeout);
          if (!attResp.ok) {
            console.log(`[agentmail] failed to fetch attachment metadata ${att.attachment_id}: ${attResp.status}`);
            continue;
          }
          const attDetail = await attResp.json() as Record<string, unknown>;
          const downloadUrl = attDetail.download_url as string | undefined;
          if (!downloadUrl) {
            console.log(`[agentmail] no download_url for attachment ${att.attachment_id}`);
            continue;
          }

          try {
            const dlHost = new URL(downloadUrl).hostname;
            if (!ALLOWED_DOWNLOAD_HOSTS.some(h => dlHost === h || dlHost.endsWith(`.${h}`))) {
              console.log(`[agentmail] blocked download from untrusted host: ${dlHost}`);
              continue;
            }
          } catch {
            console.log(`[agentmail] invalid download URL for attachment ${att.attachment_id}`);
            continue;
          }

          const isText = att.content_type.startsWith("text/") ||
            att.content_type === "application/json" ||
            att.content_type === "application/xml" ||
            /\.(txt|csv|json|xml|md|log|html|htm)$/i.test(att.filename);
          const isPdf = att.content_type === "application/pdf" || /\.pdf$/i.test(att.filename);

          if (isText || isPdf) {
            const dlController = new AbortController();
            const dlTimeout = setTimeout(() => dlController.abort(), FETCH_TIMEOUT_MS);
            const dlResp = await fetch(downloadUrl, { signal: dlController.signal });
            clearTimeout(dlTimeout);
            if (dlResp.ok) {
              let content: string;
              if (isPdf) {
                const buf = Buffer.from(await dlResp.arrayBuffer());
                try {
                  const pdfParse = (await import("pdf-parse")).default;
                  const parsed = await pdfParse(buf);
                  content = parsed.text || "";
                } catch (pdfErr: any) {
                  content = buf.toString("utf-8").replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/ {2,}/g, " ");
                  console.log(`[agentmail] pdf-parse failed for ${att.filename}, using raw text fallback: ${pdfErr.message}`);
                }
              } else {
                content = await dlResp.text();
              }
              const remaining = MAX_TOTAL_TEXT - totalExtracted;
              const trimmed = content.trim().slice(0, Math.min(50000, remaining));
              if (trimmed) {
                attachmentText += `\n\n--- ATTACHMENT: ${att.filename} ---\n${trimmed}\n--- END ATTACHMENT ---`;
                totalExtracted += trimmed.length;
                console.log(`[agentmail] extracted ${trimmed.length} chars from attachment ${att.filename}`);
              }
            }
          } else if (att.content_type.startsWith("image/") && att.size <= MAX_IMAGE_SIZE) {
            const dlController = new AbortController();
            const dlTimeout = setTimeout(() => dlController.abort(), FETCH_TIMEOUT_MS);
            try {
              const dlResp = await fetch(downloadUrl, { signal: dlController.signal });
              clearTimeout(dlTimeout);
              if (dlResp.ok) {
                const buf = Buffer.from(await dlResp.arrayBuffer());
                const b64 = buf.toString("base64");
                const mimeType = att.content_type || "image/jpeg";
                imageAttachments.push({ filename: att.filename, dataUrl: `data:${mimeType};base64,${b64}` });
                attachmentText += `\n\n[Attachment: ${att.filename} (${att.content_type}, ${Math.round(att.size / 1024)}KB) — image file, included for AI vision analysis]`;
                console.log(`[agentmail] downloaded image attachment ${att.filename} (${Math.round(buf.length / 1024)}KB) as base64`);
              } else {
                attachmentText += `\n\n[Attachment: ${att.filename} (${att.content_type}, ${Math.round(att.size / 1024)}KB) — image download failed]`;
                console.log(`[agentmail] failed to download image ${att.filename}: ${dlResp.status}`);
              }
            } catch (imgErr: any) {
              clearTimeout(dlTimeout);
              attachmentText += `\n\n[Attachment: ${att.filename} (${att.content_type}, ${Math.round(att.size / 1024)}KB) — image download error]`;
              console.log(`[agentmail] error downloading image ${att.filename}: ${imgErr.message}`);
            }
          } else {
            attachmentText += `\n\n[Attachment: ${att.filename} (${att.content_type}, ${Math.round(att.size / 1024)}KB) — binary file, cannot extract text]`;
            console.log(`[agentmail] skipped binary attachment ${att.filename} (${att.content_type})`);
          }
        } catch (attErr: any) {
          console.log(`[agentmail] error fetching attachment ${att.attachment_id}: ${attErr.message}`);
        }
      }
    }

    const fullBody = attachmentText ? `${cleanText}${attachmentText}` : cleanText;
    return { ok: true, body: fullBody, html, imageAttachments: imageAttachments.length > 0 ? imageAttachments : undefined };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

export async function getInboxEmail(): Promise<string> {
  await ensureInbox();
  return INBOX_EMAIL;
}
