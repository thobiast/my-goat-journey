import type { IncomingMessage, ServerResponse } from 'node:http';

/** A real loopback HTTP response held until Chromium cancels its socket.
 * No fetch/AbortController/Web Locks mocks and no shortened production budget.
 */
export class NativeTransferStall {
  readonly events: { event: string; at: number; bytes?: number }[] = [];
  startedAt?: number;
  cancelledAt?: number;
  private response?: ServerResponse;
  private remainder?: Buffer;

  constructor(readonly phase: 'headers' | 'body') {}

  hold(upstream: IncomingMessage, downstream: ServerResponse) {
    if (this.response) throw new Error('The stalled transfer must be requested exactly once');
    this.response = downstream;
    const chunks: Buffer[] = [];
    downstream.on('error', (error) => {
      this.events.push({ event: `socket-error:${error.message}`, at: Date.now() });
    });
    downstream.on('close', () => {
      if (!downstream.writableFinished) {
        this.cancelledAt = Date.now();
        this.events.push({ event: 'chromium-cancelled-socket', at: this.cancelledAt });
      }
    });
    upstream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    upstream.on('end', () => {
      const bytes = Buffer.concat(chunks);
      this.startedAt = Date.now();
      this.events.push({ event: `stall-${this.phase}`, at: this.startedAt, bytes: bytes.length });
      if (this.phase === 'body') {
        downstream.writeHead(upstream.statusCode ?? 502, upstream.headers);
        downstream.flushHeaders();
        const split = Math.max(1, Math.floor(bytes.length / 2));
        downstream.write(bytes.subarray(0, split));
        this.remainder = bytes.subarray(split);
      } else {
        this.remainder = bytes;
      }
    });
  }

  /** Try the late bytes only AFTER observed browser cancellation. */
  release() {
    this.events.push({ event: 'late-server-release', at: Date.now() });
    this.response?.end(this.remainder);
  }

  dispose() {
    this.response?.destroy();
  }

  snapshot() {
    return {
      phase: this.phase,
      startedAt: this.startedAt,
      cancelledAt: this.cancelledAt,
      elapsedMs: this.cancelledAt && this.startedAt ? this.cancelledAt - this.startedAt : undefined,
      events: this.events,
    };
  }
}
