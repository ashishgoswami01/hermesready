import { NextResponse } from "next/server";

import { runSync } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One bounded ingestion pass. Returns `hasMore` when files are still queued;
 * the dashboard keeps calling until it's false, which is how a 40-file first
 * import completes despite the 60-second function limit.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { maxFiles?: number };
  const maxFiles =
    Number.isFinite(body.maxFiles) && Number(body.maxFiles) > 0
      ? Math.min(Number(body.maxFiles), 25)
      : undefined;

  try {
    const result = await runSync({ trigger: "manual", budgetMs: 45_000, maxFiles });
    return NextResponse.json(result, { status: result.status === "failed" ? 400 : 200 });
  } catch (e) {
    return NextResponse.json(
      { status: "failed", error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
