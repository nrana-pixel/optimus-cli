/**
 * Truncation utilities for preserving context in large strings.
 * Keeps the "Head" and "Tail" of a string while removing the middle.
 */

export interface TruncateOptions {
  maxLines?: number;
  maxChars?: number;
  preserveHeadLines?: number;
  preserveTailLines?: number;
}

/**
 * Truncates a string from the middle if it exceeds limits.
 * Useful for logs, build outputs, and large file reads.
 */
export function truncateMiddle(text: string, options: TruncateOptions = {}): string {
  const {
    maxLines = 1000,
    maxChars = 32000,
    preserveHeadLines = 50,
    preserveTailLines = 50,
  } = options;

  if (!text) return '';

  // 1. Check character limit
  if (text.length > maxChars) {
    const headChars = Math.floor(maxChars * 0.4);
    const tailChars = Math.floor(maxChars * 0.4);
    const removedChars = text.length - (headChars + tailChars);
    
    text = 
      text.slice(0, headChars) + 
      ` \n\n... [${removedChars.toLocaleString()} characters truncated from middle] ...\n\n ` + 
      text.slice(-tailChars);
  }

  // 2. Check line limit
  const lines = text.split('\n');
  if (lines.length > maxLines) {
    const head = lines.slice(0, preserveHeadLines);
    const tail = lines.slice(-preserveTailLines);
    const removedCount = lines.length - (preserveHeadLines + preserveTailLines);

    return [
      ...head,
      '',
      `... [${removedCount.toLocaleString()} lines truncated from middle] ...`,
      '',
      ...tail,
    ].join('\n');
  }

  return text;
}
