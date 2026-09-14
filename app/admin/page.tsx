"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Circle,
  Loader2,
  MessageSquare,
  Settings as SettingsIcon,
} from "lucide-react";

import { fetchKbStatus, fetchSettings, type KbStatus } from "@/lib/api";
import { STEPS, TOTAL_STEPS } from "@/lib/settings";

export default function OverviewPage() {
  const [status, setStatus] = useState<KbStatus | null>(null);
  const [completed, setCompleted] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [kb, stored] = await Promise.all([fetchKbStatus(), fetchSettings()]);
        setStatus(kb);
        setCompleted(stored.completed);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const done = completed?.length ?? 0;

  return (
    <div className="mx-auto max-w-[1000px] px-5 py-8 sm:px-8">
      <div className="eyebrow">Overview</div>
      <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">Hermes</h1>
      <p className="mt-1.5 max-w-[58ch] text-[13.5px] leading-relaxed text-text-secondary">
        Drive folder in, grounded answers out. Configure once, then watch the knowledge bank and
        test accuracy before WhatsApp goes live.
      </p>

      {error && (
        <div className="mt-5 rounded-[8px] border border-[#f2cfcb] bg-danger-soft p-3.5 text-[13px] text-danger">
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <Link href="/admin/settings" className="card group p-4 transition-colors hover:bg-surface-hover">
          <div className="flex items-center gap-2 text-text-tertiary">
            <SettingsIcon size={14} strokeWidth={1.9} />
            <span className="eyebrow">Setup</span>
          </div>
          <div className="mt-2 text-[15px] font-semibold">
            {done}/{TOTAL_STEPS} steps done
          </div>
          <div className="mt-2 space-y-1">
            {STEPS.map((s) => {
              const isDone = completed?.includes(s.id);
              return (
                <div key={s.id} className="flex items-center gap-1.5 text-[12.5px]">
                  {isDone ? (
                    <CheckCircle2 size={12} className="shrink-0 text-success" />
                  ) : (
                    <Circle size={12} className="shrink-0 text-text-tertiary" />
                  )}
                  <span className={isDone ? "text-text-secondary" : "text-text-tertiary"}>
                    {s.title}
                  </span>
                </div>
              );
            })}
          </div>
          <span className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent">
            Open wizard <ArrowRight size={12} />
          </span>
        </Link>

        <Link href="/admin/knowledge" className="card p-4 transition-colors hover:bg-surface-hover">
          <div className="flex items-center gap-2 text-text-tertiary">
            <BookOpen size={14} strokeWidth={1.9} />
            <span className="eyebrow">Knowledge bank</span>
          </div>
          {status ? (
            <>
              <div className="mt-2 text-[26px] font-semibold leading-none tabular-nums">
                {status.totals.chunks.toLocaleString("en-IN")}
              </div>
              <div className="mt-1.5 text-[12.5px] text-text-tertiary">
                chunks · {status.files.indexed} Drive file
                {status.files.indexed === 1 ? "" : "s"} indexed
              </div>
              {status.files.failed > 0 && (
                <div className="mt-1.5 text-[12.5px] text-danger">
                  {status.files.failed} file(s) need attention
                </div>
              )}
            </>
          ) : (
            <div className="mt-3 flex items-center gap-2 text-[13px] text-text-tertiary">
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          )}
          <span className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent">
            Manage files <ArrowRight size={12} />
          </span>
        </Link>

        <Link href="/admin/chat" className="card p-4 transition-colors hover:bg-surface-hover">
          <div className="flex items-center gap-2 text-text-tertiary">
            <MessageSquare size={14} strokeWidth={1.9} />
            <span className="eyebrow">Test bench</span>
          </div>
          <div className="mt-2 text-[15px] font-semibold">Ask a question</div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-tertiary">
            Same retrieval, same guardrails as WhatsApp. Every answer shows the source chunks it
            used.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent">
            Open chat <ArrowRight size={12} />
          </span>
        </Link>
      </div>

      <div className="card mt-4 p-4">
        <div className="eyebrow">How the flow runs</div>
        <ol className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-text-secondary">
          <li>
            <span className="font-medium text-text">1 · Upload</span> — drop a file into the
            shared Drive folder.
          </li>
          <li>
            <span className="font-medium text-text">2 · Detect</span> — the scheduled refresh
            compares Drive&apos;s checksums against what&apos;s indexed
            {status ? ` (every ${status.refreshEveryMinutes} min)` : ""}.
          </li>
          <li>
            <span className="font-medium text-text">3 · Extract &amp; chunk</span> — PDF, DOCX,
            Google Docs, Sheets and text become overlapping chunks.
          </li>
          <li>
            <span className="font-medium text-text">4 · Embed</span> — gte-small in Supabase, 384
            dimensions, no external API key.
          </li>
          <li>
            <span className="font-medium text-text">5 · Answer</span> — hybrid vector + keyword
            search feeds the grounded prompt; the model may only use what came back.
          </li>
        </ol>
      </div>
    </div>
  );
}
