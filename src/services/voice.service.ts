import recorder from 'node-record-lpcm16';
const { record } = recorder;
import FormData from 'form-data';
import { ConfigService } from './config.service.js';
import { createWriteStream, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export class VoiceService {
    private recording: any = null;
    private tempFile: string = join(tmpdir(), `optimus-voice-${Date.now()}.wav`);

    async startRecording(): Promise<void> {
        return new Promise((resolve) => {
            const file = createWriteStream(this.tempFile);
            this.recording = record({
                sampleRate: 16000,
                threshold: 0,
                verbose: false,
                recordProgram: 'rec', // Or 'sox' or 'arecord'
            });

            this.recording.stream().pipe(file);
            resolve();
        });
    }

    async stopRecording(): Promise<string> {
        if (!this.recording) return '';

        this.recording.stop();
        this.recording = null;

        // Small delay to ensure file is flushed
        await new Promise(r => setTimeout(r, 500));

        const transcription = await this.transcribe(this.tempFile);

        try {
            unlinkSync(this.tempFile);
        } catch {
            // Ignore
        }

        return transcription;
    }

    private async transcribe(filePath: string): Promise<string> {
        const config = ConfigService.loadConfig();
        const apiKey = ConfigService.getApiKey();

        if (config.apiProvider !== 'openai') {
            // For now, we only support OpenAI Whisper. 
            // If the user uses Anthropic/Gemini, they still need an OpenAI key or we skip.
            // Alternatively we can use Gemini Audio but implementation differs significantly.
            return 'Voice transcription currently requires OpenAI API Provider.';
        }

        const form = new FormData();
        form.append('file', readFileSync(filePath), {
            filename: 'audio.wav',
            contentType: 'audio/wav',
        });
        form.append('model', 'whisper-1');

        try {
            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    ...form.getHeaders(),
                },
                body: form as any,
            });

            if (!response.ok) {
                const err = await response.json() as any;
                throw new Error(err.error?.message || 'Transcription failed');
            }

            const data = await response.json() as { text: string };
            return data.text;
        } catch (error: any) {
            console.error('Transcription error:', error.message);
            return `Transcription failed: ${error.message}`;
        }
    }
}
