import { marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { highlight } from 'cli-highlight';

/**
 * Markdown renderer for terminal output.
 */
export class MarkdownRenderer {
  private extension: MarkedExtension;

  constructor() {
    this.extension = markedTerminal({
      // Override fenced code block rendering with syntax highlighting
      code: (code: string, language?: string) => {
        try {
          return highlight(code, {
            language: language || undefined,
            ignoreIllegals: true,
          });
        } catch {
          return code;
        }
      },
    }) as unknown as MarkedExtension;

    marked.use(this.extension);
  }

  render(markdown: string): string {
    return marked.parse(markdown) as string;
  }
}

export const markdownRenderer = new MarkdownRenderer();
