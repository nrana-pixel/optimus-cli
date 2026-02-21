# Chat UI — Implemented Features

This document summarizes **all implemented features** in the Optimus Ink (TUI) chat UI.

> Source of truth for completion status: `docs/CHAT_UI_REMAINING_FEATURES.d.md` (now all items are marked complete).

---

## Architecture / UI

- Ink-only TUI chat experience (legacy non-Ink UI removed)
- Sticky header with session/model, tools/plan state, and token meter
- Toast notifications for success/warn/error/info
- Theming:
  - dark / light / high-contrast
  - consistent accent borders/highlights across key UI components

---

## Navigation & Panels

- Command Palette
  - grouped by category
  - recents section (persisted per session)
  - help/preview panel (command + description + example)
  - scrolling list window with selection kept in view

- Search
  - search within current session
  - search across saved sessions
  - jump-to message with anchor highlight
  - next/prev hit navigation in Search panel (Ctrl+N/Ctrl+P)
  - global next/prev hits after closing search (Ctrl+Shift+N / Ctrl+Shift+P)
  - return to previous view after jump (Ctrl+Z)

- Sessions
  - list sessions
  - load session
  - delete session

- Export / Import
  - export md/json via export panel (toast confirmation)
  - import session JSON via import panel

- Analytics panel
  - message counts (user/assistant)
  - pinned count
  - reactions totals
  - tool runs count
  - provider + model
  - total tokens + total cost
  - usage stats by command
  - provider:model buckets with tokensDelta/costDelta aggregation (per-turn attribution)

- Help overlay
  - F1 (best-effort terminal sequence detection) and `/help-ui` from palette

---

## Message Operations

- Regenerate last assistant response **in-place** (replaces last assistant message)
- Edit last user prompt and re-run
- Edit arbitrary user message and branch re-run (Option B)
- Edit arbitrary assistant message (persisted)
- Tagging UI (add/remove tags on any message)
- Pins panel
  - pinned message list
  - tag filter
  - Tab toggles sorting mode (time/tag grouping)
- Delete message (destructive)
- Prune branch path (destructive)

---

## Branching / Threading

- Message IDs and `parentMessageId` support
- Thread view (root/leaf selection)
- Branch start from any message
- Branch management panel (switch thread root)
- Sibling branch selection (thread leaf)
- Branch persistence (Option A)
  - persist `threadRootId` + `threadLeafId`
  - validate leaf reachability on load and auto-clear invalid leaf
- Branch map view
  - interactive text tree with filter + scroll
  - select/enter to jump and set thread root

---

## Diff / Change Review UX

- Diff generation and display
- Diff review workflow
  - per-file revert
  - revert all / revert per tool run
  - accept diffs / accept per tool run
- Tool-run selection panel for diffs
- Snapshot groups per tool run are kept **in-memory** for per-run revert

---

## Performance / Reliability

- Virtualized message window scrolling
  - arrow keys, PgUp/PgDn
  - Ctrl+A/Ctrl+E top/bottom
  - dynamic window size based on terminal height
- Long-session guard rails
  - warn when session grows large
  - auto-archive + trim when exceeding hard cap

---

## Default Shortcuts (high-level)

- `/` : open command palette
- Ctrl+F : search current session
- Ctrl+G : search all sessions
- Ctrl+Shift+N / Ctrl+Shift+P : next/prev search hit (global)
- Ctrl+Z : return after jump
- Ctrl+S : sessions
- Ctrl+E : export
- Ctrl+N : import
- Ctrl+R : regenerate
- Ctrl+B : pins
- Ctrl+U : tags
- Ctrl+K : edit any message
- Ctrl+H : edit assistant message
- Ctrl+Delete : delete message
- Ctrl+P : prune branch
- Ctrl+Y : diffs
- Ctrl+I : analytics
- F1 : help overlay (terminal-dependent), `/help-ui` always works

---

## Notes / Known Design Choices

- Analytics cost/tokens bucket attribution is **per assistant turn** (includes multi-loop/tool cycles in that turn).
- Per-tool-run diff reverts rely on in-memory snapshot groups (do not persist across app restarts).
