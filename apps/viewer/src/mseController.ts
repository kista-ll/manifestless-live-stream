import type { BinaryFrame } from "./protocol";

export interface SourceBufferLike extends EventTarget {
  updating: boolean;
  buffered: TimeRanges;
  appendBuffer: (data: BufferSource) => void;
  remove: (start: number, end: number) => void;
}

export interface MediaSourceLike extends EventTarget {
  readyState: string;
  addSourceBuffer: (mimeType: string) => SourceBufferLike;
  endOfStream: () => void;
}

type Operation =
  | { type: "append"; data: Uint8Array }
  | { type: "remove"; start: number; end: number }
  | { type: "end" };

export class MseController {
  private sourceBuffer: SourceBufferLike | null = null;
  private readonly operations: Operation[] = [];
  private ended = false;

  constructor(private readonly mediaSource: MediaSourceLike) {}

  initialize(mimeType: string): void {
    if (!MediaSource.isTypeSupported(mimeType)) {
      throw new Error(`Unsupported MIME type: ${mimeType}`);
    }
    this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
    this.sourceBuffer.addEventListener("updateend", () => this.pump());
  }

  append(frame: BinaryFrame): void {
    if (this.ended) {
      return;
    }
    this.operations.push({ type: "append", data: frame.payload });
    this.trimAppendQueue();
    this.pump();
  }

  removeBefore(currentTime: number): void {
    const sourceBuffer = this.requireSourceBuffer();
    if (sourceBuffer.buffered.length === 0) {
      return;
    }
    const removeEnd = currentTime - 5;
    const start = sourceBuffer.buffered.start(0);
    if (removeEnd > start) {
      this.operations.push({ type: "remove", start, end: removeEnd });
      this.pump();
    }
  }

  endWhenIdle(): void {
    this.operations.push({ type: "end" });
    this.pump();
  }

  private pump(): void {
    const sourceBuffer = this.sourceBuffer;
    if (sourceBuffer === null || sourceBuffer.updating) {
      return;
    }
    const operation = this.operations.shift();
    if (operation === undefined) {
      return;
    }

    if (operation.type === "append") {
      sourceBuffer.appendBuffer(operation.data.slice().buffer);
    } else if (operation.type === "remove") {
      sourceBuffer.remove(operation.start, operation.end);
    } else if (this.mediaSource.readyState === "open") {
      this.ended = true;
      this.mediaSource.endOfStream();
    }
  }

  private requireSourceBuffer(): SourceBufferLike {
    if (this.sourceBuffer === null) {
      throw new Error("SourceBuffer is not initialized");
    }
    return this.sourceBuffer;
  }

  private trimAppendQueue(): void {
    const appendIndexes = this.operations
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => operation.type === "append");
    while (appendIndexes.length > 10) {
      const oldest = appendIndexes.shift();
      if (oldest !== undefined) {
        this.operations.splice(oldest.index, 1);
      }
    }
  }
}
