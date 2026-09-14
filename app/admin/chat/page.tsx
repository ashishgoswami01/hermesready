"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Loader2, Send, Sparkles } from "lucide-react";

import { ask, type AskResult } from "@/lib/api";

type Turn = {
  question: string;
  result?: AskResult;
  error?: string;
};

const SAMPLES = [
  "Star Comprehensive mein pre-existing disease ka waiting period kitna hai?",
  "Family Health Optima mein maternity cover kab se milta hai?",
  "Senior Citizens Red Carpet mein co-payment kaise lagta hai?",
];

export default function ChatPage() {
  const [question, setQuestion] = useState("");
  const [audience, setAudience] = useState<"agent" | "customer">("agent");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;

    setQuestion("");
    setTurns((prev) => [...prev, { question: q }]);
    setBusy(true);

    try {
      const result = await ask(q, audience);
      setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, result } : t)));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, error: message } : t)));
      toast.error(message);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-[820px] flex-col px-5 py-8 sm:px-8">
      <div>
        <div className="eyebrow">Test bench</div>
        <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">
          Ask Hermes
        </h1>
        <p className="mt-1.5 max-w-[58ch] text-[13.5px] leading-relaxed text-text-secondary">
          The same retrieval and the same guardrails WhatsApp will use. Check accuracy here first
          — every answer is logged, and premium, claim and payout figures are refused by design.
        </p>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <span className="text-[12.5px] text-text-tertiary">Answering as if the asker is</span>
        {(["agent", "customer"] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAudience(a)}
            className={`h-7 rounded-[7px] border px-2.5 text-[12.5px] font-medium capitalize transition-colors ${
              audience === a
                ? "border-accent-border bg-accent-soft text-accent"
                : "border-border-strong bg-surface text-text-secondary hover:bg-surface-hover"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="mt-5 flex-1 space-y-4">
        {turns.length === 0 && (
          <div className="card p-5">
            <div className="flex items-center gap-2 text-text-tertiary">
              <Sparkles size={14} />
              <span className="eyebrow">Try one of these</span>
            </div>
            <div className="mt-3 space-y-2">
              {SAMPLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="block w-full rounded-[8px] border border-border-base bg-surface-subtle px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-surface-hover"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-2.5">
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-[10px] rounded-br-[3px] bg-accent px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white">
                {t.question}
              </div>
            </div>

            {t.error ? (
              <div className="flex max-w-[85%] items-start gap-2 rounded-[10px] rounded-bl-[3px] border border-[#f2cfcb] bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
                <AlertTriangle size={14} className="mt-[2px] shrink-0" />
                {t.error}
              </div>
            ) : t.result ? (
              <div className="max-w-[85%] space-y-2">
                <div className="card rounded-bl-[3px] px-3.5 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap">
                  {t.result.answer}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {!t.result.grounded && (
                    <span className="chip chip-danger">not grounded</span>
                  )}
                  {t.result.product_filter && (
                    <span className="chip">{t.result.product_filter}</span>
                  )}
                  {t.result.model && <span className="chip">{t.result.model}</span>}
                  <span className="chip">{t.result.latency_ms} ms</span>
                </div>

                {t.result.sources.length > 0 && (
                  <details className="text-[12.5px]">
                    <summary className="cursor-pointer text-text-tertiary hover:text-text-secondary">
                      {t.result.sources.length} source chunk
                      {t.result.sources.length === 1 ? "" : "s"} used
                    </summary>
                    <ul className="mt-2 space-y-1.5">
                      {t.result.sources.map((s, j) => (
                        <li key={j} className="flex items-start gap-1.5 text-text-secondary">
                          <span className="text-text-tertiary tabular-nums">{j + 1}.</span>
                          <span className="min-w-0">
                            <span className="font-medium">{s.file_name ?? s.product}</span>
                            {s.uin && <span className="text-text-tertiary"> · UIN {s.uin}</span>}
                            {s.source_url && (
                              <a
                                href={s.source_url}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-1.5 inline-flex items-center text-accent"
                              >
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
                <Loader2 size={14} className="animate-spin" /> Searching the knowledge bank…
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-0 mt-6 flex gap-2 bg-bg pb-2 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(question);
        }}
      >
        <input
          className="input"
          placeholder="Poochho — jaise WhatsApp par aayega…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Ask
        </button>
      </form>
    </div>
  );
}
