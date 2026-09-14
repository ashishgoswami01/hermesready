import { NextResponse } from "next/server";

import { readSettings, refreshIntervalMinutes } from "@/lib/server-settings";
import { supabaseAdmin } from "@/lib/supabase";
import { runSync } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled refresh. vercel.json fires this every 15 minutes — the finest
 * granularity any of the wizard's refresh settings needs — and this handler
 * decides whether it's actually due, so "daily" doesn't re-index 96 times a day.
 *
 * A run that hits its time budget with files still queued re-queues itself by
 * doing nothing: the next tick picks the remaining files up, because change
 * detection is based on Drive's md5, not on run bookkeeping.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { settings } = await readSettings();
    if (!settings.driveFolderId?.trim()) {
      return NextResponse.json({ skipped: "No Drive folder configured yet." });
    }

    const intervalMs = refreshIntervalMinutes(settings) * 60_000;

    const { data: last } = await supabaseAdmin()
      .from("sync_runs")
      .select("started_at, status")
      .in("status", ["success", "partial"])
      .order("started_at", { ascending: false })
      .limit(1);

    const lastStarted = last?.[0]?.started_at ? new Date(last[0].started_at).getTime() : 0;
    const dueIn = lastStarted + intervalMs - Date.now();

    if (dueIn > 0) {
      return NextResponse.json({
        skipped: `Next refresh due in ${Math.ceil(dueIn / 60_000)} min.`,
        frequency: settings.updateFrequency,
      });
    }

    const result = await runSync({ trigger: "cron", budgetMs: 45_000 });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
