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

## Phase 2 (built) — Google Drive → RAG

Setup and deployment steps are in [SETUP.md](./SETUP.md).

| Route | Does |
| ----- | ---- |
| `GET/POST /api/settings` | reads and writes the `app_settings` row |
| `POST /api/drive/test` | real service-account check: resolves the folder, lists indexable files |
| `POST /api/sync` | one bounded ingestion pass; returns `hasMore` |
| `GET /api/kb/status` | chunk counts, per-file state, last run |
| `POST /api/ask` | grounded answer via the `answer` Edge Function |
| `GET /api/cron/sync` | scheduled refresh, gated by `CRON_SECRET` |

| Screen | Does |
| ------ | ---- |
| `/admin` | setup progress, chunk count, flow explainer |
| `/admin/settings` | the six-step wizard, now saving server-side |
| `/admin/knowledge` | per-file index status, Sync now |
| `/admin/chat` | test bench — same retrieval and guardrails as WhatsApp |

```
lib/
  drive.ts            service-account auth, folder listing, download/export
  extract.ts          PDF (unpdf), DOCX (mammoth), text; refuses the unreadable
  chunk.ts            sentence-aware chunking, capped at gte-small's limit
  sync.ts             the ingestion orchestrator (resumable, replace-on-update)
  server-settings.ts  app_settings read/write + sanitising
  supabase.ts         service-role client + Edge Function caller
  api.ts              browser-side wrappers
proxy.ts              HTTP Basic auth over /admin and /api
supabase/functions/   ingest (embed) and answer (grounded generation)
```

Credentials live only in server-side environment variables — nothing is
`NEXT_PUBLIC_`, so the service-role key never reaches the browser.

## Phase 3 (next)

- WhatsApp channel: contact tiers, session limits, quiet hours, number lists
- Conversation and activity log screens
- Drive push notifications instead of polling
