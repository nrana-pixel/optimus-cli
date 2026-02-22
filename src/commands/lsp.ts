import { Command } from '@oclif/core';
import { LspService } from '../services/lsp.service.js';

export default class Lsp extends Command {
    static override description = 'Start the Language Server Protocol (LSP) for editor autocomplete';
    static override aliases = ['lsp-server'];

    public async run(): Promise<void> {
        const lsp = new LspService();
        lsp.start();
    }
}
