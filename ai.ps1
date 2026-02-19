#!/usr/bin/env pwsh
# ai.ps1 – global launcher for the AI chat CLI
# Place this file in a folder that is on your PATH (e.g. C:\Users\nrana\bin\)
# Then just type:  ai            → opens interactive chat
#                  ai chat       → same
#                  ai init       → first-time setup
#                  ai code "..." → one-shot code generation

$projectRoot = "F:\cli-project"
node "$projectRoot\bin\dev.js" @args
