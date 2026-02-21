# CLI Project - AI-Powered Code Generation

A Node.js CLI tool that uses AI to generate code based on natural language descriptions. Supports OpenAI, Anthropic, and Google Gemini with conversation history and multi-turn interactions.

## Features

### Code Generator (`code`)

- ✅ **AI Code Generation** - Generate code from natural language descriptions
- ✅ **Multi-Provider Support** - OpenAI, Anthropic, Google Gemini
- ✅ **Conversation History** - Auto-continue conversations without flags
- ✅ **Session Management** - Save and resume conversations
- ✅ **Token & Cost Tracking** - Monitor API usage and costs
- ✅ **Streaming Support** - Real-time response streaming
- ✅ **Error Handling** - Comprehensive error handling and recovery

### Optimus Chat (Ink TUI) (`chat`)

- ✅ **Ink-based terminal UI** with command palette, panels, and toasts
- ✅ **Search** (in-session + cross-session) with jump + next/prev navigation
- ✅ **Sessions** (list/load/delete)
- ✅ **Export/Import** (md/json export with toasts, import session JSON)
- ✅ **Branching/Threading** (`parentMessageId`, thread root/leaf, sibling selection)
- ✅ **Diff review** (per-tool-run accept/revert, per-file revert; in-memory snapshot groups)
- ✅ **Message operations** (edit last/edit any, regenerate in-place, pin/tag/delete/prune)
- ✅ **Analytics** (usage stats by command, provider/model buckets, cost/tokens per turn)
- ✅ **Theming** (dark/light/high-contrast; consistent accent borders)

See:
- `docs/CHAT_UI_IMPLEMENTED_FEATURES.md` (full list)
- `docs/CHAT_UI_REMAINING_FEATURES.d.md` (completion checklist)

## Quick Start

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Build Project
```bash
pnpm build
```

### 3. Initialize Workspace
```bash
node bin/dev.js init
```

Select your LLM provider (OpenAI, Anthropic, or Gemini) and enter your API key.

### 4. Generate Code
```bash
node bin/dev.js code "create a simple Express server with one GET endpoint"
```

### 5. Continue Conversation
```bash
node bin/dev.js code "add error handling"
```

The system automatically continues the last session!

## Commands

### `code` - Generate Code
Generate code based on task description.

```bash
node bin/dev.js code "your task description"
```

**Options:**
- `-o, --output` - Output directory (default: current directory)
- `-m, --model` - Specify LLM model
- `-f, --force` - Skip confirmation
- `-s, --session <ID>` - Continue specific session
- `--new-session` - Start fresh session
- `--list-sessions` - Show all sessions

**Examples:**
```bash
# Generate code
node bin/dev.js code "create a user model"

# Continue last session
node bin/dev.js code "add validation"

# Start fresh
node bin/dev.js code "new project" --new-session

# List sessions
node bin/dev.js code --list-sessions
```

### `chat` - Optimus Chat (Ink TUI)
Interactive AI coding agent chat UI.

```bash
node bin/dev.js chat
```

**Highlights:**
- Command palette (`/`) with grouped commands + help preview
- Search (`Ctrl+F`) + cross-session search (`Ctrl+G`)
- Diffs review (`Ctrl+Y`) with per-tool-run accept/revert
- Branching/thread view (`Ctrl+T`, `Ctrl+M`, `Ctrl+J`)
- Export/import sessions (`Ctrl+E`, `Ctrl+N`)

**Docs:**
- `docs/CHAT_UI_IMPLEMENTED_FEATURES.md` – full feature list + shortcuts
- `docs/CHAT_UI_REMAINING_FEATURES.d.md` – completion checklist

### `init` - Initialize Workspace
Initialize a new workspace with API configuration.

```bash
node bin/dev.js init
```

### `status` - Check Status
Check workspace initialization status.

```bash
node bin/dev.js status
```

## Supported Models

### OpenAI
- `gpt-4` - Most capable
- `gpt-4-turbo` - Balanced
- `gpt-3.5-turbo` - Fast & cheap

### Anthropic
- `claude-3-opus` - Most capable
- `claude-3-sonnet` - Balanced
- `claude-3-haiku` - Fast & cheap

### Google Gemini
- `gemini-2.5-flash` - Latest (default)
- `gemini-2.0-flash` - Stable
- `gemini-1.5-pro` - High quality

## How It Works

### Conversation Flow

1. **Create Session** - First command creates a new session
2. **Auto-Continue** - Subsequent commands automatically continue the session
3. **Full Context** - LLM receives all previous messages for context
4. **Save Session** - Automatically saved to `~/.multi-agent/sessions/`

### Context Management

The LLM doesn't remember anything on its own. Instead:
- All messages are stored locally in JSON files
- When continuing, the entire conversation history is sent to the LLM
- This gives the LLM full context to understand previous decisions

