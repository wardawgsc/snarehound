import fs from "node:fs/promises";

function normalizeSignature(lines: string[]): string {
  return lines
    .map((line) => line.replace(/^<[^>]+>\s*/, "").trim())
    .filter((line) => line.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .join("\n");
}

export type ShipDetectedPayload = {
  shipName: string;
  signature: string[];
  normalizedSignature: string;
  triggerLine?: string;
  resolvedBy?: string;
};

type TailerOptions = {
  filePath: string;
  triggerText: string;
  keywords: string[];
  flushMs: number;
  onShipDetected: (payload: ShipDetectedPayload) => Promise<void>;
};

export class LegacyStyleLogTailer {
  private readonly options: TailerOptions;
  private lastSize = 0;
  private signatureBuffer: string[] = [];
  private lastRelevantAt = 0;

  constructor(options: TailerOptions) {
    this.options = options;
  }

  async tick(): Promise<void> {
    const stats = await fs.stat(this.options.filePath);

    if (stats.size < this.lastSize) {
      this.lastSize = 0;
    }

    if (stats.size > this.lastSize) {
      const chunk = await this.readRange(this.lastSize, stats.size);
      this.lastSize = stats.size;
      this.processChunk(chunk);
    }

    if (this.signatureBuffer.length > 0 && Date.now() - this.lastRelevantAt > this.options.flushMs) {
      await this.flushSignatureBuffer();
    }
  }

  private processChunk(chunk: string): void {
    const lines = chunk.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const isRelevant = this.options.keywords.some((keyword) => line.includes(keyword));
      if (isRelevant) {
        this.signatureBuffer.push(line);
        this.lastRelevantAt = Date.now();
      }
    }
  }

  private async flushSignatureBuffer(): Promise<void> {
    let triggerLine: string | undefined;
    const triggerIndex = this.signatureBuffer.findIndex((line) => line.includes(this.options.triggerText));

    let workingBuffer = this.signatureBuffer;
    if (triggerIndex >= 0) {
      triggerLine = this.signatureBuffer[triggerIndex];
      workingBuffer = this.signatureBuffer.slice(0, triggerIndex);
    }

    if (workingBuffer.length > 0) {
      const normalizedSignature = normalizeSignature(workingBuffer);
      await this.options.onShipDetected({
        shipName: "UNKNOWN",
        signature: [...workingBuffer],
        normalizedSignature,
        triggerLine
      });
    }

    this.signatureBuffer = [];
  }

  private async readRange(start: number, end: number): Promise<string> {
    const length = end - start;
    if (length <= 0) {
      return "";
    }

    const handle = await fs.open(this.options.filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  }
}
