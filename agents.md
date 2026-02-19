# CLI Agents Documentation

This CLI project is designed as a multi-agent workspace, allowing you to leverage AI agents for various software engineering tasks.

## Available Agents

### 1. Code Generator Agent (`code`)

The Code Generator Agent is designed to assist developers by generating code based on natural language descriptions. It is context-aware and can maintain conversation sessions.

**Capabilities:**
-   Generate code snippets or entire files.
-   Understand existing project structure (reads directory context).
-   Maintain context across multiple turns (sessions).
-   Output code directly to files.

**Usage:**

```bash
# Basic usage
cli-project code "create a simple Express server"

# Continue a session
cli-project code "add error handling"

# Start a new session explicitly
cli-project code "new task" --new-session

# Specify a model
cli-project code "complex logic" --model gpt-4
```

**Options:**
-   `--output`, `-o`: Output directory for generated files (default: current directory).
-   `--model`, `-m`: Specify the LLM model to use.
-   `--force`, `-f`: Skip confirmation prompts and apply changes immediately.
-   `--session`, `-s`: Continue a specific session by ID.
-   `--list-sessions`: List all available conversation sessions.
-   `--new-session`: Start a fresh session, ignoring previous context.

### 2. General Assistant (`hello`)

A basic example command to verify CLI functionality.

**Usage:**
```bash
cli-project hello --name Developer
```

## Configuration

To use the agents, you must first initialize the workspace.

**Initialization:**
```bash
cli-project init
```

This command will prompt you for:
-   **Workspace Name**: A unique name for your configuration.
-   **API Provider**: Choose between OpenAI, Anthropic, or Google Gemini.
-   **API Key**: Your API key for the selected provider.

**Check Status:**
```bash
cli-project status
```

## Architecture

The agent system is built on a modular architecture:
-   **Command Layer (`src/commands`)**: Handles user input and CLI interaction.
-   **Service Layer (`src/services`)**: Contains core logic, including LLM integration and state management.
-   **LLM Service**: Unified interface for multiple AI providers (OpenAI, Anthropic, Gemini).

## Adding New Agents

To create a new agent:
1.  Create a new command file in `src/commands`.
2.  Implement the agent logic, leveraging `LLMService` for AI capabilities.
3.  Register any specific flags or arguments.
