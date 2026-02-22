import { watch, FSWatcher } from 'chokidar';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative } from 'path';
import { homedir } from 'os';
import { LLMServiceLiteLLM } from './llm-litellm.service.js';

export interface AuditFinding {
    filePath: string;
    finding: string;
    severity: 'high' | 'medium' | 'low' | 'performance';
    timestamp: string;
}

export class AuditorService {
    private watcher: FSWatcher | null = null;
    private llm = new LLMServiceLiteLLM();
    private auditDir = join(homedir(), '.multi-agent', 'audits');
    private pendingFiles = new Set<string>();
    private debounceTimer: NodeJS.Timeout | null = null;

    constructor() {
        if (!existsSync(this.auditDir)) {
            mkdirSync(this.auditDir, { recursive: true });
        }
    }

    public start(workingDir: string, onUpdate: (findings: AuditFinding[]) => void) {
        this.watcher = watch(workingDir, {
            ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
            persistent: true,
            ignoreInitial: true,
        });

        this.watcher.on('change', (path) => {
            this.pendingFiles.add(path);
            this.triggerAudit(onUpdate);
        });
    }

    public stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }

    private triggerAudit(onUpdate: (findings: AuditFinding[]) => void) {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);

        this.debounceTimer = setTimeout(async () => {
            const files = Array.from(this.pendingFiles);
            this.pendingFiles.clear();

            const findings = await this.runAudit(files);
            if (findings.length > 0) {
                this.saveFindings(findings);
                onUpdate(findings);
            }
        }, 10000); // 10 second debounce for deep audit
    }

    private async runAudit(filePaths: string[]): Promise<AuditFinding[]> {
        const findings: AuditFinding[] = [];

        for (const path of filePaths) {
            if (!existsSync(path)) continue;

            try {
                const content = readFileSync(path, 'utf-8');
                if (content.length > 50000) continue; // Skip huge files

                const prompt = `Perform a SECURITY and PERFORMANCE audit on this file: ${path}

Content:
${content}

Identify critical security vulnerabilities (injection, auth, sensitive data leaks) or major performance bottlenecks (N+1 queries, inefficient loops).
Provide your response in JSON format:
{
  "findings": [
    {
      "finding": "Short descriptive text",
      "severity": "high" | "medium" | "low" | "performance"
    }
  ]
}`;

                const response = await this.llm.complete(prompt, "You are a world-class Security and Performance auditor. Reply ONLY in JSON.");

                try {
                    const raw = response.content.replace(/```json\n?/, '').replace(/\n?```/, '').trim();
                    const parsed = JSON.parse(raw);
                    if (parsed.findings && Array.isArray(parsed.findings)) {
                        for (const f of parsed.findings) {
                            findings.push({
                                filePath: path,
                                finding: f.finding,
                                severity: f.severity,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                } catch {
                    // LLM might have failed JSON format
                }
            } catch (err) {
                console.error(`Audit failed for ${path}:`, err);
            }
        }

        return findings;
    }

    private saveFindings(findings: AuditFinding[]) {
        const logPath = join(this.auditDir, `audit-log.json`);
        let existing: AuditFinding[] = [];
        if (existsSync(logPath)) {
            try {
                existing = JSON.parse(readFileSync(logPath, 'utf-8'));
            } catch {
                existing = [];
            }
        }
        const updated = [...findings, ...existing].slice(0, 100); // Keep last 100
        writeFileSync(logPath, JSON.stringify(updated, null, 2));
    }
}
