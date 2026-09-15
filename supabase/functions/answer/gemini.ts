/**
 * Gemini access for the `answer` function: which model to call, how to stop
 * it from over-thinking, and how to survive Google retiring a model name.
 *
 * Split out from index.ts because this is the part that changes when Google
 * changes — the prompt and the guardrails above it should not have to move.
 */

/**
 * Preferred models, newest first. Google retires model names on its own
 * schedule — gemini-2.0-flash and gemini-2.5-flash both went 404 in
 * September 2026 — so this list is a preference, not a contract, and
 * `discoverModel` below is the fallback that keeps the function alive when
 * every name here is gone.
 */
const PREFERRED = [
  Deno.env.get("GEMINI_MODEL")?.trim(),
  "gemini-3.6-flash",
  "gemini-2.5-flash",
].filter((m): m is string => Boolean(m));

/** Remembered for the life of this instance, so discovery runs once, not per request. */
let discovered: string | null = null;

/**
 * Asks Google which models this key can actually use, and picks a flash-class
 * one. Without this, a deprecation on Google's side takes Hermes down until
 * someone edits and redeploys the function by hand.
 */
async function discoverModel(apiKey: string): Promise<string | null> {
  if (discovered) return discovered;

  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": apiKey },
  });
  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  const usable = (data?.models ?? []).filter((m: { supportedGenerationMethods?: string[] }) =>
    (m.supportedGenerationMethods ?? []).includes("generateContent"),
  );

  // Flash is the free tier's workhorse: fast and cheap. Anything usable beats
  // nothing, so fall through to the first available model.
  const pick =
    usable.find((m: { name: string }) => /flash/i.test(m.name) && !/thinking|image|tts/i.test(m.name)) ??
    usable[0];

  discovered = pick ? String(pick.name).replace(/^models\//, "") : null;
  if (discovered) console.warn(`Falling back to discovered model: ${discovered}`);
  return discovered;
}

/**
 * Thinking is off by default.
 *
 * gemini-3.x reasons before it answers, and those hidden tokens are billed
 * against maxOutputTokens — so on a long grounded prompt the reasoning ate the
 * budget and the visible answer came back truncated after 24 seconds. For
 * extraction-style RAG the model has the passage in front of it; it doesn't
 * need to deliberate. Turning it off took a warm answer from ~24 s to a few
 * seconds and stopped the truncation.
 *
 * The field name has changed across model generations, so unsupported configs
 * are dropped and retried rather than failing the request.
 */
const THINKING_VARIANTS: Array<Record<string, unknown> | null> = [
  { thinkingConfig: { thinkingLevel: "low" } },
  { thinkingConfig: { thinkingBudget: 0 } },
  null,
];

/** Remembered per instance once a variant is known to work for this model. */
let thinkingVariant: number | null = null;

function isUnsupportedConfig(status: number, error: string): boolean {
  return (
    status === 400 &&
    /thinking|thinkingConfig|thinkingLevel|thinkingBudget|unknown name|invalid.*field/i.test(error)
  );
}

async function generate(
  model: string,
  prompt: string,
  apiKey: string,
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const order =
    thinkingVariant === null
      ? THINKING_VARIANTS.map((_, i) => i)
      : [thinkingVariant, ...THINKING_VARIANTS.map((_, i) => i).filter((i) => i !== thinkingVariant)];

  let last = { ok: false as const, status: 0, error: "no attempt made" };

  for (const index of order) {
    const extra = THINKING_VARIANTS[index];

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            // Room for a full answer even if some reasoning still counts here.
            maxOutputTokens: 1200,
            topP: 0.9,
            ...(extra ?? {}),
          },
        }),
      },
    );

    if (!res.ok) {
      const error = (await res.text()).slice(0, 300);
      last = { ok: false, status: res.status, error };
      // Only a rejected thinking field is worth retrying; 404s and quota
      // errors are the caller's problem to handle.
      if (isUnsupportedConfig(res.status, error)) continue;
      return last;
    }

    const data = await res.json();
    const candidate = data?.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? "")
      .join("")
      // The model sometimes opens by echoing the prompt's "Answer:" colon.
      .replace(/^\s*[:\-–]\s*/, "")
      .trim();

    if (!text) {
      last = {
        ok: false,
        status: 200,
        error: `no text (${candidate?.finishReason ?? "unknown reason"})`,
      };
      // MAX_TOKENS with no text means reasoning consumed the whole budget —
      // a stricter thinking setting is exactly the fix.
      if (candidate?.finishReason === "MAX_TOKENS") continue;
      return last;
    }

    thinkingVariant = index;
    return { ok: true, text };
  }

  return last;
}

export async function callGemini(
  prompt: string,
  apiKey: string,
): Promise<{ text: string; model: string }> {
  // A model discovered on an earlier request goes first — it is known to exist.
  const candidates = discovered ? [discovered, ...PREFERRED] : [...PREFERRED];
  let lastError = "";
  let sawMissingModel = false;

  for (const model of candidates.filter((m, i, a) => a.indexOf(m) === i)) {
    const result = await generate(model, prompt, apiKey);
    if (result.ok) return { text: result.text, model };

    lastError = `${model}: ${result.status} ${result.error}`;
    if (result.status === 404) {
      sawMissingModel = true;
      continue; // this name is retired — try the next
    }
    // A quota or auth error will repeat on every model, so stop guessing.
    break;
  }

  // Every name we knew about is gone. Ask Google what it will accept.
  if (sawMissingModel) {
    const fallback = await discoverModel(apiKey);
    if (fallback && !candidates.includes(fallback)) {
      const result = await generate(fallback, prompt, apiKey);
      if (result.ok) return { text: result.text, model: fallback };
      lastError = `${fallback}: ${result.status} ${result.error}`;
    }
  }

  throw new Error(`Gemini call failed — ${lastError}`);
}

