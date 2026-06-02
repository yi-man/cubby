export class RingBuffer {
  private buffer: string[];
  private maxSize: number;
  private index = 0;

  constructor(maxSize: number = 5000) {
    this.buffer = [];
    this.maxSize = maxSize;
  }

  push(line: string): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
    }
    this.buffer.push(line);
    this.index++;
  }

  getAll(): string[] {
    return [...this.buffer];
  }

  getSince(index: number): string[] {
    const start = index - (this.index - this.buffer.length);
    if (start < 0) return [...this.buffer];
    return this.buffer.slice(start);
  }

  get currentIndex(): number {
    return this.index;
  }
}
