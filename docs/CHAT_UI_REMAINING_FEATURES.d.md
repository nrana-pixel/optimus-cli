# Chat UI — Remaining Features (Definition)

This document replaces the earlier roadmap markdown files and tracks what is **still NOT implemented**.

> Note: The project has moved to an Ink-only TUI chat UI. Some earlier legacy-terminal-only ideas are no longer applicable.

## Legend
- [ ] Not implemented
- [x] Implemented
- [~] Partial / needs polish

---

## 1) Branching & Threading

- [x] Thread view (parent chain) support
- [x] Branch start from a message (`/branch`, `parentMessageId`)
- [x] Branch management panel (list branch roots, switch thread root)
- [x] **Sibling branch navigation**: when a message has multiple child branches, allow choosing which child path to follow (`threadLeafId`)
- [x] **Branch map view**: interactive text tree (filter + scroll + select/enter to jump)
- [x] **Branch persistence**: root+leaf persisted + validated on load; leaf auto-cleared if invalid (Option A scope)

---

## 2) Message Operations

- [x] Edit last message and rerun
- [x] Edit arbitrary user message and branch rerun (Option B)
- [x] Edit arbitrary assistant message (UX + persistence)
- [x] Delete message (destructive)
- [x] Prune a branch path (destructive)
- [x] Message tagging UI (panel + persisted tags)
- [x] Pinned-only view improvements (sorting, grouping)

---

## 3) Diff / Change Review UX

- [x] Diff display
- [~] Diff review panel with revert file / revert all (implemented; UI polish still possible)
- [x] Accept/reject changes per tool run (toolRunId grouping + per-run accept/revert; snapshots are in-memory only)
- [~] Show modified file list with icons and expand preview (icons + preview implemented; further polish possible)

---

## 4) Command Palette & Navigation

- [x] Command palette (grouped + help preview + scrolling)
- [x] Persist command palette recents (per-session)
- [x] Command palette categories/groups UI
- [x] Command palette help preview / examples
- [~] Recent commands per-session vs global policy decision + UI (currently per-session)

---

## 5) Search

- [x] Search current session
- [x] Search across sessions
- [~] Jump-to message UX (anchor view + return Ctrl+Z + global hit cycling)
- [x] Search next/prev hit navigation (inside Search panel + global Ctrl+Shift+N/Ctrl+Shift+P after closing)

---

## 6) Export / Import

- [x] Export md/json (panel + `/export-ui`)
- [x] Export confirmation via toast
- [x] Import session JSON (panel)

---

## 7) Accessibility & Theming

- [~] Theme system + high-contrast (core components themed)
- [x] Apply theme consistently across all panels/components (borders/highlights now use ThemeContext; dimColor preserved by design)
- [x] Keyboard shortcuts/help overlay screen

---

## 8) Performance

- [x] Virtualized window scrolling
- [x] Dynamic window size based on terminal height
- [x] Stress/guard rails for long sessions (auto-archive + trim)

---

## 9) Analytics

- [~] Analytics panel (expanded)
- [x] Cost breakdown by model/provider (per-assistant-turn tokensDelta/costDelta tracked and bucketed; per-turn attribution accepted)
- [x] Usage stats by command (persisted)

