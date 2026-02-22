import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface DeploymentPlatform {
    id: string;
    name: string;
    cli: string;
    description: string;
}

export class DeploymentService {
    public static readonly PLATFORMS: DeploymentPlatform[] = [
        { id: 'aws', name: 'AWS', cli: 'aws', description: 'Amazon Web Services (S3, Lambda, ECS, etc.)' },
        { id: 'gcp', name: 'Google Cloud', cli: 'gcloud', description: 'Google Cloud Platform (GAE, GKE, Cloud Run)' },
        { id: 'k8s', name: 'Kubernetes', cli: 'kubectl', description: 'Any Kubernetes cluster' },
        { id: 'vercel', name: 'Vercel', cli: 'vercel', description: 'Vercel static/serverless hosting' },
        { id: 'cloudflare', name: 'Cloudflare', cli: 'wrangler', description: 'Cloudflare Pages and Workers' },
        { id: 'gh-actions', name: 'GitHub Actions', cli: 'gh', description: 'GitHub CI/CD pipelines' },
        { id: 'do', name: 'DigitalOcean', cli: 'doctl', description: 'DigitalOcean Droplets/App Platform' },
    ];

    constructor(private workingDir: string) { }

    public async getProjectAnalysis(): Promise<string> {
        const pkgPath = join(this.workingDir, 'package.json');
        const hasDocker = existsSync(join(this.workingDir, 'Dockerfile'));
        const hasGit = existsSync(join(this.workingDir, '.git'));

        let analysis = `Project context:`;
        if (existsSync(pkgPath)) {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
            analysis += `\n- Type: Node.js / TypeScript`;
            if (pkg.dependencies?.next) analysis += ` (Next.js)`;
            else if (pkg.dependencies?.react) analysis += ` (React)`;
        }
        if (hasDocker) analysis += `\n- Has Dockerfile (Container-ready)`;
        if (hasGit) analysis += `\n- Git Repository detected`;

        return analysis;
    }

    public getDeploymentPrompt(platform: string, analysis: string): string {
        const plat = DeploymentService.PLATFORMS.find(p => p.id === platform) || { name: platform, cli: platform };

        return `You are now in DEPLOYMENT MODE for ${plat.name}.
${analysis}

Tasks:
1. Identify if the user has the ${plat.cli} CLI installed and authenticated.
2. Generate or update configuration files as needed.
3. Manage environments (e.g. dev vs prod) by selecting appropriate branches or secrets.
4. Execute operations like restarting services/pods, rolling back, or creating new deployments.
5. If it's a "delete" request, find the resource name and provide the command to destroy it.

Platform-specific notes:
- AWS: Use CloudFormation or Terraform if possible.
- K8s: Check for existing manifests or generate them.
- GitHub Actions: Help create secrets handling.

### Database Migrations
{{MIGRATION_SECTION}}

Continue by analyzing the current file structure and suggesting the first step.`;
    }

    public getGithubActionTemplate(platform: string): string {
        return `name: Deploy to ${platform}
on:
  push:
    branches: [ main ]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install && npm run build
      # platform-specific deploy step here
`;
    }

    public getDockerfileTemplate(): string {
        return `FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
`;
    }

    public parseEnv(filePath: string): Record<string, string> {
        if (!existsSync(filePath)) return {};
        const content = readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const env: Record<string, string> = {};
        for (const line of lines) {
            const trim = line.trim();
            if (!trim || trim.startsWith('#')) continue;
            const [key, ...val] = trim.split('=');
            if (key) env[key.trim()] = val.join('=').trim();
        }
        return env;
    }

    public compareEnv(local: Record<string, string>, cloud: Record<string, string>): { missingInCloud: string[], diffValue: string[], missingInLocal: string[] } {
        const missingInCloud = Object.keys(local).filter(k => !(k in cloud));
        const missingInLocal = Object.keys(cloud).filter(k => !(k in local));
        const diffValue = Object.keys(local).filter(k => k in cloud && local[k] !== cloud[k]);
        return { missingInCloud, diffValue, missingInLocal };
    }

    public getEnvSyncPrompt(platform: string, environment: string, diff: any): string {
        return `You are in ENV-SYNC MODE for ${platform} (${environment}).
        
I've detected the following differences between your local .env and the cloud secrets:
- 🆕 Missing in Cloud: ${diff.missingInCloud.join(', ') || 'None'}
- ⚠️ Different Values: ${diff.diffValue.join(', ') || 'None'}
- 📥 Missing Locally (present in cloud): ${diff.missingInLocal.join(', ') || 'None'}

Goal: Sync these variables using the \`deploy_command\` tool with the appropriate CLI.
Example commands:
- Vercel: \`vercel env add NAME VALUE\`
- AWS: \`aws secretsmanager put-secret-value --secret-id ... --secret-string ...\`
- GitHub: \`gh secret set NAME --body VALUE\`

Please suggest which variables to sync or download now.`;
    }
}
