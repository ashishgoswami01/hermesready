import { NextResponse } from "next/server";

import { validateStep, TOTAL_STEPS } from "@/lib/settings";
import { readSettings, sanitizeSettings, writeSettings } from "@/lib/server-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stored = await readSettings();
    return NextResponse.json(stored);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { settings?: unknown; completed?: unknown };
    const settings = sanitizeSettings(body.settings);

    const completed = Array.isArray(body.completed)
      ? body.completed
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= TOTAL_STEPS)
      : [];

    // A step can't be marked complete if its own fields don't validate.
    const invalid: number[] = [];
    for (const step of completed) {
      if (Object.keys(validateStep(step, settings)).length) invalid.push(step);
    }
    if (invalid.length) {
      return NextResponse.json(
        { error: `Step ${invalid[0]} has invalid values.`, invalidSteps: invalid },
        { status: 400 },
      );
    }

    const updatedAt = await writeSettings(settings, completed);
    return NextResponse.json({ ok: true, updatedAt, settings, completed });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
