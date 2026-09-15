"use client";

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Upload, X } from "lucide-react";

import { uploadDocument } from "@/lib/api";

/**
 * Drag-and-drop ingestion: pick files, watch each one through signing,
 * uploading and indexing, and see the chunk count it produced.
 *
 * Files are indexed one at a time on purpose. Each one holds an Edge Function
 * busy embedding its chunks, so firing ten at once would just queue them
 * behind each other while making the progress readout meaningless.
 */

const ACCEPT = ".pdf,.docx,.doc,.txt,.md,.csv,.json";

type Row = {
  id: string;
  name: string;
  stage: "waiting" | "signing" | "uploading" | "indexing" | "done" | "error";
  chunks?: number;
  message?: string;
};

const STAGE_LABEL: Record<Row["stage"], string> = {
  waiting: "queued",
  signing: "preparing…",
  uploading: "uploading…",
  indexing: "reading & embedding…",
  done: "indexed",
  error: "failed",
};

export function Dropzone({ onIndexed }: { onIndexed: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const handle = async (files: File[]) => {
    if (!files.length || busy) return;

    const queued: Row[] = files.map((f) => ({
      id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
      name: f.name,
      stage: "waiting",
    }));
    setRows((prev) => [...queued, ...prev]);
    setBusy(true);

    let anyIndexed = false;

    for (let i = 0; i < files.length; i++) {
      const row = queued[i];
      try {
        const result = await uploadDocument(files[i], (stage) => update(row.id, { stage }));
        update(row.id, { stage: "done", chunks: result.chunks });
        anyIndexed = true;
      } catch (e) {
        update(row.id, {
          stage: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    setBusy(false);
    if (anyIndexed) onIndexed();
  };

  return (
    <div className="card p-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handle(Array.from(e.dataTransfer.files));
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-[10px] border border-dashed px-4 py-8 text-center transition-colors ${
          dragging
            ? "border-accent bg-accent-soft"
            : "border-border-strong bg-surface-subtle hover:bg-surface-hover"
        }`}
      >
        <Upload size={20} strokeWidth={1.8} className="text-text-tertiary" />
        <div className="mt-2 text-[13.5px] font-medium">
          Files yahan drop karo, ya click karke chuno
        </div>
        <div className="mt-1 text-[12.5px] text-text-tertiary">
          PDF, Word, text, CSV — 50 MB tak, ek saath kai files
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            void handle(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {rows.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-start gap-2 rounded-[7px] border border-border-base bg-surface px-3 py-2 text-[13px]"
            >
              <span className="mt-[2px] shrink-0">
                {r.stage === "done" ? (
                  <CheckCircle2 size={14} className="text-success" />
                ) : r.stage === "error" ? (
                  <AlertCircle size={14} className="text-danger" />
                ) : (
                  <Loader2 size={14} className="animate-spin text-text-tertiary" />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.name}</span>
                <span
                  className={`mt-0.5 block text-[12px] leading-snug ${
                    r.stage === "error" ? "text-danger" : "text-text-tertiary"
                  }`}
                >
                  {r.stage === "done"
                    ? `${STAGE_LABEL.done} · ${r.chunks} chunk${r.chunks === 1 ? "" : "s"}`
                    : (r.message ?? STAGE_LABEL[r.stage])}
                </span>
              </span>

              {(r.stage === "done" || r.stage === "error") && (
                <button
                  type="button"
                  aria-label={`Dismiss ${r.name}`}
                  className="btn btn-ghost h-6 w-6 shrink-0 p-0"
                  onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
                >
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
