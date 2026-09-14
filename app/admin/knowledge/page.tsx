"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { fetchKbStatus, runSyncPass, type KbStatus } from "@/lib/api";

const STATUS_STYLE: Record<string, string> = {
  indexed: "chip",
  skipped: "chip",
  failed: "chip chip-danger",
  removed: "chip",
  pending: "chip",
};

function Stat({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof Database;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-text-tertiary">
        <Icon size={14} strokeWidth={1.9} />
        <span className="eyebrow">{label}</span>
      </div>
      <div className="mt-2 text-[26px] font-semibold leading-none tabular-nums">{value}</div>
      {sub && <div className="mt-1.5 text-[12.5px] text-text-tertiary">{sub}</div>}
    </div>
  );
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function KnowledgePage() {
  const [status, setStatus] = useState<KbStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchKbStatus());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // The first load has to come from an effect (no status on the server), but
    // the state lands in a promise callback rather than in the effect body.
    void (async () => {
      await refresh();
    })();
    return () => {
      cancelled.current = true;
    };
  }, [refresh]);

  /**
   * A sync pass is bounded by the 60-second function limit, so this keeps
   * calling until nothing is queued — that's how a 40-file first import
   * finishes without a long-running request.
   */
  const sync = async () => {
    setSyncing(true);
    setProgress("Scanning the Drive folder…");

    let indexed = 0;
    let failed = 0;
    let pass = 0;

    try {
      for (;;) {
        pass += 1;
        const result = await runSyncPass();

        if (result.status === "failed") {
          throw new Error(result.error ?? "Sync failed.");
        }

        indexed += result.indexed + result.updated;
        failed += result.failed;
        await refresh();

        if (!result.hasMore || cancelled.current) {
          toast.success(
            failed
              ? `${indexed} file(s) indexed, ${failed} had problems.`
              : indexed
                ? `${indexed} file(s) indexed.`
                : "Everything is already up to date.",
          );
          break;
        }

        setProgress(
          `Indexed ${indexed} file(s) · ${result.pending} still queued (pass ${pass})…`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  };

  const totals = status?.totals;
  const files = status?.files;

  return (
    <div className="mx-auto max-w-[1000px] px-5 py-8 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Knowledge bank</div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">
            What Hermes knows
          </h1>
          <p className="mt-1.5 max-w-[54ch] text-[13.5px] leading-relaxed text-text-secondary">
            Every file in the Drive folder is downloaded, split into overlapping chunks and
            embedded. Editing a file in Drive replaces its chunks on the next refresh; deleting
            it removes them.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={sync}
          disabled={syncing || status?.configured === false}
        >
          {syncing ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Syncing…
            </>
          ) : (
            <>
              <RefreshCw size={14} /> Sync now
            </>
          )}
        </button>
      </div>

      {status?.configured === false && (
        <div className="mt-5 flex items-start gap-2.5 rounded-[8px] border border-accent-border bg-accent-soft p-3.5 text-[13px]">
          <AlertCircle size={15} className="mt-[1px] shrink-0 text-accent" />
          <span>
            No Drive folder is set yet.{" "}
            <Link href="/admin/settings" className="font-medium text-accent underline">
              Finish step 1 of the wizard
            </Link>{" "}
            and the sync will have somewhere to read from.
          </span>
        </div>
      )}

      {error && (
        <div className="mt-5 flex items-start gap-2.5 rounded-[8px] border border-[#f2cfcb] bg-danger-soft p-3.5 text-[13px] text-danger">
          <AlertCircle size={15} className="mt-[1px] shrink-0" />
          {error}
        </div>
      )}

      {progress && (
        <div className="mt-5 flex items-center gap-2.5 rounded-[8px] border border-border-base bg-surface-subtle p-3.5 text-[13px] text-text-secondary">
          <Loader2 size={14} className="animate-spin" />
          {progress}
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Chunks"
          value={totals ? totals.chunks.toLocaleString("en-IN") : "—"}
          sub={
            totals
              ? `${totals.prospectusChunks.toLocaleString("en-IN")} prospectus · ${totals.driveChunks.toLocaleString("en-IN")} Drive`
              : undefined
          }
          icon={Database}
        />
        <Stat
          label="Drive files indexed"
          value={files ? files.indexed : "—"}
          sub={files ? `${files.total} seen in total` : undefined}
          icon={FileText}
        />
        <Stat
          label="Needs attention"
          value={files ? files.failed + files.skipped : "—"}
          sub={files ? `${files.failed} failed · ${files.skipped} skipped` : undefined}
          icon={AlertCircle}
        />
        <Stat
          label="Last refresh"
          value={when(status?.lastRun?.startedAt ?? null)}
          sub={
            status
              ? `auto every ${status.refreshEveryMinutes >= 60 ? `${Math.round(status.refreshEveryMinutes / 60)} h` : `${status.refreshEveryMinutes} min`}`
              : undefined
          }
          icon={Clock}
        />
      </div>

      {status?.lastRun && (
        <div className="card mt-4 p-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
            <span className="eyebrow">Last run</span>
            <span className="text-text-secondary">
              {status.lastRun.trigger} · {status.lastRun.status}
            </span>
            <span className="text-text-secondary">
              {status.lastRun.filesIndexed} new · {status.lastRun.filesUpdated} updated ·{" "}
              {status.lastRun.filesRemoved} removed · {status.lastRun.filesFailed} failed
            </span>
            <span className="text-text-secondary">
              +{status.lastRun.chunksAdded.toLocaleString("en-IN")} chunks
            </span>
          </div>
          {status.lastRun.error && (
            <p className="mt-2 text-[12.5px] text-danger">{status.lastRun.error}</p>
          )}
        </div>
      )}

      <div className="card mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-base px-4 py-3">
          <h2 className="text-[14px] font-semibold">Files</h2>
          <button type="button" className="btn btn-ghost" onClick={refresh}>
            <RefreshCw size={13} /> Reload
          </button>
        </div>

        {!status ? (
          <div className="flex items-center gap-2 px-4 py-8 text-[13px] text-text-tertiary">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : status.sources.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[13.5px] text-text-secondary">
              No Drive files yet. Drop a PDF or Google Doc into the folder, then hit Sync now.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead>
                <tr className="border-b border-border-base text-left text-text-tertiary">
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Chunks</th>
                  <th className="px-4 py-2 font-medium">Indexed</th>
                </tr>
              </thead>
              <tbody>
                {status.sources.map((s) => (
                  <tr key={s.driveFileId} className="border-b border-border-base last:border-0">
                    <td className="max-w-[280px] px-4 py-2.5">
                      <div className="truncate font-medium">{s.name}</div>
                      {s.error && (
                        <div className="mt-0.5 text-[12px] leading-snug text-danger">
                          {s.error}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={STATUS_STYLE[s.status] ?? "chip"}>
                        {s.status === "indexed" && <CheckCircle2 size={11} />}
                        {s.status === "removed" && <Trash2 size={11} />}
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">
                      {s.chunkCount || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary">{when(s.indexedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
