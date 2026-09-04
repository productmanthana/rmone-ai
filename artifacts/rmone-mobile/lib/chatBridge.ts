type PromptPayload = { prompt: string; context?: string; imageAttachments?: Array<{ filename: string; dataUrl: string }>; ts: number; newSession?: boolean };
type Listener = (payload: PromptPayload) => void;

let _pending: PromptPayload | null = null;
const _listeners = new Set<Listener>();

export function setChatPrompt(prompt: string, context?: string, newSession?: boolean, imageAttachments?: Array<{ filename: string; dataUrl: string }>) {
  const payload: PromptPayload = { prompt, context, imageAttachments, ts: Date.now(), newSession };
  _pending = payload;
  _listeners.forEach(fn => fn(payload));
}

export function consumeChatPrompt(): PromptPayload | null {
  const p = _pending;
  _pending = null;
  return p;
}

export function peekChatPrompt(): PromptPayload | null {
  return _pending;
}

export function onChatPrompt(fn: Listener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

const _scheduleListeners = new Set<() => void>();
export function notifyScheduleChanged(_projectId?: string) {
  _scheduleListeners.forEach(fn => fn());
}
export function onScheduleChanged(fn: () => void): () => void {
  _scheduleListeners.add(fn);
  return () => { _scheduleListeners.delete(fn); };
}
