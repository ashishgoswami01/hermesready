# Hermes — setup

Two secrets and one deploy. That's the whole list.

Google Cloud, service accounts and JSON keys are **not** needed — those belong
to the optional Drive path at the bottom of this file.

---

## What's already live (nothing to do)

Supabase project **hermes** (`jvyxyajucqygywigyftt`, ap-south-1):

| Piece | State |
| ----- | ----- |
| `kb_documents` | 3,575 prospectus chunks, `source` + `source_key` provenance |
| `app_settings` | singleton row the wizard writes to |
| `kb_sources` | one row per document, any source type |
| `sync_runs` | one row per Drive refresh |
| `chat_logs` | every question, answer, source list, latency |
| `knowledge` bucket | private, 50 MB per file, whitelisted MIME types |
| `hybrid_kb` | vector + keyword, fused with RRF; service-role only |
| `delete_source_chunks` | replaces a document's chunks atomically |
| Edge fn `ingest` | gte-small embeddings, 384 dims, no API key |
| Edge fn `ask` | retrieval only |
| Edge fn `answer` | retrieval + grounded Gemini + logging |

Tested against the live project: a real PDF went through extraction → chunking
→ embedding → retrieval, came back as the top source for a question about its
contents, and a prospectus question still ranked the prospectus corpus first.
Test data was removed afterwards; the bank is back to exactly 3,575 chunks.

---

## Step 1 — Gemini key (2 minutes)

<https://aistudio.google.com/apikey> → create a key. Free tier is enough.

Supabase Dashboard → **Edge Functions → Secrets** → add:

```
GEMINI_API_KEY = <the key>
```

Until this exists, `answer` returns 503 with a clear message and retrieval
still works — so search can be tested before generation is wired.

## Step 2 — Push to GitHub

The repo `ashishgoswami01/hermesready` has **only the root files**; `app/`,
`components/` and `lib/` never made it up, which is why the project looked
broken. This local folder is complete. From
`Myclaud/hermes-admin/hermes-admin`:

```bash
git push origin main
```

## Step 3 — Import on Vercel

<https://vercel.com/new> → import `hermesready`. Leave Root Directory at the
repo root. Add these environment variables to Production **and** Preview:

| Key | Value |
| --- | ----- |
| `SUPABASE_URL` | `https://jvyxyajucqygywigyftt.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` (secret) |
| `ADMIN_USER` | `hermes` |
| `ADMIN_PASSWORD` | anything memorable — the only lock on `/admin` |
| `CRON_SECRET` | any long random string |

That's it. Deploy.

## Step 4 — Use it

1. Open `https://<your-app>.vercel.app/admin/knowledge` (the browser asks for
   `ADMIN_USER` / `ADMIN_PASSWORD`).
2. Drop a PDF, Word file or text file on the upload box. Each file shows its
   own progress — preparing, uploading, reading & embedding — then the chunk
   count it produced.
3. Go to `/admin/chat` and ask a question about what you just uploaded. The
   answer shows which chunks it used.

Replacing a document: upload the new version and delete the old row. Deleting
removes its chunks immediately, so Hermes stops quoting it.

---

## Optional — connect Google Drive

Only worth it if files should be indexed without opening the admin page, e.g.
dropping a PDF into Drive from a phone. The code is already there; it needs a
service account.

1. <https://console.cloud.google.com> → new project (or reuse one).
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **IAM & Admin → Service Accounts → Create**, name it `hermes-drive`, no roles.
4. Open it → **Keys → Add key → Create new key → JSON**. Download.
5. In Drive, share the knowledge-bank folder with the JSON's `client_email`,
   as **Viewer**. The folder ID is the last part of the folder URL.
6. Add to Vercel:

| Key | Value |
| --- | ----- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON |
| `GOOGLE_PRIVATE_KEY` | the whole `private_key`, quoted, `\n` kept as `\n` |

`GOOGLE_PRIVATE_KEY` is the one people get wrong. Paste it exactly like this,
quotes included:

```
"-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n"
```

7. `/admin/settings` step 1 → paste the folder ID and service account email →
   **Test connection**. It really calls Drive and lists what it found; a wrong
   folder or a missing share fails there with the reason.

### Scheduled Drive refresh

