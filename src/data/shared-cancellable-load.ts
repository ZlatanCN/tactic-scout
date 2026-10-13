import { throwIfAborted } from "../domain/abort.js";

export class SharedCancellableLoad<T> {
  readonly signal: AbortSignal;
  readonly promise: Promise<T>;
  private readonly controller = new AbortController();
  private activeSubscribers = 0;
  private settled = false;

  constructor(load: (signal: AbortSignal) => Promise<T>) {
    this.signal = this.controller.signal;
    this.promise = Promise.resolve()
      .then(() => load(this.signal))
      .then((value) => {
        this.settled = true;
        return value;
      }, (error: unknown) => {
        this.settled = true;
        throw error;
      });
  }

  subscribe(signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    this.activeSubscribers += 1;
    return new Promise<T>((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        signal?.removeEventListener("abort", onAbort);
        this.activeSubscribers -= 1;
        if (this.activeSubscribers === 0 && !this.settled && !this.signal.aborted) {
          this.controller.abort(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
        }
      };
      const onAbort = () => {
        release();
        reject(signal?.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.promise.then(
        (value) => {
          release();
          resolve(value);
        },
        (error: unknown) => {
          release();
          reject(error);
        },
      );
    });
  }
}
