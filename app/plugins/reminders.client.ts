import { watch } from "vue";
import { partitionReminders, msUntil, type Reminder } from "~/utils/reminders";
import { useReminderToggle } from "~/composables/useReminderToggle";

// Foreground reminder notifier. While reminders are enabled (Settings toggle)
// and permission is granted, it polls /api/reminders, fires a browser
// notification for anything due (including ones missed while the tab was
// closed), and schedules timers for ones coming up soon. Tab-lifetime only —
// the pure due/upcoming logic lives in ~/utils/reminders and is unit-tested.

const POLL_MS = 5 * 60 * 1000; // re-scan every 5 min for new/edited reminders

export default defineNuxtPlugin(() => {
  const { active } = useReminderToggle();

  const timers = new Set<ReturnType<typeof setTimeout>>();
  // Ids fired this session — guards against a poll racing an in-flight POST.
  const firedThisSession = new Set<string>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function clearTimers(): void {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }

  async function fire(reminder: Reminder): Promise<void> {
    if (firedThisSession.has(reminder.id)) return;
    firedThisSession.add(reminder.id);
    try {
      const n = new Notification("Reminder", { body: reminder.title, tag: reminder.id });
      n.onclick = () => { window.focus(); n.close(); };
    } catch {
      // Notification construction can throw if permission was revoked mid-session.
    }
    try {
      await $fetch(`/api/reminders/${reminder.id}/notified`, { method: "POST" });
    } catch {
      // Best-effort — a missed mark just means a possible duplicate on next load.
    }
  }

  async function scan(): Promise<void> {
    if (!active.value) return;
    let reminders: Reminder[];
    try {
      reminders = await $fetch<Reminder[]>("/api/reminders");
    } catch {
      return; // not signed in / offline — try again next poll
    }
    clearTimers();
    const { due, upcoming } = partitionReminders(reminders, Date.now());
    for (const r of due) void fire(r);
    for (const r of upcoming) {
      const t = setTimeout(() => void fire(r), msUntil(r, Date.now()));
      timers.add(t);
    }
  }

  function start(): void {
    if (pollTimer) return;
    void scan();
    pollTimer = setInterval(() => void scan(), POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
  }

  function stop(): void {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    clearTimers();
    document.removeEventListener("visibilitychange", onVisible);
  }

  function onVisible(): void {
    if (document.visibilityState === "visible") void scan();
  }

  // React to the Settings toggle flipping at runtime.
  watch(active, (on) => (on ? start() : stop()), { immediate: true });
});