`vercel.json` registers a daily cron at 02:00 UTC, because the Hobby plan
allows one run per day. For the 15-minute "realtime" setting, run this once in
the Supabase SQL editor:

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

The route decides whether a refresh is actually due, so ticking every 15
minutes still honours "hourly" or "daily" in the wizard.

### About OAuth "one click"

A **Connect Google Drive** button is possible, but it does not reduce setup —
it moves it. Building one needs an OAuth consent screen, a client ID and a
client secret in Google Cloud Console, which is more Console work than the
service account above. And `drive.readonly` is a Google **sensitive scope**:
production use needs app verification, otherwise the app stays in Testing mode
(up to 100 named test users). One click for the person signing in; more work
for whoever sets it up. Direct upload is the only genuinely zero-config path,
which is why it's the default.

---

## How the flow runs

```
     upload box (admin page)              Drive folder (optional)
              │                                    │
    signed URL, browser → Storage        scheduled refresh, md5 diff
              │                                    │
              └──────────────┬─────────────────────┘
                             ▼
                    lib/indexer.ts  ── one pipeline
                             │
        extract text (unpdf / mammoth / Google export)
        chunk (size + overlap from settings, sentence-aware)
                             ▼
        Edge fn `ingest` — gte-small, 384 dims, no API key
                             ▼
                  kb_documents (pgvector)
                             ▲
              hybrid_kb: vector + keyword, RRF fused
                             │
        Edge fn `ask` → Edge fn `answer` → Gemini, grounded
                             ▲
              /api/ask → /admin/chat   (later: WhatsApp)
```

Design notes worth knowing:

- **Uploads bypass the API layer.** A Vercel function's request body is capped
  at 4.5 MB and the prospectus PDFs are bigger, so the browser PUTs straight to
  Supabase Storage with a one-shot signed URL. File size is then governed by the
  bucket's 50 MB limit, not a function limit.
- **One pipeline, several ways in.** Nothing in extraction, chunking, embedding
  or retrieval knows where a document came from. Adding OAuth later means one
  new source adapter, not a rewrite.
- **A Drive sync pass is bounded, not long-running.** It indexes files until
  ~45 s are gone, then reports `hasMore`; the caller loops. A 40-PDF import
  completes as a series of short requests instead of dying at the timeout with
  nothing written.
- **Change detection uses Drive's md5**, not run bookkeeping, so an interrupted
  import resumes — nothing indexed twice, nothing skipped.
- **Re-indexing replaces chunks**, so an edited file can't be quoted from its
  old version.
- **Chunk size is capped at 1,800 characters.** gte-small truncates past 512
  tokens, so a larger chunk would silently lose its tail. The wizard validates
  200–1800.
- **Unreadable files are recorded, not indexed.** A scanned PDF with no text
  layer is marked `skipped` with the reason and its uploaded copy is deleted —
  a chunk of binary noise can still win a retrieval and would poison an answer.
- **Premium figures stay out.** The 120 prospectus chunks carrying premium
  tables are excluded by default, and the prompt refuses premium, claim, payout
  and commission figures even when a chunk contains one.
- **`/admin` and `/api` are behind HTTP Basic auth** (`proxy.ts`). These routes
  reach the database with the service-role key, so an open deployment would hand
  anyone the upload and delete endpoints. `/api/cron/*` is exempt and uses
  `CRON_SECRET`.
- **The retrieval helpers are service-role only.** `hybrid_kb`, `match_kb` and
  `delete_source_chunks` had `EXECUTE` revoked from `anon` and `authenticated`;
  before that, anyone holding the public anon key could have wiped the
  knowledge bank through `/rest/v1/rpc`.

One known Supabase lint stays open by choice: `vector` is installed in the
`public` schema (from the stage-1 load). Moving an extension out from under
live pgvector indexes risks the existing 3,575 embeddings for no practical gain.

## Tests

```bash
npm run verify   # 21 offline checks: chunking, extraction, validation, MIME mapping
npm run e2e      # live pipeline against Supabase (needs SUPABASE_ANON_KEY)
npm run build
```

`npm run verify` will also exercise real PDF extraction if you point it at a
file: `PDF_FIXTURE=some.pdf npm run verify`.

## Cost

₹0/month: Supabase free tier, Vercel Hobby, gte-small embeddings inside
Supabase with no API key, Gemini free tier for generation.
