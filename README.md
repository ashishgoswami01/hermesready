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

## Phase 2 (not built yet)

- Persist settings server-side instead of `localStorage`
- Real Google Drive connection test and document indexing
- Live WhatsApp session state, conversation log, activity log
- Auth so only the training desk can open `/admin`

Credentials stay in server-side environment variables from Phase 2 onward — never in the browser.
