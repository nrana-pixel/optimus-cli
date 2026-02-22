import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

export interface PendingMigration {
    file: string;
    type: 'prisma' | 'sql' | 'drizzle' | 'other';
    timestamp: string;
}

export class MigrationService {
    private migrationsDir: string;

    constructor(private workingDir: string) {
        this.migrationsDir = join(this.workingDir, '.multi-agent', 'migrations');
        if (!existsSync(this.migrationsDir)) {
            mkdirSync(this.migrationsDir, { recursive: true });
        }
    }

    /**
     * Scans the project for common database schema files and returns their status.
     */
    public getPendingMigrations(): PendingMigration[] {
        const migrations: PendingMigration[] = [];

        // Check for Prisma
        if (existsSync(join(this.workingDir, 'prisma', 'schema.prisma'))) {
            // In a real scenario, we'd check if `prisma migrate diff` or similar shows changes.
            // For now, we flag it if the file exists and was recently modified.
            migrations.push({ file: 'prisma/schema.prisma', type: 'prisma', timestamp: new Date().toISOString() });
        }

        // Check for SQL files in common migration folders
        const sqlDirs = ['migrations', 'db/migrations', 'sql'];
        for (const dir of sqlDirs) {
            const absDir = join(this.workingDir, dir);
            if (existsSync(absDir)) {
                const files = readdirSync(absDir).filter(f => f.endsWith('.sql'));
                for (const f of files) {
                    migrations.push({ file: join(dir, f), type: 'sql', timestamp: new Date().toISOString() });
                }
            }
        }

        return migrations;
    }

    /**
     * Records a "Database Snapshot" log for the current state.
     */
    public recordSchemaChange(filePath: string, content: string) {
        const logFile = join(this.migrationsDir, `change-${Date.now()}.log`);
        const logEntry = {
            file: filePath,
            timestamp: new Date().toISOString(),
            content: content.slice(0, 5000) // Keep a snippet for reference
        };
        writeFileSync(logFile, JSON.stringify(logEntry, null, 2));
    }

    public getMigrationPrompt(pending: PendingMigration[]): string {
        if (pending.length === 0) return "No pending database migrations detected.";

        return `⚠️ **PENDING DATABASE CHANGES DETECTED**
The following schema files have changed or exist:
${pending.map(m => `- \`${m.file}\` (${m.type})`).join('\n')}

**Deployment Instructions:**
1. Before deploying code, ensure these migrations are applied to the target database.
2. Use \`deploy_command\` with the appropriate tool (e.g., \`npx prisma migrate deploy\`, \`psql\`, or \`doctl databases ...\`).
3. If this is a new project, verify the database connection string in your synchronized secrets.

Would you like me to prepare the migration commands for your chosen platform?`;
    }
}
