# Loop — Same-Window Usability Testing Tool

## Product summary
A usability testing web app whose differentiator is that the tested website and the
test tasks/questions live in the SAME window — participants never switch tabs or apps.
Desktop: site fills the screen, task panel docked right (~340px).
Mobile: task panel is a collapsible bottom sheet (~64px collapsed) over the site.

A working HTML prototype of the participant experience is included in this folder
(`usability-test-prototype.html`). Use it as the design and interaction reference —
port its layout, styling, and behavior to React rather than redesigning.

## Stack
- Next.js (App Router) + Tailwind CSS
- Supabase: Postgres, auth (researchers only), API
- Deploy target: Vercel. Deploy a hello-world on day one, before building features.

## Roles
- **Researcher** (authenticated): creates tests, shares links, views responses.
- **Participant** (anonymous, no account): opens a share link, completes the test.

## Data model
- `tests`: id (short slug for share links), owner_id, title, site_url, created_at
- `tasks`: id, test_id, sort_order, type (`instruction` | `rating` | `open_text`), prompt, description
- `responses`: id, test_id, session_id (uuid per participant visit), task_id,
  answer (text; rating stored as "1".."5"; instructions store "done" or "skipped"),
  started_at, submitted_at
- Row-level security: researchers can only read/write their own tests and the
  responses belonging to them. Participants can insert responses for a valid test id
  without auth, and read the test config + tasks for a valid test id.

## Participant runner (`/t/[testId]`) — build this FIRST
- Fetches test config + ordered tasks by testId.
- Target site loads in an iframe filling the main pane; slim session header overlay
  ("Recording session" indicator + site domain).
- Task panel behavior (match the prototype):
  - Desktop (>768px): fixed right panel — brand header, "Task X of N" + % progress bar,
    task eyebrow/title/description, answer input, footer with primary button and
    "Skip this task" ghost button.
  - Mobile (≤768px): bottom sheet, fixed, rounded top corners. Collapsed (~64px):
    drag-handle bar, step counter chip (e.g. "2/4"), one-line task title, chevron,
    3px progress line. Tap toggles expanded (~72dvh). Text inputs auto-expand the
    sheet on focus so the keyboard never hides them. Respect safe-area insets.
- Task types:
  - `instruction`: no input; button says "Done — next task".
  - `rating`: 1–5 button scale, labeled "Very hard" → "Very easy"; Next disabled until picked.
  - `open_text`: textarea; Next disabled while empty.
  - Last task button: "Finish test"; then a completion screen (checkmark, thank-you).
- Each answer is written to `responses` on submit (not batched at the end),
  with started_at/submitted_at per task so time-on-task can be computed later.
- Respect prefers-reduced-motion.

## Researcher dashboard (`/dashboard`) — build SECOND
- Supabase auth (email magic link is fine).
- Test list → create/edit test: title, site URL, ordered task list (add/remove/reorder,
  the three types above).
- **Iframe block-detection at creation time**: when the researcher enters the site URL,
  attempt to load it in a hidden/preview iframe. If it fails to render (X-Frame-Options /
  CSP frame-ancestors — no direct JS error, so use a load-timeout + heuristic), show:
  "This site blocks embedding. Ask your team to allow yourapp domain in
  frame-ancestors, or test a staging URL." Do not block saving — warn.
- Share link display + copy button: `/t/{testId}`.
- Responses view: table grouped by session (one row per participant session,
  columns per task), CSV export.

## Explicitly OUT of scope for v1
- Screen/session recording (rrweb later), heatmaps, click tracking
- Payments/billing, teams/orgs, participant recruitment panel
- Reverse-proxy fallback for iframe-blocked sites

## Build order
1. Scaffold + deploy hello-world to Vercel
2. Supabase schema + RLS policies
3. Participant runner (port the prototype), wired to real data
4. Dashboard: auth, test CRUD, share link
5. Block-detection warning + responses table + CSV export
