import { useSyncExternalStore } from 'react';
import * as core from './timerCore';
import type { NewTimer, Timer } from './timerCore';

// Cooking timers. Several can run at once (potatoes in the air fryer while the sauce
// simmers). Each is stored as an end time, not a countdown (lib/timerCore), so it stays
// right when the tab sleeps or the phone locks, and the list is saved on the device so a
// reload keeps them. The moment the page is visible again, anything that ended meanwhile
// shows as finished. When one finishes: a sound, a vibration where supported, and a
// notification if the user allowed them (asked once, the first time a timer starts).
// A finished timer stays until it is dismissed.

export type { Timer };
export { findTimer, formatClock, remainingMs, timerAction, timerDetail } from './timerCore';

const KEY = 'forka_timers_v1';
const ASKED_KEY = 'forka_timer_notifications_asked';
let timers: Timer[] = load();
const listeners = new Set<() => void>();

function load(): Timer[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Timer[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function commit(next: Timer[]) {
  timers = next;
  try { localStorage.setItem(KEY, JSON.stringify(timers)); } catch { /* storage unavailable */ }
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => timers;

export function useTimers(): Timer[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// ── Alerts ─────────────────────────────────────────────────────────────────

let audio: AudioContext | null = null;

/** Create the audio context during a user gesture (starting a timer) so it may play later. */
function unlockAudio() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio = audio ?? new Ctx();
    if (audio.state === 'suspended') void audio.resume();
  } catch { /* no Web Audio */ }
}

function chime() {
  if (!audio) return;
  try {
    if (audio.state === 'suspended') void audio.resume();
    const t0 = audio.currentTime;
    [0, 0.35, 0.7].forEach((offset, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.connect(gain);
      gain.connect(audio!.destination);
      osc.type = 'sine';
      osc.frequency.value = i === 2 ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.3);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.32);
    });
  } catch { /* ignore */ }
}

async function notify(t: Timer) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const title = `${core.timerAction(t.label)} is done`;
  const options: NotificationOptions = { body: core.timerDetail(t), tag: t.id, icon: `${import.meta.env.BASE_URL}forka-logo.png` };
  try {
    // Android shows notifications only through the service worker; elsewhere either works.
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) { await reg.showNotification(title, options); return; }
  } catch { /* fall back below */ }
  try { new Notification(title, options); } catch { /* not allowed here */ }
}

function alertDone(t: Timer) {
  chime();
  try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch { /* unsupported */ }
  void notify(t);
}

/** Asks to show notifications the first time someone starts a timer, and never again. */
function askNotificationPermissionOnce() {
  try {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    if (localStorage.getItem(ASKED_KEY) === '1') return;
    localStorage.setItem(ASKED_KEY, '1');
    void Notification.requestPermission();
  } catch { /* unsupported */ }
}

/** Finishes whatever has ended (also what ended while the page slept) and alerts once each. */
function check() {
  const { list, finished } = core.settle(timers, Date.now());
  if (finished.length) {
    commit(list);
    finished.forEach(alertDone);
  }
}

// Checks twice a second, and straight away whenever the page comes back.
let ticker: number | null = null;
function ensureTicker() {
  if (ticker !== null || typeof window === 'undefined') return;
  ticker = window.setInterval(() => {
    check();
    // Repeat the sound every few seconds until dismissed, so it isn't missed across the kitchen.
    if (timers.some(t => t.done) && Math.floor(Date.now() / 500) % 8 === 0) chime();
  }, 500);
  const onReturn = () => { if (document.visibilityState === 'visible') check(); };
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('pageshow', onReturn);
  window.addEventListener('focus', onReturn);
}
if (typeof window !== 'undefined') { ensureTicker(); check(); }

// ── Actions ────────────────────────────────────────────────────────────────

export function startTimer(opts: NewTimer): string {
  unlockAudio();
  askNotificationPermissionOnce();
  ensureTicker();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  commit([...timers, core.createTimer(opts, Date.now(), id)]);
  return id;
}

export function pauseTimer(id: string) {
  commit(timers.map(t => (t.id === id ? core.pause(t, Date.now()) : t)));
}

export function resumeTimer(id: string) {
  unlockAudio();
  commit(timers.map(t => (t.id === id ? core.resume(t, Date.now()) : t)));
}

export function addMinute(id: string) {
  unlockAudio();
  commit(timers.map(t => (t.id === id ? core.addMinute(t, Date.now()) : t)));
}

/** Stops and removes a timer (cancel, or dismiss once it's done). */
export function removeTimer(id: string) {
  commit(timers.filter(t => t.id !== id));
}
