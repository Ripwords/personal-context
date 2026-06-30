import { computed } from "vue";

// Per-device preference for reminder notifications. Stored in localStorage
// because the Notification permission it gates is itself per-browser. Shared
// app-wide via useState so the Settings toggle and the notifier plugin stay in
// sync.

const STORAGE_KEY = "bd:reminders:enabled";

export type ReminderPermission = NotificationPermission | "unsupported";

export function useReminderToggle() {
  const enabled = useState<boolean>("reminders:enabled", () => false);
  const permission = useState<ReminderPermission>("reminders:permission", () => "default");

  // Hydrate from localStorage / the live permission once on the client.
  if (import.meta.client) {
    permission.value = "Notification" in window ? Notification.permission : "unsupported";
    if (localStorage.getItem(STORAGE_KEY) === "1") enabled.value = true;
  }

  /** Active only when the user opted in AND the browser will actually show notifications. */
  const active = computed(() => enabled.value && permission.value === "granted");

  /** Turn reminders on — requests OS permission if not yet decided. Returns the resulting state. */
  async function enable(): Promise<{ ok: boolean; permission: ReminderPermission }> {
    if (!import.meta.client || !("Notification" in window)) {
      permission.value = "unsupported";
      return { ok: false, permission: "unsupported" };
    }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    permission.value = perm;
    const ok = perm === "granted";
    enabled.value = ok;
    localStorage.setItem(STORAGE_KEY, ok ? "1" : "0");
    return { ok, permission: perm };
  }

  function disable(): void {
    enabled.value = false;
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, "0");
  }

  return { enabled, permission, active, enable, disable };
}
