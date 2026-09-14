# Hermes — Drive → RAG flow, setup

The Supabase half is already live and tested. What's left is deploying this
Next.js app and handing it three secrets only you have.

---

## What's already done (nothing to do here)

Supabase project **hermes** (`jvyxyajucqygywigyftt`, ap-south-1):

| Piece | State |
| ----- | ----- |
| `kb_documents` | 3,575 prospectus chunks + new `source` / `drive_file_id` columns |
| `app_settings` | singleton row the wizard writes to |
| `kb_sources` | Drive file registry — md5 + modifiedTime drive change detection |
| `sync_runs` | one row per refresh, feeds the dashboard |
| `chat_logs` | every question, answer, source list and latency |
| `hybrid_kb` v2 | returns `file_name` + `source`, can filter by source |
| `delete_drive_chunks` | replaces a file's chunks atomically; service-role only |
| Edge fn `ingest` v2 | embeds chunks with gte-small, now accepts Drive metadata |
| Edge fn `ask` | retrieval only (unchanged) |
| Edge fn `answer` | **new** — retrieval + grounded Gemini answer + logging |

Verified: `answer` correctly resolved "Star Comprehensive mein pre-existing
disease ka waiting period" to *Star Comprehensive Insurance Policy*
(UIN SHAHLIP26044V092526) and returned 6 grounded chunks in 1.76 s.

---

## Step 1 — Google service account (10 min)

1. <https://console.cloud.google.com> → new project (or reuse one).
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **IAM & Admin → Service Accounts → Create**. Name it `hermes-drive`. No roles needed.
4. Open it → **Keys → Add key → Create new key → JSON**. Download it.
5. In Drive, create the knowledge-bank folder. **Share** it with the
   `client_email` from that JSON, as **Viewer**.
6. The folder ID is the last part of the folder's URL, after `/folders/`.

From the JSON you need two values: `client_email` and `private_key`.

## Step 2 — Gemini key (2 min)

<https://aistudio.google.com/apikey> → create a key (free tier is enough).

Supabase Dashboard → **Edge Functions → Secrets** → add:

```
GEMINI_API_KEY = <the key>
```

Until this exists, `answer` returns 503 with a clear message and retrieval
still works — so you can test search before wiring generation.

## Step 3 — Push to GitHub

The repo `ashishgoswami01/hermesready` currently has **only the root files** —
`app/`, `components/` and `lib/` never made it up, which is why the project
looked broken. This local folder is complete. From `Myclaud/hermes-admin/hermes-admin`:

```bash
git add -A
git commit -m "Phase 2: Google Drive RAG pipeline"
git push origin main
```

## Step 4 — Import on Vercel

<https://vercel.com/new> → import `hermesready` → **Root Directory** must be
left at the repo root (the app is at the top level).

Add these environment variables (Production **and** Preview):

| Key | Value |
| --- | ----- |
| `SUPABASE_URL` | `https://jvyxyajucqygywigyftt.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` (secret) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON |
| `GOOGLE_PRIVATE_KEY` | the whole `private_key`, in quotes, `\n` kept as `\n` |
| `ADMIN_USER` | `hermes` |
| `ADMIN_PASSWORD` | anything you'll remember — this is the only lock on `/admin` |
| `CRON_SECRET` | any long random string |

`GOOGLE_PRIVATE_KEY` is the one people get wrong. Paste it exactly like this,
quotes included:

```
"-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n"
```

## Step 5 — Run it

1. Open `https://<your-app>.vercel.app/admin/settings` (browser will ask for
   `ADMIN_USER` / `ADMIN_PASSWORD`).
2. Step 1: paste the folder ID and service account email → **Test connection**.
   It now really calls Drive and lists what it found. A wrong folder or a
   missing share fails here with the reason.
3. Walk through steps 2–6, then **Save all settings** → **Index the folder now**.
4. `/admin/knowledge` shows chunk counts and per-file status.
5. `/admin/chat` asks real questions through the same path WhatsApp will use.

## Step 6 — Scheduled refresh

`vercel.json` registers a daily cron at 02:00 UTC, because the Hobby plan only
allows one run per day. For the 15-minute "realtime" setting, run this once in
the Supabase SQL editor after you have the Vercel URL:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'hermes-drive-refresh',
  '*/15 * * * *',
  $$
  select net.http_get(
    url    := 'https://<your-app>.vercel.app/api/cron/sync',
    headers:= '{"Authorization": "Bearer <your CRON_SECRET>"}'::jsonb
  );
  $$
);
```

The route itself decides whether a refresh is actually due, so this ticking
every 15 minutes still honours "hourly" or "daily" in the wizard.

---

## How the flow runs

```
Drive folder
   │  scheduled refresh compares md5 + modifiedTime against kb_sources
   ▼
/api/sync  (Node, 60 s budget, resumable)
   │  download → extract text (unpdf / mammoth / Google export)
   │  → chunk (size + overlap from settings, sentence-aware)
   ▼
Edge fn `ingest` — gte-small embeddings, 384 dims, no API key
   ▼
kb_documents (pgvector)
   ▲
   │  hybrid_kb: vector + keyword, fused with RRF
Edge fn `ask` → Edge fn `answer` → Gemini, grounded prompt
   ▲
/api/ask → /admin/chat   (and later: WhatsApp, same `answer` URL)
```

Design notes worth knowing:

- **A sync pass is bounded, not long-running.** It indexes files until ~45 s
  are gone, then returns `hasMore`; the caller loops. A 40-PDF first import
  therefore completes as a series of short requests instead of dying at the
  function timeout with nothing written.
- **Change detection uses Drive's md5**, not run bookkeeping, so an interrupted
  import just resumes — nothing is indexed twice and nothing is skipped.
- **Re-indexing replaces chunks** (`delete_drive_chunks` then insert), so an
  edited file can't be quoted from its old version.
- **Chunk size is capped at 1,800 characters.** gte-small truncates past 512
  tokens, so a larger chunk would silently lose its tail. The wizard's
  validation now says 200–1800 instead of 200–4000.
- **Unreadable files are recorded, not indexed.** A scanned PDF with no text
  layer is marked `skipped` with the reason, because a chunk of binary noise
  can still win a retrieval and would poison an answer.
- **Premium figures stay out.** The 120 prospectus chunks carrying premium
  tables are excluded by default, and the prompt refuses premium, claim,
  payout and commission figures even if a chunk contains one.
- **`/admin` and `/api` are behind HTTP Basic auth** (`proxy.ts`). These routes
  reach the database with the service-role key, so an open deployment would
  hand anyone the sync trigger. `/api/cron/*` is exempt and uses `CRON_SECRET`.

## Cost

₹0/month: Supabase free tier, Vercel Hobby, gte-small embeddings run inside
Supabase with no API key, Gemini free tier for generation.
