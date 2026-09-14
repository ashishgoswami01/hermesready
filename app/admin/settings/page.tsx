"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
} from "lucide-react";

import { CheckPill, Field, FieldRow, Toggle } from "@/components/field";
import { Stepper, StepperMobile } from "@/components/stepper";
import {
  fetchSettings,
  runSyncPass,
  saveSettings,
  testDrive,
  type DriveTestResult,
} from "@/lib/api";
import {
  DEFAULTS,
  FILE_TYPES,
  STEPS,
  TOTAL_STEPS,
  clear,
  load,
  parseNumbers,
  save,
  validateStep,
  type Errors,
  type Settings,
} from "@/lib/settings";

export default function SettingsPage() {
  const [step, setStep] = useState(1);
  const [completed, setCompleted] = useState<number[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [errors, setErrors] = useState<Errors>({});
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const [driveTest, setDriveTest] = useState<DriveTestResult | null>(null);
  const [finished, setFinished] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------- hydrate ----------
     app_settings in Postgres is the source of truth, so the server wins; the
     localStorage draft is the fallback when the row is still empty (or the
     request fails), which keeps a half-finished setup from being lost. Neither
     is readable during SSR, so this runs on mount and the component shows a
     spinner until `hydrated` flips — that keeps server and client markup
     identical. */
  useEffect(() => {
    let alive = true;

    const apply = (s: Settings, c: number[]) => {
      if (!alive) return;
      setSettings(s);
      setCompleted(c);
      setStep(c.length ? Math.min(Math.max(...c) + 1, TOTAL_STEPS) : 1);
    };

    void (async () => {
      const draft = load();
      try {
        const remote = await fetchSettings();
        if (remote.completed.length || remote.updatedAt) {
          apply(remote.settings, remote.completed);
        } else if (draft) {
          apply(draft.settings, draft.completed);
        }
      } catch {
        if (draft) apply(draft.settings, draft.completed);
        if (alive) toast.error("Couldn't reach the server — editing a local draft.");
      } finally {
        if (alive) setHydrated(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  /* ---------- autosave ----------
     localStorage is written on every keystroke; the server write is debounced
     so typing a folder ID doesn't fire twenty requests. */
  const persist = useCallback((s: Settings, c: number[]) => {
    save(s, c);
    setSavedAt(Date.now());
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedAt(null), 2200);

    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      // A partially-filled step fails server validation; that's fine, the draft
      // is already safe locally and the next valid write catches up.
      void saveSettings(s, c).catch(() => {});
    }, 900);
  }, []);

  const set = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        persist(next, completed);
        return next;
      });
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const rest = { ...prev };
        delete rest[key];
        return rest;
      });
    },
    [completed, persist],
  );

  const goTo = (target: number) => {
    setErrors({});
    setStep(target);
  };

  const advance = () => {
    const found = validateStep(step, settings);
    if (Object.keys(found).length) {
      setErrors(found);
      toast.error("Please fix the highlighted fields.");
      return;
    }
    const nextCompleted = completed.includes(step) ? completed : [...completed, step].sort();
    setCompleted(nextCompleted);
    persist(settings, nextCompleted);
    setErrors({});

    if (step < TOTAL_STEPS) {
      setStep(step + 1);
      toast.success(`${STEPS[step - 1].title} saved`);
    }
  };

  const testConnection = async () => {
    const found = validateStep(1, settings);
    if (Object.keys(found).length) {
      setErrors(found);
      toast.error("Enter a valid folder ID and service account first.");
      return;
    }
    setTesting(true);
    setDriveTest(null);
    try {
      const result = await testDrive(settings.driveFolderId.trim(), settings.fileTypes);
      setDriveTest(result);
      toast.success(
        `Connected to "${result.folder.name}" — ${result.indexableFiles} of ${result.totalFiles} file(s) indexable.`,
      );
      if (result.indexableFiles === 0) {
        toast.warning("Nothing to index yet. Add files, or tick more types in the next step.");
      }
      advance();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErrors({ driveFolderId: message });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  const finish = async () => {
    for (let i = 1; i < TOTAL_STEPS; i++) {
      const found = validateStep(i, settings);
      if (Object.keys(found).length) {
        setStep(i);
        setErrors(found);
        toast.error(`Step ${i} needs attention before you can finish.`);
        return;
      }
    }
    const all = Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1);

    try {
      await saveSettings(settings, all);
      setCompleted(all);
      save(settings, all);
      setFinished(true);
      toast.success("Settings saved. Hermes will use these from the next refresh.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /** First import, kicked off straight from the finish screen. */
  const indexNow = async () => {
    setSyncing(true);
    let indexed = 0;
    try {
      for (;;) {
        const result = await runSyncPass();
        if (result.status === "failed") throw new Error(result.error ?? "Sync failed.");
        indexed += result.indexed + result.updated;
        if (!result.hasMore) break;
        toast.info(`${indexed} file(s) done · ${result.pending} to go…`);
      }
      toast.success(
        indexed ? `${indexed} file(s) indexed.` : "Knowledge bank is already up to date.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const reset = async () => {
    clear();
    setSettings(DEFAULTS);
    setCompleted([]);
    setErrors({});
    setDriveTest(null);
    setFinished(false);
    setStep(1);
    try {
      await saveSettings(DEFAULTS, []);
      toast.success("Setup reset to defaults.");
    } catch {
      toast.success("Setup reset in this browser.");
    }
  };

  const progress = Math.round((completed.length / TOTAL_STEPS) * 100);
  const blacklist = useMemo(() => parseNumbers(settings.blacklist), [settings.blacklist]);
  const exclusive = useMemo(() => parseNumbers(settings.exclusive), [settings.exclusive]);
  const active = STEPS[step - 1];

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center text-text-tertiary">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* ---------- top bar ---------- */}
      <header className="sticky top-0 z-30 flex h-[52px] items-center justify-between gap-3 border-b border-border-base bg-bg/90 px-5 backdrop-blur-md lg:px-8">
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-text-tertiary">
          <Link href="/" className="shrink-0 hover:text-text">
            Hermes
          </Link>
          <ChevronRight size={13} className="shrink-0" />
          <span className="truncate font-medium text-text">Settings</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 text-[12px] transition-opacity ${
              savedAt ? "opacity-100" : "opacity-0"
            }`}
          >
            <Cloud size={13} className="text-success" />
            <span className="text-text-tertiary">Saved</span>
          </span>
          <button type="button" onClick={reset} className="btn btn-ghost h-8 px-2.5">
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-[1040px] px-5 py-8 lg:px-8 lg:py-10">
        {/* ---------- page header ---------- */}
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Settings</h1>
            <p className="mt-1 text-[14px] text-text-secondary">
              Six steps to configure how Hermes reads your knowledge bank and replies on WhatsApp.
            </p>
          </div>
          <div className="min-w-[150px]">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-[12px] text-text-tertiary">
                {completed.length} of {TOTAL_STEPS} done
              </span>
              <span className="text-[13px] font-semibold tabular-nums">{progress}%</span>
            </div>
            <div className="h-[5px] w-full overflow-hidden rounded-full bg-border-base">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-8">
          <Stepper current={step} completed={completed} onSelect={goTo} />

          <div className="min-w-0 flex-1">
            <StepperMobile current={step} completed={completed} onSelect={goTo} />

            <section key={step} className="card animate-step p-6 lg:p-7">
              <div className="eyebrow">
                Step {step} · {active.eyebrow}
              </div>
              <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.015em]">
                {active.title}
              </h2>
              <p className="mt-1 text-[13.5px] text-text-secondary">{stepBlurb[step]}</p>

              <div className="divider my-6" />

              {/* ---------------- STEP 1 ---------------- */}
              {step === 1 && (
                <div className="space-y-5">
                  <Field
                    label="Google Drive folder ID"
                    hint="Open the knowledge bank folder in Drive — the ID is the last part of the URL after /folders/."
                    error={errors.driveFolderId}
                  >
                    <input
                      className="input"
                      value={settings.driveFolderId}
                      aria-invalid={!!errors.driveFolderId}
                      onChange={(e) => set("driveFolderId", e.target.value)}
                      placeholder="1AbCDefGHIjklMNOpqrsTuvWxyz"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    label="Service account email"
                    hint="Share the folder with this address as Viewer, otherwise Hermes can't read the files."
                    error={errors.serviceAccount}
                  >
                    <input
                      className="input"
                      value={settings.serviceAccount}
                      aria-invalid={!!errors.serviceAccount}
                      onChange={(e) => set("serviceAccount", e.target.value)}
                      placeholder="hermes@project.iam.gserviceaccount.com"
                      spellCheck={false}
                    />
                  </Field>

                  {driveTest && (
                    <div className="rounded-[8px] border border-border-base bg-surface-subtle p-3.5">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium">
                        <CheckCircle2 size={14} className="text-success" />
                        {driveTest.folder.name}
                      </div>
                      <p className="mt-1 text-[12.5px] text-text-secondary">
                        {driveTest.indexableFiles} of {driveTest.totalFiles} file
                        {driveTest.totalFiles === 1 ? "" : "s"} match the selected types.
                        {driveTest.ignoredTypes.length > 0 &&
                          ` Ignored: ${driveTest.ignoredTypes.join(", ")}.`}
                      </p>
                      {driveTest.preview.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-[12.5px] text-text-tertiary">
                          {driveTest.preview.map((f) => (
                            <li key={f.name} className="truncate">
                              · {f.name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ---------------- STEP 2 ---------------- */}
              {step === 2 && (
                <div className="space-y-5">
                  <Field
                    label="Refresh frequency"
                    hint="How often Hermes re-reads the folder for new or edited files."
                  >
                    <select
                      className="select"
                      value={settings.updateFrequency}
                      onChange={(e) =>
                        set("updateFrequency", e.target.value as Settings["updateFrequency"])
                      }
                    >
                      <option value="realtime">Real-time (recommended)</option>
                      <option value="hourly">Every hour</option>
                      <option value="daily">Once daily</option>
                    </select>
                  </Field>
                  <FieldRow>
                    <Field
                      label="Chunk size"
                      hint="Characters per chunk. 800–1200 works well for policy documents."
                      error={errors.chunkSize}
                    >
                      <input
                        className="input"
                        type="number"
                        value={settings.chunkSize}
                        aria-invalid={!!errors.chunkSize}
                        onChange={(e) => set("chunkSize", e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Chunk overlap"
                      hint="Shared characters between chunks so context isn't cut mid-clause."
                      error={errors.chunkOverlap}
                    >
                      <input
                        className="input"
                        type="number"
                        value={settings.chunkOverlap}
                        aria-invalid={!!errors.chunkOverlap}
                        onChange={(e) => set("chunkOverlap", e.target.value)}
                      />
                    </Field>
                  </FieldRow>
                  <Field
                    label="File types to index"
                    hint="Anything else in the folder is skipped."
                    error={errors.fileTypes}
                  >
                    <div className="flex flex-wrap gap-2 pt-1">
                      {FILE_TYPES.map((t) => (
                        <CheckPill
                          key={t.id}
                          label={t.label}
                          checked={settings.fileTypes.includes(t.id)}
                          onChange={() =>
                            set(
                              "fileTypes",
                              settings.fileTypes.includes(t.id)
                                ? settings.fileTypes.filter((f) => f !== t.id)
                                : [...settings.fileTypes, t.id],
                            )
                          }
                        />
                      ))}
                    </div>
                  </Field>
                </div>
              )}

              {/* ---------------- STEP 3 ---------------- */}
              {step === 3 && (
                <div className="space-y-5">
                  <FieldRow>
                    <Field
                      label="Max replies per session"
                      hint="After this many replies Hermes stops until the session resets."
                      error={errors.maxMessages}
                    >
                      <input
                        className="input"
                        type="number"
                        value={settings.maxMessages}
                        aria-invalid={!!errors.maxMessages}
                        onChange={(e) => set("maxMessages", e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Session timeout (minutes)"
                      hint="Silence for this long starts a fresh session."
                      error={errors.sessionTimeout}
                    >
                      <input
                        className="input"
                        type="number"
                        value={settings.sessionTimeout}
                        aria-invalid={!!errors.sessionTimeout}
                        onChange={(e) => set("sessionTimeout", e.target.value)}
                      />
                    </Field>
                  </FieldRow>
                  <FieldRow>
                    <Field label="Quiet hours start">
                      <input
                        className="input"
                        type="time"
                        value={settings.quietStart}
                        onChange={(e) => set("quietStart", e.target.value)}
                      />
                    </Field>
                    <Field label="Quiet hours end">
                      <input
                        className="input"
                        type="time"
                        value={settings.quietEnd}
                        onChange={(e) => set("quietEnd", e.target.value)}
                      />
                    </Field>
                  </FieldRow>
                  <Toggle
                    checked={settings.humanHandoff}
                    onChange={(v) => set("humanHandoff", v)}
                    label="Hand off to a human when unsure"
                    desc="If the knowledge bank has no clear answer, Hermes says so and asks the person to wait for you instead of guessing."
                  />
                </div>
              )}

              {/* ---------------- STEP 4 ---------------- */}
              {step === 4 && (
                <div className="space-y-5">
                  <Field
                    label="Blacklist"
                    hint="One number per line, with country code. Hermes never replies to these — use it for friends and family."
                    error={errors.blacklist}
                  >
                    <textarea
                      className="textarea"
                      value={settings.blacklist}
                      aria-invalid={!!errors.blacklist}
                      onChange={(e) => set("blacklist", e.target.value)}
                      placeholder={"919876543210\n919123456789"}
                      spellCheck={false}
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="chip">{blacklist.valid.length} valid</span>
                      {blacklist.invalid.length > 0 && (
                        <span className="chip chip-danger">
                          {blacklist.invalid.length} invalid
                        </span>
                      )}
                    </div>
                  </Field>
                  <Field
                    label="Exclusive numbers"
                    optional
                    hint="Priority contacts. A short note after the number is fine — 919876543210 - Zone head."
                    error={errors.exclusive}
                  >
                    <textarea
                      className="textarea"
                      value={settings.exclusive}
                      aria-invalid={!!errors.exclusive}
                      onChange={(e) => set("exclusive", e.target.value)}
                      placeholder={"919876543210 - Zone head\n919123456789 - Top advisor"}
                      spellCheck={false}
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="chip">{exclusive.valid.length} valid</span>
                      {exclusive.invalid.length > 0 && (
                        <span className="chip chip-danger">
                          {exclusive.invalid.length} invalid
                        </span>
                      )}
                    </div>
                  </Field>
                </div>
              )}

              {/* ---------------- STEP 5 ---------------- */}
              {step === 5 && (
                <div className="space-y-5">
                  <FieldRow>
                    <Field label="Tone for agents & Sales Managers">
                      <select
                        className="select"
                        value={settings.agentTone}
                        onChange={(e) => set("agentTone", e.target.value)}
                      >
                        <option>Collaborative &amp; supportive</option>
                        <option>Direct &amp; instructional</option>
                        <option>Formal &amp; procedural</option>
                      </select>
                    </Field>
                    <Field label="Tone for customers">
                      <select
                        className="select"
                        value={settings.clientTone}
                        onChange={(e) => set("clientTone", e.target.value)}
                      >
                        <option>Professional &amp; reassuring</option>
                        <option>Simple &amp; friendly</option>
                        <option>Concise &amp; factual</option>
                      </select>
                    </Field>
                  </FieldRow>
                  <Field
                    label="Reply language"
                    hint="Hermes mirrors the sender's language when it can, and falls back to this."
                  >
                    <select
                      className="select"
                      value={settings.language}
                      onChange={(e) => set("language", e.target.value as Settings["language"])}
                    >
                      <option value="hinglish">Hinglish</option>
                      <option value="hindi">Hindi</option>
                      <option value="english">English</option>
                    </select>
                  </Field>
                  <Field
                    label="Signature line"
                    optional
                    hint="Appended to replies so people know it's the training desk, not a sales pitch."
                    error={errors.signature}
                  >
                    <input
                      className="input"
                      value={settings.signature}
                      aria-invalid={!!errors.signature}
                      onChange={(e) => set("signature", e.target.value)}
                      placeholder="— Hermes, Training Desk"
                    />
                  </Field>
                </div>
              )}

              {/* ---------------- STEP 6 ---------------- */}
              {step === 6 && (
                <div>
                  {finished && (
                    <div className="mb-6 flex items-start gap-3 rounded-[8px] border border-[var(--success-soft)] bg-success-soft p-3.5">
                      <CheckCircle2 size={17} className="mt-[1px] shrink-0 text-success" />
                      <div>
                        <div className="text-[13.5px] font-medium text-success">
                          Setup complete
                        </div>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-secondary">
                          Saved to the Hermes backend. The scheduled refresh will pick up the
                          Drive folder on its own — or index it right now.
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="btn btn-secondary h-8"
                            onClick={indexNow}
                            disabled={syncing}
                          >
                            {syncing ? (
                              <>
                                <Loader2 size={13} className="animate-spin" /> Indexing…
                              </>
                            ) : (
                              <>
                                <Cloud size={13} /> Index the folder now
                              </>
                            )}
                          </button>
                          <Link href="/admin/knowledge" className="btn btn-ghost h-8">
                            Knowledge bank
                            <ArrowRight size={13} />
                          </Link>
                          <Link href="/admin/chat" className="btn btn-ghost h-8">
                            Test a question
                            <ArrowRight size={13} />
                          </Link>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="overflow-hidden rounded-[8px] border border-border-base">
                    {summaryGroups(settings, blacklist.valid.length, exclusive.valid.length).map(
                      (group, gi) => (
                        <div key={group.step} className={gi > 0 ? "border-t border-border-base" : ""}>
                          <div className="flex items-center justify-between gap-3 bg-surface-subtle px-4 py-2">
                            <span className="text-[12px] font-semibold text-text-secondary">
                              {group.title}
                            </span>
                            <button
                              type="button"
                              onClick={() => goTo(group.step)}
                              className="flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
                            >
                              <Pencil size={11} />
                              Edit
                            </button>
                          </div>
                          <dl>
                            {group.rows.map((row) => (
                              <div
                                key={row.k}
                                className="flex items-baseline justify-between gap-4 border-t border-border-base px-4 py-2.5"
                              >
                                <dt className="text-[13px] text-text-secondary">{row.k}</dt>
                                <dd className="max-w-[58%] truncate text-right text-[13px] font-medium">
                                  {row.v || <span className="text-text-tertiary">Not set</span>}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}

              {/* ---------------- footer ---------------- */}
              <div className="divider my-6" />
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => goTo(Math.max(1, step - 1))}
                  disabled={step === 1}
                  className="btn btn-ghost"
                >
                  <ArrowLeft size={14} />
                  Back
                </button>

                {step === 1 ? (
                  <button
                    type="button"
                    onClick={testConnection}
                    disabled={testing}
                    className="btn btn-primary"
                  >
                    {testing ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Testing
                      </>
                    ) : (
                      <>
                        Test &amp; continue
                        <ArrowRight size={14} />
                      </>
                    )}
                  </button>
                ) : step < TOTAL_STEPS ? (
                  <button type="button" onClick={advance} className="btn btn-primary">
                    Save &amp; continue
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <button type="button" onClick={finish} className="btn btn-success">
                    {finished ? <Check size={14} /> : <Save size={14} />}
                    {finished ? "Saved" : "Save all settings"}
                  </button>
                )}
              </div>
            </section>

            <p className="mt-4 px-1 text-[12px] leading-relaxed text-text-tertiary">
              Phase 1 stores everything locally in your browser — nothing leaves this device yet.
              Credentials move to server-side environment variables in Phase 2.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const stepBlurb: Record<number, string> = {
  1: "Point Hermes at the Drive folder that holds your Star Health product and process documents.",
  2: "Control how documents are split and how often the index refreshes.",
  3: "Cap how much Hermes says in one conversation, and when it stays silent.",
  4: "Decide who Hermes must never reply to, and who gets priority.",
  5: "Set how Hermes sounds to different audiences.",
  6: "Check everything once, then save.",
};

function summaryGroups(s: Settings, blCount: number, exCount: number) {
  const freq = {
    realtime: "Real-time",
    hourly: "Every hour",
    daily: "Once daily",
  }[s.updateFrequency];

  const lang = { hinglish: "Hinglish", hindi: "Hindi", english: "English" }[s.language];

  return [
    {
      step: 1,
      title: "Google Drive",
      rows: [
        { k: "Folder ID", v: s.driveFolderId },
        { k: "Service account", v: s.serviceAccount },
      ],
    },
    {
      step: 2,
      title: "Knowledge rules",
      rows: [
        { k: "Refresh", v: freq },
        { k: "Chunk size / overlap", v: `${s.chunkSize} / ${s.chunkOverlap}` },
        { k: "File types", v: `${s.fileTypes.length} selected` },
      ],
    },
    {
      step: 3,
      title: "WhatsApp limits",
      rows: [
        { k: "Max replies per session", v: s.maxMessages },
        { k: "Session timeout", v: `${s.sessionTimeout} min` },
        { k: "Quiet hours", v: `${s.quietStart} – ${s.quietEnd}` },
        { k: "Human handoff", v: s.humanHandoff ? "On" : "Off" },
      ],
    },
    {
      step: 4,
      title: "Number lists",
      rows: [
        { k: "Blacklisted", v: `${blCount} number(s)` },
        { k: "Exclusive", v: `${exCount} number(s)` },
      ],
    },
    {
      step: 5,
      title: "Persona",
      rows: [
        { k: "Agents & SMs", v: s.agentTone },
        { k: "Customers", v: s.clientTone },
        { k: "Language", v: lang },
        { k: "Signature", v: s.signature },
      ],
    },
  ];
}
