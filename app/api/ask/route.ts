import { NextResponse } from "next/server";

import { callEdgeFunction } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type AskResponse = {
  answer: string;
  grounded: boolean;
  sources: Array<{
    product: string;
    uin: string | null;
    file_name: string | null;
    source: string;
    source_url: string | null;
    score: number;
  }>;
  product_filter: string | null;
  model: string | null;
  latency_ms: number;
};

/**
 * Thin proxy to the `answer` Edge Function, so the browser never sees the
 * service-role key. WhatsApp and n8n can call the Edge Function directly.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      question?: string;
      audience?: string;
      count?: number;
      include_premium?: boolean;
    };

    const question = String(body.question ?? "").trim();
    if (!question) {
      return NextResponse.json({ error: "Type a question first." }, { status: 400 });
    }

    const data = await callEdgeFunction<AskResponse>("answer", {
      question,
      audience: body.audience === "customer" ? "customer" : "agent",
      count: body.count,
      include_premium: body.include_premium === true,
      channel: "admin",
    });

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
