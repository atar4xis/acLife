export type ArgonRequest = {
  password: string;
  salt: number[];
  hashLen: number;
  time: number;
  mem: number;
  parallelism: number;
  type: number;
};

// argon2's WASM loader doesn't work under jsdom, so stub Worker with a SubtleCrypto-based hash
export class FakeArgonWorker {
  static requests: ArgonRequest[] = [];

  onmessage: ((e: MessageEvent) => void) | null = null;

  terminate() {}

  postMessage(data: ArgonRequest) {
    FakeArgonWorker.requests.push(data);
    void crypto.subtle
      .digest(
        "SHA-256",
        new TextEncoder().encode(
          data.password + ":" + JSON.stringify(data.salt),
        ),
      )
      .then((digest) => {
        this.onmessage?.({
          data: { hash: Array.from(new Uint8Array(digest, 0, data.hashLen)) },
        } as MessageEvent);
      })
      .catch((err: unknown) => {
        this.onmessage?.({
          data: { error: err instanceof Error ? err.message : String(err) },
        } as MessageEvent);
      });
  }
}
