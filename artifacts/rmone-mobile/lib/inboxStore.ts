import { Audio } from "expo-av";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { getApiBase } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  } as any),
});

let _currentUser: string | undefined;
let _currentUserRoles: string | undefined;
export function setInboxUser(username: string | undefined, userRoles?: string) {
  _currentUser = username;
  _currentUserRoles = userRoles;
}

const READ_IDS_KEY = "inbox_read_ids";

export interface InboxMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  preview: string;
  direction: "sent" | "received";
  threadId?: string;
  hasAttachments?: boolean;
  attachmentNames?: string[];
}

export interface InboxThread {
  id: string;
  subject: string;
  contact: string;
  contactEmail: string;
  lastDate: string;
  messages: InboxMessage[];
  unreadCount: number;
  lastPreview: string;
  lastDirection: "sent" | "received";
  hasAttachments?: boolean;
}

type Listener = () => void;
type NewMailListener = (msg: InboxMessage) => void;

let _messages: InboxMessage[] = [];
let _readIds: Set<string> = new Set();
let _loading = false;
let _listeners: Listener[] = [];
let _newMailListeners: NewMailListener[] = [];
let _knownIds: Set<string> = new Set();
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _firstLoad = true;
let _soundObj: Audio.Sound | null = null;

function notify() {
  _listeners.forEach((fn) => fn());
  syncAppBadge();
}

function notifyNewMail(msg: InboxMessage) {
  _newMailListeners.forEach((fn) => fn(msg));
}

export function subscribeInbox(fn: Listener): () => void {
  _listeners.push(fn);
  return () => {
    _listeners = _listeners.filter((l) => l !== fn);
  };
}

export function onNewMail(fn: NewMailListener): () => void {
  _newMailListeners.push(fn);
  return () => {
    _newMailListeners = _newMailListeners.filter((l) => l !== fn);
  };
}

export function getInboxMessages(): InboxMessage[] {
  return _messages;
}

export function getReadIds(): Set<string> {
  return _readIds;
}

export function isInboxLoading(): boolean {
  return _loading;
}

export function getUnreadCount(): number {
  return _messages.filter(
    (m) => m.direction === "received" && !_readIds.has(m.id),
  ).length;
}

function syncAppBadge() {
  try {
    const count = getUnreadCount();
    Notifications.setBadgeCountAsync(count).catch(() => {});
  } catch {}
}

export function markRead(id: string) {
  if (!_readIds.has(id)) {
    _readIds = new Set(_readIds).add(id);
    notify();
    _persistReadIds();
  }
}

async function _persistReadIds() {
  try {
    const arr = Array.from(_readIds).slice(-200);
    await AsyncStorage.setItem(READ_IDS_KEY, JSON.stringify(arr));
  } catch {}
}

export async function loadPersistedReadIds() {
  try {
    const raw = await AsyncStorage.getItem(READ_IDS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      _readIds = new Set(arr);
      notify();
    }
  } catch {}
}

async function playNotificationSound() {
  try {
    if (_soundObj) {
      await _soundObj.replayAsync();
      return;
    }
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });
    const { sound } = await Audio.Sound.createAsync(
      require("../assets/notification.wav"),
      { shouldPlay: true, volume: 0.8 },
    );
    _soundObj = sound;
  } catch (e) {
    console.warn("[inboxStore] sound error:", e);
  }
}

let _pendingInboxOpen = false;
export function consumePendingInboxOpen(): boolean {
  if (_pendingInboxOpen) {
    _pendingInboxOpen = false;
    return true;
  }
  return false;
}
export function setPendingInboxOpen() {
  _pendingInboxOpen = true;
}

let _notifPermissionGranted = false;
export async function requestNotificationPermission() {
  if (Platform.OS === "web") return;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === "granted") { _notifPermissionGranted = true; return; }
    const { status } = await Notifications.requestPermissionsAsync();
    _notifPermissionGranted = status === "granted";
  } catch (e) {
    console.warn("[inboxStore] notification permission error:", e);
  }
}

