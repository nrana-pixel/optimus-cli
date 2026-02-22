import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        const platform = process.platform;

        if (platform === 'win32') {
            // Use powershell to handle UTF-8 and multiline better than 'clip'
            const command = `Set-Clipboard -Value @'\n${text.replace(/'/g, "''")}\n'@`;
            await execAsync(`powershell -command "${command.replace(/"/g, '\\"')}"`);
            return true;
        } else if (platform === 'darwin') {
            const child = exec('pbcopy');
            child.stdin?.write(text);
            child.stdin?.end();
            return true;
        } else {
            // Linux (best effort)
            try {
                const child = exec('xclip -selection clipboard');
                child.stdin?.write(text);
                child.stdin?.end();
            } catch {
                const child = exec('xsel --clipboard --input');
                child.stdin?.write(text);
                child.stdin?.end();
            }
            return true;
        }
    } catch (err) {
        console.error('Clipboard error:', err);
        return false;
    }
}
