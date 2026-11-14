/** Minimal event emitter, shape-compatible with vscode.Event, so core code needs no `vscode` import. */
export type Listener<T> = (e: T) => void;
export type Event<T> = (listener: Listener<T>) => { dispose(): void };

export class Emitter<T> {
  private listeners = new Set<Listener<T>>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(e: T): void {
    for (const l of [...this.listeners]) {
      l(e);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