let _pushTokenRegistered = false;
export async function registerPushToken() {
  if (Platform.OS === "web" || _pushTokenRegistered) return;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      console.warn("[push] notification permission not granted");
      return;
    }
    _notifPermissionGranted = true;

    let expoToken = "";
    let deviceToken = "";

    try {
      const deviceResult = await Notifications.getDevicePushTokenAsync();
      deviceToken = typeof deviceResult.data === "string" ? deviceResult.data : JSON.stringify(deviceResult.data);
      console.log("[push] device token obtained (full):", deviceToken, "len:", deviceToken.length);
    } catch (e: any) {
      console.warn("[push] getDevicePushTokenAsync failed:", e.message);
    }

    try {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      const result = await Notifications.getExpoPushTokenAsync({
        ...(projectId ? { projectId } : {}),
      });
      expoToken = result.data;
      console.log("[push] expo token obtained:", expoToken.slice(0, 30) + "...");
    } catch (e: any) {
      console.warn("[push] getExpoPushTokenAsync failed:", e.message);
    }

    if (!expoToken && !deviceToken) {
      console.warn("[push] no push tokens obtained");
      return;
    }

    const base = getApiBase();
    const resp = await fetch(`${base}/api/chat/push-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: expoToken,
        deviceToken,
        username: _currentUser,
        platform: Platform.OS,
      }),
    });
    if (resp.ok) {
      _pushTokenRegistered = true;
      console.log("[push] tokens registered with server");
    } else {
      console.warn("[push] server registration failed:", resp.status);
    }
  } catch (e: any) {
    console.warn("[push] registerPushToken error:", e.message);
  }
}

function notifExtractName(addr: string): string {
  const match = addr.match(/^([^<]+)</);
  if (match) return match[1].trim();
  return addr.split("@")[0];
}

async function scheduleLocalNotification(msg: InboxMessage) {
  if (Platform.OS === "web" || !_notifPermissionGranted) return;
  try {
    const senderName = notifExtractName(msg.from);
    const subject = msg.subject || "(no subject)";
    const preview = (msg.preview || "").slice(0, 100);
    const unread = getUnreadCount();
    await Notifications.setBadgeCountAsync(unread).catch(() => {});
    const appState = AppState.currentState;
    if (appState === "active") return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `New email from ${senderName}`,
        subtitle: subject,
        body: preview,
        sound: true,
        badge: unread,
        data: { type: "inbox", messageId: msg.id },
      },
      trigger: null,
    });
  } catch (e) {
    console.warn("[inboxStore] local notification error:", e);
  }
}

export async function fetchInbox(): Promise<boolean> {
  _loading = true;
  notify();
  let ok = false;
  try {
    const base = getApiBase();
    const params = new URLSearchParams();
    if (_currentUser) params.set("user", _currentUser);
    if (_currentUserRoles) params.set("roles", _currentUserRoles);
    const qs = params.toString();
    const resp = await fetch(`${base}/api/chat/inbox${qs ? "?" + qs : ""}`);
    if (resp.ok) {
      const data = await resp.json();
      const newMessages: InboxMessage[] = data.messages || [];
      _messages = newMessages;

      if (_firstLoad) {
        _knownIds = new Set(newMessages.map((m) => m.id));
        _firstLoad = false;
      } else {
        for (const msg of newMessages) {
          if (!_knownIds.has(msg.id) && msg.direction === "received") {
            _knownIds.add(msg.id);
            playNotificationSound();
            notifyNewMail(msg);
            scheduleLocalNotification(msg);
            break;
          }
        }
        for (const msg of newMessages) {
          _knownIds.add(msg.id);
        }
      }
      ok = true;
    }
  } catch (e) {
    console.warn("[inboxStore] load error:", e);
  } finally {
    _loading = false;
    notify();
  }
  return ok;
}

export function startInboxPolling(intervalMs = 30000) {
  if (_pollTimer) return;
  fetchInbox();
  _pollTimer = setInterval(() => fetchInbox(), intervalMs);
}

export function stopInboxPolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

export async function deleteInboxMessage(msgId: string): Promise<boolean> {
  try {
    const base = getApiBase();
    const encoded = encodeURIComponent(msgId);
    const resp = await fetch(`${base}/api/chat/inbox/${encoded}`, { method: "DELETE" });
    if (resp.ok) {
      _messages = _messages.filter((m) => m.id !== msgId);
      notify();
      return true;
    }
  } catch {}
  return false;
}

export interface MessageDetailResult {
  body: string;
  imageAttachments?: Array<{ filename: string; dataUrl: string }>;
}

export async function fetchMessageDetail(
  msgId: string,
): Promise<string> {
  const result = await fetchMessageDetailFull(msgId);
  return result.body;
}

export async function fetchMessageDetailFull(
  msgId: string,
): Promise<MessageDetailResult> {
  try {
    const base = getApiBase();
    const encoded = encodeURIComponent(msgId);
    const resp = await fetch(`${base}/api/chat/inbox/${encoded}`);
    if (resp.ok) {
      const data = await resp.json();
      return {
        body: data.body || "",
        imageAttachments: data.imageAttachments,
      };
    }
  } catch {}
  return { body: "" };
}

function stripRePrefix(subject: string): string {
  return (subject || "").replace(/^(re:\s*|fwd?:\s*)+/i, "").trim().toLowerCase();
}

export async function getThreadContext(contactEmail: string, currentMsgId: string, currentSubject: string): Promise<string> {
  const emailLower = contactEmail.toLowerCase();
  const baseSubject = stripRePrefix(currentSubject);
  const hasRealSubject = (currentSubject || "").trim().length > 0 && baseSubject.length > 0 && baseSubject !== "(no subject)";
  if (!hasRealSubject) return "";
  const related = _messages.filter(m => {
    if (m.id === currentMsgId) return false;
    const from = (m.from || "").toLowerCase();
    const to = (m.to || "").toLowerCase();
    const contactMatch = from.includes(emailLower) || to.includes(emailLower);
    if (!contactMatch) return false;
    const msgSubject = stripRePrefix(m.subject || "");
    return msgSubject === baseSubject;
  });
  if (related.length === 0) return "";
  const parts: string[] = [];
  for (const m of related) {
    const dir = m.direction === "sent" ? "WE SENT" : "THEY SENT";
    let body = m.preview;
    const fullBody = await fetchMessageDetail(m.id);
    if (fullBody) body = fullBody;
    parts.push(`[${dir}] Subject: ${m.subject}\nBody: ${body}`);
  }
  return parts.join("\n\n");
}

export function getThreadedInbox(filter?: "all" | "received" | "sent"): InboxThread[] {
  const threadMap = new Map<string, InboxThread>();
  for (const m of _messages) {
    const rawSubject = (m.subject || "").trim();
    const base = stripRePrefix(rawSubject || "(no subject)");
    const rawContact = (m.direction === "received" ? m.from : m.to) || "";
    const contactEmail = (rawContact.match(/<([^>]+)>/)?.[1] || rawContact.split(",")[0].trim()).toLowerCase();
    const hasRealSubject = rawSubject.length > 0 && base !== "(no subject)" && base.length > 0;
    const key = hasRealSubject ? `${base}|||${contactEmail}` : `__nosubj_${m.id}`;

    const existing = threadMap.get(key);
    if (existing) {
      existing.messages.push(m);
      if (new Date(m.date) > new Date(existing.lastDate)) {
        existing.lastDate = m.date;
        existing.lastPreview = m.preview;
        existing.lastDirection = m.direction;
      }
      if (m.hasAttachments) existing.hasAttachments = true;
      if (!_readIds.has(m.id) && m.direction === "received") {
        existing.unreadCount++;
      }
    } else {
      const contact = m.direction === "received" ? extractName(m.from || "") : extractName(m.to || "");
      threadMap.set(key, {
        id: key,
        subject: hasRealSubject ? (rawSubject.replace(/^(Re:\s*|Fwd?:\s*)+/i, "").trim() || "(no subject)") : "(no subject)",
        contact,
        contactEmail,
        lastDate: m.date,
        messages: [m],
        unreadCount: (!_readIds.has(m.id) && m.direction === "received") ? 1 : 0,
        lastPreview: m.preview,
        lastDirection: m.direction,
        hasAttachments: m.hasAttachments || false,
      });
    }
  }

  let threads = Array.from(threadMap.values());
  if (filter === "received") {
    threads = threads.filter(t => t.messages.some(m => m.direction === "received"));
  } else if (filter === "sent") {
    threads = threads.filter(t => t.messages.some(m => m.direction === "sent"));
  }
  threads.sort((a, b) => new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime());
  for (const t of threads) {
    t.messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }
  return threads;
}

export function extractName(fromStr: string): string {
  const m = fromStr.match(/^([^<]+)</);
  if (m) return m[1].trim();
  return fromStr.split("@")[0];
}

export function formatInboxDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
