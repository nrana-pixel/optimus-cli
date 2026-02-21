declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked';

  export default class Renderer {
    constructor(options?: Record<string, unknown>, highlightOptions?: Record<string, unknown>);
  }

  export function markedTerminal(
    options?: Record<string, unknown>,
    highlightOptions?: Record<string, unknown>
  ): MarkedExtension;
}
