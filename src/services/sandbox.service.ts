import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export class SandboxService {
    private sandboxDir = join(homedir(), '.multi-agent', 'sandbox');
    private process: any = null;

    constructor() {
        if (!existsSync(this.sandboxDir)) {
            mkdirSync(this.sandboxDir, { recursive: true });
            this.initSandbox();
        }
    }

    private initSandbox() {
        const pkg = {
            name: 'optimus-sandbox',
            private: true,
            version: '0.0.0',
            type: 'module',
            scripts: {
                dev: 'vite',
                build: 'tsc && vite build',
                preview: 'vite preview'
            },
            dependencies: {
                react: '^18.3.1',
                'react-dom': '^18.3.1'
            },
            devDependencies: {
                '@types/react': '^18.3.3',
                '@types/react-dom': '^18.3.0',
                '@vitejs/plugin-react': '^4.3.1',
                typescript: '^5.5.3',
                vite: '^5.4.1'
            }
        };

        writeFileSync(join(this.sandboxDir, 'package.json'), JSON.stringify(pkg, null, 2));

        const viteConfig = `
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`;
        writeFileSync(join(this.sandboxDir, 'vite.config.ts'), viteConfig);

        const indexHtml = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Optimus Sandbox</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
        writeFileSync(join(this.sandboxDir, 'index.html'), indexHtml);

        const srcDir = join(this.sandboxDir, 'src');
        if (!existsSync(srcDir)) mkdirSync(srcDir);

        const mainTsx = `
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`;
        writeFileSync(join(srcDir, 'main.tsx'), mainTsx);
    }

    public async updateComponent(code: string): Promise<string> {
        const srcDir = join(this.sandboxDir, 'src');
        if (!existsSync(srcDir)) mkdirSync(srcDir);

        // Attempt to extract React component if wrapped in markdown
        const cleaned = code.replace(/```tsx\n?/, '').replace(/\n?```/, '').trim();
        writeFileSync(join(srcDir, 'App.tsx'), cleaned);

        if (!this.process) {
            await this.start();
        }

        return 'http://localhost:5173';
    }

    private async start(): Promise<void> {
        return new Promise((resolve) => {
            // Check if node_modules exists, if not, we need to install
            if (!existsSync(join(this.sandboxDir, 'node_modules'))) {
                const install = spawn('npm', ['install'], { cwd: this.sandboxDir, shell: true });
                install.on('close', () => {
                    this.runVite(resolve);
                });
            } else {
                this.runVite(resolve);
            }
        });
    }

    private runVite(resolve: any) {
        this.process = spawn('npx', ['vite', '--port', '5173'], { cwd: this.sandboxDir, shell: true });

        this.process.stdout.on('data', (data: any) => {
            if (data.toString().includes('Local:')) {
                resolve();
            }
        });

        this.process.stderr.on('data', (data: any) => {
            console.error(`Vite error: ${data}`);
        });
    }

    public stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}
