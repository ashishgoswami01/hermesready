# Hermes Admin — Control Center

Phase 1 frontend for the **Hermes** WhatsApp assistant: a guided six-step settings wizard that
decides what Hermes knows, who it answers, how far a conversation can go, and how it sounds.

Built for Star Health training operations. Next.js App Router, TypeScript, Tailwind CSS v4.

---

## What's in it

| Step | Screen | Controls |
| ---- | ------ | -------- |
| 1 | Google Drive | Knowledge-bank folder ID, service account email, format check |
| 2 | Knowledge rules | Refresh frequency, chunk size, chunk overlap, file types to index |
| 3 | WhatsApp limits | Max replies per session, session timeout, quiet hours, human handoff |
| 4 | Number lists | Blacklist and exclusive numbers, with live valid/invalid counts |
| 5 | Persona | Separate tone for agents and customers, reply language, signature |
| 6 | Review & finish | Full summary with per-section Edit jumps, then save |

Plus: per-step validation, autosave to `localStorage` (progress survives a refresh),
progress meter, completed/locked step states, toasts, and a reset action.

## Stack

- Next.js (App Router) + React + TypeScript
- Tailwind CSS v4 with a small token layer in `app/globals.css`
- `lucide-react` icons, `sonner` toasts

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000> — the wizard lives at `/admin/settings`.

```bash
npm run build   # production build
npm start       # serve the build
npm run lint
```

## Structure

```
app/
  layout.tsx              # fonts, metadata, toaster
  globals.css             # design tokens + component primitives
  page.tsx                # landing page
  admin/
    layout.tsx            # sidebar shell
    settings/page.tsx     # the six-step wizard
components/
  field.tsx               # Field, FieldRow, Toggle, CheckPill
  sidebar.tsx             # admin navigation
  stepper.tsx             # desktop rail + mobile progress dots
lib/
  settings.ts             # types, defaults, validation, persistence
```

## Design tokens

All colors, radii and shadows are CSS variables on `:root` in `app/globals.css` and re-exported to
Tailwind through `@theme inline`. Change the palette in one place — for example swap `--accent` for
the Star Health blue — and the whole app follows.

## Deploy

Push to GitHub and import the repo on [Vercel](https://vercel.com/new); the framework is
auto-detected and no environment variables are needed for Phase 1.

## Phase 2 (built) — documents → RAG

Setup and deployment steps are in [SETUP.md](./SETUP.md). Two secrets, one
deploy; Google Cloud is only needed for the optional Drive path.

Documents get in two ways, and both land in the same pipeline:

- **Upload** on the knowledge page — browser PUTs straight to Supabase Storage
  with a signed URL, then the server extracts, chunks and embeds. No Google
  setup at all.
- **Google Drive folder** (optional) — a service account reads the folder and a
  scheduled pass indexes whatever changed.

| Route | Does |
| ----- | ---- |
| `GET/POST /api/settings` | reads and writes the `app_settings` row |
| `POST /api/upload/sign` | mints a signed upload URL (bypasses the 4.5 MB body limit) |
| `POST /api/upload/ingest` | indexes what landed in Storage |
| `GET/DELETE /api/kb/file` | signed download link; un-index a document |
| `GET /api/kb/status` | chunk counts, per-document state, last run |
| `POST /api/drive/test` | real service-account check: resolves the folder, lists indexable files |
| `POST /api/sync` | one bounded Drive pass; returns `hasMore` |
| `POST /api/ask` | grounded answer via the `answer` Edge Function |
| `GET /api/cron/sync` | scheduled refresh, gated by `CRON_SECRET` |

| Screen | Does |
| ------ | ---- |
| `/admin` | setup progress, chunk count, flow explainer |
| `/admin/settings` | the six-step wizard, saving server-side |
| `/admin/knowledge` | drag-and-drop upload, per-document status, delete |
| `/admin/chat` | test bench — same retrieval and guardrails as WhatsApp |

```
lib/
  indexer.ts          THE pipeline: extract → chunk → embed → replace
  storage.ts          private bucket, signed upload/download URLs
  drive.ts            service-account auth, folder listing, download/export
  sync.ts             Drive-specific diffing, resumable within 60 s
  extract.ts          PDF (unpdf), DOCX (mammoth), text; refuses the unreadable
  chunk.ts            sentence-aware chunking, capped at gte-small's limit
  server-settings.ts  app_settings read/write + sanitising
  supabase.ts         service-role client + Edge Function caller
  api.ts              browser-side wrappers
components/
  dropzone.tsx        upload UI with per-file stage and chunk count
proxy.ts              HTTP Basic auth over /admin and /api
scripts/
  verify.mts          21 offline checks  — npm run verify
  e2e.mts             live pipeline test — npm run e2e
supabase/functions/   ingest (embed) and answer (grounded generation)
```

`lib/indexer.ts` is the reason adding a source is cheap: nothing in extraction,
chunking, embedding or retrieval knows where a document came from, so a new way
in is one adapter, not a rewrite.

Credentials live only in server-side environment variables — nothing is
`NEXT_PUBLIC_`, so the service-role key never reaches the browser.

## Phase 3 (next)

- WhatsApp channel: contact tiers, session limits, quiet hours, number lists
- Conversation and activity log screens
- Optional OAuth "Connect Drive" as a third source adapter
