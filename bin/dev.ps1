# PowerShell wrapper for cli-project
# This file allows running the CLI on Windows using PowerShell

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Arguments
)

# Get the directory where this script is located
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Run the Node.js script with all arguments passed through
& node "$scriptDir\dev.js" @Arguments

# Exit with the same code as Node.js
exit $LASTEXITCODE
