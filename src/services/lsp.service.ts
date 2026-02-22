import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    TextDocumentSyncKind,
    CompletionItemKind
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { LLMServiceLiteLLM } from './llm-litellm.service.js';

export class LspService {
    private connection = createConnection(ProposedFeatures.all);
    private documents = new TextDocuments(TextDocument);
    private llm: LLMServiceLiteLLM | null = null;

    constructor() {
        this.setupHandlers();
    }

    public start() {
        this.connection.listen();
    }

    private setupHandlers() {
        this.connection.onInitialize((params: InitializeParams) => {
            this.llm = new LLMServiceLiteLLM();
            return {
                capabilities: {
                    textDocumentSync: TextDocumentSyncKind.Incremental,
                    completionProvider: {
                        resolveProvider: false,
                        triggerCharacters: ['.', ' ', '\n', '(', '{', '[']
                    }
                }
            };
        });

        this.connection.onCompletion(async (textDocumentPosition) => {
            const doc = this.documents.get(textDocumentPosition.textDocument.uri);
            if (!doc || !this.llm) return [];

            const text = doc.getText();
            const offset = doc.offsetAt(textDocumentPosition.position);

            const prefix = text.slice(Math.max(0, offset - 1500), offset);
            const suffix = text.slice(offset, Math.min(text.length, offset + 500));

            try {
                const prompt = `You are a code completion AI. Produce ONLY the code that goes between the prefix and suffix. Do not repeat the prefix or suffix. No markdown formatting, no explanations. 
        
Prefix:
${prefix}

Suffix:
${suffix}

Your completion:`;

                const response = await this.llm.complete(prompt, "You are a ghost-text autocompletion AI. Output only the missing code.");
                const completionText = response.content.trim()
                    .replace(/^```[\w]*\n/, '')
                    .replace(/\n```$/, '');

                if (!completionText) return [];

                return [
                    {
                        label: `Optimus AI: ${completionText.slice(0, 20)}...`,
                        kind: CompletionItemKind.Snippet,
                        insertText: completionText,
                        sortText: '0000_ai_suggestion',
                        detail: 'Optimus LSP Autocomplete'
                    }
                ];
            } catch (e) {
                return [];
            }
        });

        this.documents.listen(this.connection);
    }
}
