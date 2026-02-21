/**
 * Adaptive Stream Controller
 * Manages the flow of incoming tokens from the AI to ensure a smooth TUI experience.
 * Prevents flickering by newline-gating and adaptive pacing.
 */

export interface StreamControllerOptions {
  onEmit: (text: string) => void;
  smoothIntervalMs?: number;
  catchUpThreshold?: number;
}

export enum StreamMode {
  Smooth = 'smooth',
  CatchUp = 'catch-up'
}

export class StreamController {
  private queue: string[] = [];
  private fullText: string = '';
  private interval: NodeJS.Timeout | null = null;
  private isFinishing: boolean = false;
  private mode: StreamMode = StreamMode.Smooth;

  // Hysteresis thresholds
  private readonly ENTER_CATCHUP_THRESHOLD = 30; // tokens in queue to enter fast mode
  private readonly EXIT_CATCHUP_THRESHOLD = 5;  // tokens in queue to return to smooth mode

  constructor(private options: StreamControllerOptions) {
    this.options.smoothIntervalMs ??= 20; // faster base pacing
    this.options.catchUpThreshold ??= 30;
  }

  /**
   * Push a new chunk from the LLM.
   */
  push(chunk: string) {
    if (!chunk) return;
    
    // Split into characters for granular control
    const chars = chunk.split('');
    this.queue.push(...chars);

    if (!this.interval) {
      this.startLoop();
    }
  }

  /**
   * Signal that the LLM has finished generating.
   * This will trigger a fast flush of the remaining queue.
   */
  finalize() {
    this.isFinishing = true;
    this.mode = StreamMode.CatchUp; // Force catch-up on finish
  }

  private startLoop() {
    const tick = () => {
      if (this.queue.length === 0) {
        if (this.isFinishing) {
          this.stop();
          return;
        }
        // Idle - wait for more tokens
        this.interval = setTimeout(tick, this.options.smoothIntervalMs);
        return;
      }

      // --- TWO-GEAR HYSTERESIS SYSTEM ---
      if (this.mode === StreamMode.Smooth && this.queue.length > this.ENTER_CATCHUP_THRESHOLD) {
        this.mode = StreamMode.CatchUp;
      } else if (this.mode === StreamMode.CatchUp && this.queue.length < this.EXIT_CATCHUP_THRESHOLD && !this.isFinishing) {
        this.mode = StreamMode.Smooth;
      }

      let toEmitCount = 1;
      if (this.mode === StreamMode.CatchUp) {
        // In CatchUp gear, we drain 25% of the queue or at least 5 chars per tick
        toEmitCount = Math.max(5, Math.ceil(this.queue.length * 0.25));
      }

      const emitted = this.queue.splice(0, toEmitCount).join('');
      this.fullText += emitted;
      this.options.onEmit(this.fullText);

      // Variable interval based on mode
      const nextInterval = this.mode === StreamMode.Smooth ? this.options.smoothIntervalMs! : 10;
      this.interval = setTimeout(tick, nextInterval);
    };

    tick();
  }

  private stop() {
    if (this.interval) {
      clearTimeout(this.interval);
      this.interval = null;
    }
    // Final emission to ensure everything is out
    if (this.queue.length > 0) {
      this.fullText += this.queue.join('');
      this.queue = [];
      this.options.onEmit(this.fullText);
    }
    this.isFinishing = false;
  }
}
