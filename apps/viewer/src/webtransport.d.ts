interface WebTransport {
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  readonly incomingUnidirectionalStreams: ReadableStream<ReadableStream<Uint8Array>>;
  createBidirectionalStream: () => Promise<{
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  }>;
  close: () => void;
}

declare const WebTransport: {
  prototype: WebTransport;
  new (
    url: string,
    options?: {
      serverCertificateHashes?: Array<{
        algorithm: string;
        value: BufferSource;
      }>;
    },
  ): WebTransport;
};
