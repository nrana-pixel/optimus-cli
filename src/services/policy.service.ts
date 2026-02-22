import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type UserRole = 'viewer' | 'contributor' | 'approver' | 'admin';

export interface AdminPolicy {
    role: UserRole;
    blockedCommands: string[];
    requireApprovalFor: string[];
    auditStreamUrl?: string; // Where to send logs
}

export class PolicyService {
    private policyPath: string;
    private currentPolicy: AdminPolicy;

    constructor(private workingDir: string) {
        this.policyPath = join(this.workingDir, '.multi-agent', 'policy.json');
        this.currentPolicy = this.loadPolicy();
    }

    private loadPolicy(): AdminPolicy {
        if (existsSync(this.policyPath)) {
            try {
                return JSON.parse(readFileSync(this.policyPath, 'utf8'));
            } catch {
                // Fallback to default
            }
        }
        return {
            role: 'admin', // Default to admin for local solo use
            blockedCommands: [],
            requireApprovalFor: ['/deploy prod', 'delete'],
        };
    }

    public getRole(): UserRole {
        return this.currentPolicy.role;
    }

    public isCommandAllowed(line: string): { allowed: boolean; reason?: string } {
        const cmd = line.trim().split(/\s+/)[0].toLowerCase();

        if (this.currentPolicy.blockedCommands.includes(cmd)) {
            return { allowed: false, reason: `Your role (${this.currentPolicy.role}) is restricted from using \`${cmd}\`.` };
        }

        const needsApproval = this.currentPolicy.requireApprovalFor.some(p => line.includes(p));
        if (needsApproval && this.currentPolicy.role !== 'admin' && this.currentPolicy.role !== 'approver') {
            return { allowed: false, reason: `Action \`${line}\` requires Admin or Approver authorization.` };
        }

        return { allowed: true };
    }

    public updateRole(role: UserRole) {
        this.currentPolicy.role = role;
        this.save();
    }

    private save() {
        writeFileSync(this.policyPath, JSON.stringify(this.currentPolicy, null, 2));
    }
}
