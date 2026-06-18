import { ControlDecoder, decodeBinaryFrame, type BinaryFrame, type ControlMessage } from "./protocol";

export interface WebTransportLike {
  ready: Promise<void>;
  closed: Promise<void>;
  close: () => void;
}

export type WebTransportFactory = (url: string) => WebTransportLike;

export interface TransportEventSink {
  control: (message: ControlMessage) => void;
  segment: (frame: BinaryFrame) => void;
  error: (error: Error) => void;
}

export class TransportClient {
  private abortController: AbortController | null = null;
  private retryIndex = 0;
  private transport: WebTransportLike | null = null;

  constructor(
    private readonly url: string,
    private readonly createTransport: WebTransportFactory,
    private readonly sink: TransportEventSink,
  ) {}

  async connect(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.transport = this.createTransport(this.url);
    await this.transport.ready;
    this.retryIndex = 0;
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.transport?.close();
    this.transport = null;
  }

  nextRetryDelayMs(): number {
    const delays = [1000, 2000, 4000, 8000, 10000];
    const delay = delays[Math.min(this.retryIndex, delays.length - 1)];
    this.retryIndex += 1;
    return delay;
  }

  decodeControlChunk(decoder: ControlDecoder, chunk: Uint8Array): void {
    for (const message of decoder.feed(chunk)) {
      this.sink.control(message);
    }
  }

  decodeBinaryStream(data: Uint8Array): void {
    try {
      this.sink.segment(decodeBinaryFrame(data));
    } catch (error) {
      this.sink.error(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
