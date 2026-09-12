export const STORAGE_KEY = "hermes.admin.settings.v2";

export type Settings = {
  // 1 — Google Drive
  driveFolderId: string;
  serviceAccount: string;
  // 2 — Knowledge base
  updateFrequency: "realtime" | "hourly" | "daily";
  chunkSize: string;
  chunkOverlap: string;
  fileTypes: string[];
  // 3 — WhatsApp
  maxMessages: string;
  sessionTimeout: string;
  quietStart: string;
  quietEnd: string;
  humanHandoff: boolean;
  // 4 — Numbers
  blacklist: string;
  exclusive: string;
  // 5 — Persona
  agentTone: string;
  clientTone: string;
  language: "hinglish" | "hindi" | "english";
  signature: string;
};

export const DEFAULTS: Settings = {
  driveFolderId: "",
  serviceAccount: "",
  updateFrequency: "realtime",
  chunkSize: "1000",
  chunkOverlap: "120",
  fileTypes: ["pdf", "docx", "sheets"],
  maxMessages: "6",
  sessionTimeout: "15",
  quietStart: "22:00",
  quietEnd: "07:00",
  humanHandoff: true,
  blacklist: "",
  exclusive: "",
  agentTone: "Collaborative & supportive",
  clientTone: "Professional & reassuring",
  language: "hinglish",
  signature: "— Hermes, Training Desk",
};

export const FILE_TYPES = [
  { id: "pdf", label: "PDF" },
  { id: "docx", label: "Word (.docx)" },
  { id: "sheets", label: "Google Sheets" },
  { id: "slides", label: "Google Slides" },
  { id: "txt", label: "Plain text" },
] as const;

export const STEPS = [
  {
    id: 1,
    title: "Google Drive",
    desc: "Knowledge bank source",
    eyebrow: "Connection",
  },
  {
    id: 2,
    title: "Knowledge rules",
    desc: "Indexing & refresh",
    eyebrow: "Processing",
  },
  {
    id: 3,
    title: "WhatsApp limits",
    desc: "Sessions & quiet hours",
    eyebrow: "Channel",
  },
  {
    id: 4,
    title: "Number lists",
    desc: "Blacklist & exclusive",
    eyebrow: "Routing",
  },
  {
    id: 5,
    title: "Persona",
    desc: "Tone & language",
    eyebrow: "Voice",
  },
  {
    id: 6,
    title: "Review & finish",
    desc: "Confirm and save",
    eyebrow: "Summary",
  },
] as const;

export const TOTAL_STEPS = STEPS.length;

/* ------------------------------------------------------------------
   Validation
   ------------------------------------------------------------------ */
export type Errors = Partial<Record<keyof Settings, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{15,}$/;

/** Parses one-number-per-line text; returns valid entries and bad line numbers. */
export function parseNumbers(raw: string) {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const line of lines) {
    // allow "919876543210 - VIP note"
    const digits = line.split(/[\s,–-]/)[0].replace(/[^\d]/g, "");
    if (digits.length >= 10 && digits.length <= 15) valid.push(digits);
    else invalid.push(line);
  }
  return { valid, invalid, total: lines.length };
}

function num(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function validateStep(step: number, s: Settings): Errors {
  const e: Errors = {};

  if (step === 1) {
    if (!s.driveFolderId.trim()) e.driveFolderId = "Folder ID is required.";
    else if (!DRIVE_ID_RE.test(s.driveFolderId.trim()))
      e.driveFolderId = "Doesn't look like a Drive folder ID (15+ characters, no spaces).";

    if (!s.serviceAccount.trim()) e.serviceAccount = "Service account email is required.";
    else if (!EMAIL_RE.test(s.serviceAccount.trim()))
      e.serviceAccount = "Enter a valid service account email.";
  }

  if (step === 2) {
    const size = num(s.chunkSize);
    const overlap = num(s.chunkOverlap);
    if (!Number.isFinite(size) || size < 200 || size > 4000)
      e.chunkSize = "Use a value between 200 and 4000.";
    if (!Number.isFinite(overlap) || overlap < 0 || overlap > 1000)
      e.chunkOverlap = "Use a value between 0 and 1000.";
    else if (Number.isFinite(size) && overlap >= size)
      e.chunkOverlap = "Overlap must be smaller than chunk size.";
    if (s.fileTypes.length === 0) e.fileTypes = "Pick at least one file type.";
  }

  if (step === 3) {
    const max = num(s.maxMessages);
    const timeout = num(s.sessionTimeout);
    if (!Number.isFinite(max) || max < 1 || max > 50)
      e.maxMessages = "Use a value between 1 and 50.";
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 1440)
      e.sessionTimeout = "Use a value between 1 and 1440 minutes.";
  }

  if (step === 4) {
    const bl = parseNumbers(s.blacklist);
    const ex = parseNumbers(s.exclusive);
    if (bl.invalid.length) e.blacklist = `${bl.invalid.length} line(s) aren't valid numbers.`;
    if (ex.invalid.length) e.exclusive = `${ex.invalid.length} line(s) aren't valid numbers.`;
    const overlap = bl.valid.filter((n) => ex.valid.includes(n));
    if (overlap.length) e.exclusive = `${overlap[0]} is in both lists — remove it from one.`;
  }

  if (step === 5) {
    if (s.signature.length > 60) e.signature = "Keep the signature under 60 characters.";
  }

  return e;
}

export function load(): { settings: Settings; completed: number[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      settings?: Partial<Settings>;
      completed?: number[];
    };
    return {
      settings: { ...DEFAULTS, ...(parsed.settings ?? {}) },
      completed: Array.isArray(parsed.completed) ? parsed.completed : [],
    };
  } catch {
    return null;
  }
}

export function save(settings: Settings, completed: number[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, completed }));
  } catch {
    /* storage unavailable — keep working in memory */
  }
}

export function clear() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
