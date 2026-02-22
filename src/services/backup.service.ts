import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';


export type BackupInterval = 'once' | 'weekly' | 'monthly';

export class BackupService {
    private backupDir: string;
    private schedules: Map<string, NodeJS.Timeout> = new Map();

    constructor(private workingDir: string) {
        this.backupDir = join(this.workingDir, '.multi-agent', 'backups');
        if (!existsSync(this.backupDir)) {
            mkdirSync(this.backupDir, { recursive: true });
        }
    }

    /**
     * Performs a database backup based on the URL.
     */
    public async performBackup(dbUrl: string): Promise<string> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `backup-${timestamp}.sql`;
        const outputPath = join(this.backupDir, fileName);

        let command = '';
        if (dbUrl.startsWith('postgres') || dbUrl.startsWith('postgresql')) {
            command = `pg_dump "${dbUrl}" > "${outputPath}"`;
        } else if (dbUrl.startsWith('mysql')) {
            // Basic mysql parser for URL (best effort)
            command = `mysqldump "${dbUrl}" > "${outputPath}"`;
        } else if (dbUrl.startsWith('mongodb')) {
            command = `mongodump --uri="${dbUrl}" --archive="${outputPath}"`;
        } else {
            throw new Error('Unsupported database protocol for backup. Supported: postgres, mysql, mongodb.');
        }

        try {
            execSync(command, { stdio: 'ignore' });
            return fileName;
        } catch (err: any) {
            throw new Error(`Backup failed: ${err.message}`);
        }
    }

    /**
     * Schedules a recurring backup.
     */
    public scheduleBackup(dbUrl: string, interval: BackupInterval, onComplete: (fileName: string) => void, onError: (err: any) => void) {
        this.cancelBackup(dbUrl); // Avoid duplicates

        let ms = 0;
        if (interval === 'weekly') ms = 7 * 24 * 60 * 60 * 1000;
        else if (interval === 'monthly') ms = 30 * 24 * 60 * 60 * 1000;

        if (ms === 0) return;

        const timer = setInterval(async () => {
            try {
                const file = await this.performBackup(dbUrl);
                onComplete(file);
            } catch (err) {
                onError(err);
            }
        }, ms);

        this.schedules.set(dbUrl, timer);
    }

    public cancelBackup(dbUrl: string) {
        const existing = this.schedules.get(dbUrl);
        if (existing) {
            clearInterval(existing);
            this.schedules.delete(dbUrl);
        }
    }

    public getSchedules(): string[] {
        return Array.from(this.schedules.keys());
    }
}
