"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  FileText,
  HardDriveUpload,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Dropzone } from "@/components/dropzone";
import {
  deleteDocument,
  fetchKbStatus,
  runSyncPass,
  storedFileUrl,
  type KbStatus,
} from "@/lib/api";

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
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
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
  const [removing, setRemoving] = useState<string | null>(null);
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
   * A Drive sync pass is bounded by the 60-second function limit, so this keeps
   * calling until nothing is queued — that's how a 40-file folder finishes
   * without a long-running request.
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
        if (result.status === "failed") throw new Error(result.error ?? "Sync failed.");

        indexed += result.indexed + result.updated;
        failed += result.failed;
        await refresh();

        if (!result.hasMore || cancelled.current) {
          toast.success(
            failed
              ? `${indexed} file(s) indexed, ${failed} had problems.`
              : indexed
                ? `${indexed} file(s) indexed.`
                : "Drive folder is already up to date.",
          );
          break;
        }
        setProgress(`Indexed ${indexed} · ${result.pending} queued (pass ${pass})…`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  };

  const remove = async (sourceKey: string, name: string) => {
    setRemoving(sourceKey);
    try {
      await deleteDocument(sourceKey);
      await refresh();
      toast.success(`${name} hata diya — Hermes ab isse quote nahi karega.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(null);
    }
  };

  const open = async (sourceKey: string) => {
    try {
      const { url } = await storedFileUrl(sourceKey);
      window.open(url, "_blank", "noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
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
          <p className="mt-1.5 max-w-[56ch] text-[13.5px] leading-relaxed text-text-secondary">
            Upload a document and it&apos;s searchable in seconds — no Google setup needed.
            Text is extracted, split into overlapping chunks and embedded; replacing a file
            replaces its chunks, deleting it removes them.
          </p>
        </div>

        {status?.driveConfigured && (
          <button type="button" className="btn btn-secondary" onClick={sync} disabled={syncing}>
            {syncing ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Syncing Drive…
              </>
            ) : (
              <>
                <RefreshCw size={14} /> Sync Drive folder
              </>
            )}
          </button>
        )}
      </div>

      <div className="mt-5">
        <Dropzone onIndexed={refresh} />
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-[8px] border border-[#f2cfcb] bg-danger-soft p-3.5 text-[13px] text-danger">
          <AlertCircle size={15} className="mt-[1px] shrink-0" />
          {error}
        </div>
      )}

      {progress && (
        <div className="mt-4 flex items-center gap-2.5 rounded-[8px] border border-border-base bg-surface-subtle p-3.5 text-[13px] text-text-secondary">
          <Loader2 size={14} className="animate-spin" />
          {progress}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Chunks"
          value={totals ? totals.chunks.toLocaleString("en-IN") : "—"}
          sub={
            totals
              ? `${totals.prospectusChunks.toLocaleString("en-IN")} prospectus · ${totals.uploadChunks} uploaded · ${totals.driveChunks} Drive`
              : undefined
          }
          icon={Database}
        />
        <Stat
          label="Documents indexed"
          value={files ? files.indexed : "—"}
          sub={files ? `${files.total} tracked in total` : undefined}
          icon={FileText}
        />
        <Stat
          label="Needs attention"
          value={files ? files.failed + files.skipped : "—"}
          sub={files ? `${files.failed} failed · ${files.skipped} skipped` : undefined}
          icon={AlertCircle}
        />
        <Stat
          label="Last Drive refresh"
          value={
            status?.driveConfigured ? when(status?.lastRun?.startedAt ?? null) : "not connected"
          }
          sub={
            status?.driveConfigured
              ? `auto every ${
                  status.refreshEveryMinutes >= 60
                    ? `${Math.round(status.refreshEveryMinutes / 60)} h`
                    : `${status.refreshEveryMinutes} min`
                }`
              : "uploads don't need it"
          }
          icon={Clock}
        />
      </div>

      {status && !status.driveConfigured && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-text-tertiary">
          Drive folder connected nahi hai — zarurat bhi nahi, upload se kaam chal jaata hai.
          Chahiye to{" "}
          <Link href="/admin/settings" className="text-accent underline">
            step 1 of the wizard
          </Link>{" "}
          se jod lena.
        </p>
      )}

      {status?.lastRun && (
        <div className="card mt-4 p-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
            <span className="eyebrow">Last Drive run</span>
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
          <h2 className="text-[14px] font-semibold">Documents</h2>
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
              Abhi koi document nahi. Upar se ek PDF drop karo — 3,575 prospectus chunks
              pehle se searchable hain.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-[13px]">
              <thead>
                <tr className="border-b border-border-base text-left text-text-tertiary">
                  <th className="px-4 py-2 font-medium">Document</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Chunks</th>
                  <th className="px-4 py-2 font-medium">Indexed</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {status.sources.map((s) => (
                  <tr key={s.sourceKey} className="border-b border-border-base last:border-0">
                    <td className="max-w-[260px] px-4 py-2.5">
                      <div className="truncate font-medium">{s.name}</div>
                      {s.error && (
                        <div className="mt-0.5 text-[12px] leading-snug text-danger">
                          {s.error}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="chip">
                        {s.sourceType === "upload" ? (
                          <HardDriveUpload size={11} />
                        ) : (
                          <RefreshCw size={11} />
                        )}
                        {s.sourceType}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={s.status === "failed" ? "chip chip-danger" : "chip"}>
                        {s.status === "indexed" && <CheckCircle2 size={11} />}
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">
                      {s.chunkCount || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary">{when(s.indexedAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {s.hasStoredCopy && (
                          <button
                            type="button"
                            aria-label={`Open ${s.name}`}
                            className="btn btn-ghost h-7 w-7 p-0"
                            onClick={() => open(s.sourceKey)}
                          >
                            <ExternalLink size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Remove ${s.name}`}
                          className="btn btn-ghost h-7 w-7 p-0 hover:text-danger"
                          onClick={() => remove(s.sourceKey, s.name)}
                          disabled={removing === s.sourceKey}
                        >
                          {removing === s.sourceKey ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Trash2 size={13} />
                          )}
                        </button>
                      </div>
                    </td>
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