**Session Storage:**
```
~/.multi-agent/sessions/
├── session-1234567890-abc123def.json
├── session-1234567891-xyz789abc.json
└── ...
```

## Architecture

### Services

**LLMService** (`src/services/llm.service.ts`)
- Handles OpenAI, Anthropic, and Gemini API calls
- Manages streaming responses
- Tracks tokens and calculates costs
- Comprehensive error handling

**ConversationService** (`src/services/conversation.service.ts`)
- Manages conversation sessions
- Stores and loads messages
- Tracks metadata (tokens, cost)
- Persists sessions to disk

**ConfigService** (`src/services/config.service.ts`)
- Manages workspace configuration
- Encrypts API keys (AES-256-CBC)
- Validates API key formats
- Persists configuration

### Commands

**Code Command** (`src/commands/code.ts`)
- Generates code from descriptions
- Manages conversation sessions
- Parses code blocks from LLM responses
- Writes files to disk

## Configuration

### Environment Variables

Create `.env` file:
```bash
API_PROVIDER=openai
API_KEY=sk-your-api-key-here
```

Or use the init command:
```bash
node bin/dev.js init
```

### Configuration File

Stored in: `~/.multi-agent/config.json`

```json
{
  "workspaceName": "my-workspace",
  "apiProvider": "openai",
  "apiKeyEncrypted": "...",
  "createdAt": "2024-01-15T10:30:45.123Z",
  "version": "1.0.0"
}
```

## Usage Examples

### Example 1: Create Express Server
```bash
# Create server
node bin/dev.js code "create an Express server with GET and POST endpoints"

# Add error handling
node bin/dev.js code "add error handling middleware"

# Add authentication
node bin/dev.js code "add JWT authentication"
```

### Example 2: Create User Model
```bash
# Create model
node bin/dev.js code "create a User model with name, email, and password fields"

# Add validation
node bin/dev.js code "add email validation"

# Add hashing
node bin/dev.js code "add password hashing with bcrypt"
```

### Example 3: Start Fresh Project
```bash
# Start new session
node bin/dev.js code "create a REST API structure" --new-session

# Add routes
node bin/dev.js code "add user routes"

# Add controllers
node bin/dev.js code "add user controller"
```

## Cost & Token Tracking

Each code generation shows:
- **Tokens Used** - Input + output tokens
- **Cost** - API cost in USD
- **Session** - Current session name

Example:
```
📊 Summary:

✅ Generated 1 file(s)
📝 Total lines: 18
💰 Cost: $0.000156
🔢 Tokens: 62
📋 Session: code-1234567890
```

## Troubleshooting

### "Workspace not initialized"
```bash
node bin/dev.js init
```

### "Invalid API key"
Re-initialize with correct key:
```bash
node bin/dev.js init
```

### "Model not found"
Use available models:
```bash
node bin/dev.js code "task" -m gpt-3.5-turbo
```

### "No code blocks found"
Try a more specific task description.

## Project Structure

```
cli-project/
├── src/
│   ├── commands/
│   │   ├── code.ts          # Code generation command
│   │   ├── init.ts          # Workspace initialization
│   │   ├── hello.ts         # Hello command
│   │   └── status.ts        # Status command
│   ├── services/
│   │   ├── llm.service.ts           # LLM API integration
│   │   ├── conversation.service.ts  # Session management
│   │   └── config.service.ts        # Configuration
│   ├── utils/
│   │   └── logger.ts        # Logging utility
│   └── types/
├── dist/                    # Compiled JavaScript
├── bin/
│   └── dev.js              # CLI entry point
├── package.json
├── tsconfig.json
├── README.md               # This file
└── agents.md               # Agent architecture
```

## Development

### Build
```bash
pnpm build
```

### Run
```bash
node bin/dev.js code "your task"
```

### Clean
```bash
pnpm clean
```

## Security

- API keys are encrypted using AES-256-CBC
- Configuration stored in user home directory
- No keys logged or exposed
- Secure key validation per provider

## Performance

- Streaming responses for real-time feedback
- Efficient session management
- Minimal memory footprint
- Fast file I/O operations

## Limitations

- Context size limited by LLM token limits
- Large conversations may increase API costs
- Streaming not yet implemented for Gemini
- Single workspace per user home directory

## Future Enhancements

- [ ] Streaming support for Gemini
- [ ] Multiple workspaces
- [ ] Request caching
- [ ] Batch processing
- [ ] Advanced prompt engineering
- [ ] Response validation
- [ ] Code formatting options

## License

MIT

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review the agents.md for architecture details
3. Check API provider documentation

---

**Version**: 1.0.0  
**Last Updated**: 2024
