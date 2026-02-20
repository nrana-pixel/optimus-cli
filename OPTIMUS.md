# OPTIMUS — Project Context

> This file is automatically loaded by Optimus on startup.
> Add project-specific instructions, conventions, and architecture notes here.
> The AI will read this before every conversation.

## Project

- **Name**: Optimus CLI
- **Type**: TypeScript CLI application (oclif framework)
- **Package manager**: pnpm
- **Build**: `pnpm build` (tsc → dist/)
- **Run**: `pnpm chat` (loads from dist/)

## Architecture

- `src/commands/` — oclif command handlers (chat.ts is the main REPL)
- `src/services/` — business logic (LLM, tools, git, config, local models)
- `src/types/` — TypeScript type definitions
- `bin/` — entry point scripts

## Conventions

- All file I/O uses Node.js `fs` module (no external file libraries)
- ANSI escape codes are used directly for terminal styling (no chalk)
- Tools are text-based (`<use_tool>` XML tags), not native function calling
- Local model support via Ollama and OpenAI-compatible endpoints
- Sessions are saved as JSON in the user's config directory

## Key Files

- `src/commands/chat.ts` — Main chat REPL (Spinner, Prompt, Chat classes)
- `src/services/tools.service.ts` — Tool use system (edit_file, write_file, etc.)
- `src/services/local-model.service.ts` — Local model streaming
- `src/services/llm-litellm.service.ts` — Cloud LLM provider
- `src/services/config.service.ts` — Configuration management

## Important Notes

- Always run `pnpm build` after changing TypeScript source files
- The chat command loads from `dist/commands` (compiled JS)
- Tool calls use a ReAct loop with max 8 iterations
