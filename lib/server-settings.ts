import { DEFAULTS, type Settings } from "./settings";
import { supabaseAdmin } from "./supabase";

/**
 * Settings live in one row of app_settings (id = 1). The wizard still caches a
 * draft in localStorage so a refresh mid-setup doesn't lose typing, but this
 * row is the source of truth every server route reads.
 */

export type StoredSettings = {
  settings: Settings;
  completed: number[];
  updatedAt: string | null;
};

export async function readSettings(): Promise<StoredSettings> {
  const { data, error } = await supabaseAdmin()
    .from("app_settings")
    .select("settings, updated_at")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error(`Couldn't read settings: ${error.message}`);

  const blob = (data?.settings ?? {}) as {
    settings?: Partial<Settings>;
    completed?: number[];
  };

  return {
    settings: { ...DEFAULTS, ...(blob.settings ?? {}) },
    completed: Array.isArray(blob.completed) ? blob.completed : [],
    updatedAt: data?.updated_at ?? null,
  };
}

export async function writeSettings(
  settings: Settings,
  completed: number[],
): Promise<string> {
  const updatedAt = new Date().toISOString();

  const { error } = await supabaseAdmin()
    .from("app_settings")
    .upsert(
      { id: 1, settings: { settings, completed }, updated_at: updatedAt },
      { onConflict: "id" },
    );

  if (error) throw new Error(`Couldn't save settings: ${error.message}`);
  return updatedAt;
}

/** Keeps only known keys, so a stale browser can't write junk into the row. */
export function sanitizeSettings(input: unknown): Settings {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULTS };

  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const value = raw[key];
    if (value === undefined || value === null) continue;

    const expected = typeof DEFAULTS[key];
    if (Array.isArray(DEFAULTS[key])) {
      if (Array.isArray(value)) {
        (out[key] as unknown) = value.filter((v) => typeof v === "string");
      }
    } else if (typeof value === expected) {
      (out[key] as unknown) = value;
    } else if (expected === "string" && typeof value === "number") {
      (out[key] as unknown) = String(value);
    }
  }
  return out;
}

/** How stale the index may get before the cron re-runs, in minutes. */
export function refreshIntervalMinutes(settings: Settings): number {
  switch (settings.updateFrequency) {
    case "realtime":
      return 15; // Drive gives no push without a webhook, so 15 min is "realtime"
    case "hourly":
      return 60;
    case "daily":
      return 60 * 24;
    default:
      return 60;
  }
}
