import axios from 'axios';

export interface MonitoringStatus {
    url: string;
    isUp: boolean;
    lastCheck: string;
    error?: string;
    latencyMs?: number;
}

export class MonitoringService {
    private interval: NodeJS.Timeout | null = null;
    private currentUrl: string | null = null;
    private isChecking = false;

    constructor() { }

    public async start(url: string, intervalSeconds: number, onDown: (status: MonitoringStatus) => void) {
        this.stop();
        this.currentUrl = url;

        this.interval = setInterval(async () => {
            if (this.isChecking) return;
            this.isChecking = true;

            const start = Date.now();
            try {
                const res = await axios.get(url, { timeout: 10000 });
                const latency = Date.now() - start;

                if (res.status >= 400) {
                    throw new Error(`Status ${res.status}`);
                }
            } catch (err: any) {
                onDown({
                    url,
                    isUp: false,
                    lastCheck: new Date().toISOString(),
                    error: err.message,
                    latencyMs: Date.now() - start,
                });
            } finally {
                this.isChecking = false;
            }
        }, intervalSeconds * 1000);
    }

    public stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.currentUrl = null;
    }

    public getStatus(): string {
        return this.currentUrl ? `Monitoring: ${this.currentUrl}` : 'Vigilante Mode: Inactive';
    }
}
