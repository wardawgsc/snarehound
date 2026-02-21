import fs from "node:fs/promises";
import path from "node:path";

type ShipLibraryEntry = {
  shipName: string;
  signatureLines: string[];
};

type Unknown = Record<string, string>;

function normalizeSignature(lines: string[]): string {
  return lines
    .map((line) => line.replace(/^<[^>]+>\s*/, "").trim())
    .filter((line) => line.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .join("\n");
}

function isLikelyPlainText(text: string): boolean {
  if (!text) {
    return true;
  }

  let printable = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) || code >= 160) {
      printable++;
    }
  }

  return printable / text.length >= 0.9;
}

function decodeWithKey(encoded: string, key: string): string {
  if (!encoded || !key) {
    return "";
  }

  const tokens = encoded.split(",").map((value) => value.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }

  let out = "";
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!/^-?\d+$/.test(token)) {
      return "";
    }

    const keyCode = key.charCodeAt(index % key.length);
    const value = Number(token) ^ keyCode;
    out += String.fromCharCode(value);
  }

  return out;
}

function decodeProtectedText(raw: string, scriptBaseName: string): string {
  const marker = "SNAREENCv1|";
  const computerName = process.env.COMPUTERNAME ?? "";
  const userName = process.env.USERNAME ?? "";
  const baseSeed = `SNAREHOUND|${computerName}|${userName}`;

  const normalizedBase = scriptBaseName.replace(/\.[^.]+$/, "");
  const candidateKeys = [
    baseSeed,
    `${baseSeed}|${normalizedBase}.ahk`,
    `${baseSeed}|${normalizedBase}.exe`,
    `${baseSeed}|SnareHound.exe`,
    `${baseSeed}|snarehound_v1.ahk`,
    `${baseSeed}|snarehound_v1.exe`
  ];

  const encoded = raw.startsWith(marker) ? raw.slice(marker.length) : raw;

  for (const key of candidateKeys) {
    const decoded = decodeWithKey(encoded, key);
    if (decoded && isLikelyPlainText(decoded)) {
      return decoded;
    }
  }

  if (raw.startsWith(marker)) {
    return "";
  }

  return raw;
}

function commitEntry(entries: ShipLibraryEntry[], currentShip: string, signatureLines: string[], hasInitialSnapshot: boolean): void {
  if (!currentShip || signatureLines.length === 0) {
    return;
  }

  const displayShip = hasInitialSnapshot && !currentShip.includes("(S) ") ? `(S) ${currentShip}` : currentShip;
  entries.push({
    shipName: displayShip,
    signatureLines: [...signatureLines]
  });
}

function parseShipLibrary(content: string): ShipLibraryEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: ShipLibraryEntry[] = [];

  let currentShip = "";
  let currentSignature: string[] = [];
  let hasInitialSnapshot = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      commitEntry(entries, currentShip, currentSignature, hasInitialSnapshot);
      currentShip = "";
      currentSignature = [];
      hasInitialSnapshot = false;
      continue;
    }

    if (line.startsWith("<")) {
      currentSignature.push(line);
      if (/initial\s+snapshot/i.test(line)) {
        hasInitialSnapshot = true;
      }
      continue;
    }

    commitEntry(entries, currentShip, currentSignature, hasInitialSnapshot);
    currentShip = line;
    currentSignature = [];
    hasInitialSnapshot = false;
  }

  commitEntry(entries, currentShip, currentSignature, hasInitialSnapshot);
  return entries;
}

export type ShipLibrary = {
  mappings: Map<string, string>;
  sourcePath: string;
  entryCount: number;
  decodeMode: "plain" | "protected";
};

export async function loadShipLibrary(sourcePath: string, scriptBaseName = "snarehound_v1"): Promise<ShipLibrary> {
  const absolute = path.resolve(sourcePath);
  const raw = await fs.readFile(absolute, "utf8");

  const decoded = decodeProtectedText(raw, scriptBaseName);
  const decodeMode: "plain" | "protected" = decoded !== raw ? "protected" : "plain";

  const entries = parseShipLibrary(decoded);
  const mappings = new Map<string, string>();

  for (const entry of entries) {
    const normalized = normalizeSignature(entry.signatureLines);
    if (normalized) {
      mappings.set(normalized, entry.shipName);
    }
  }

  return {
    mappings,
    sourcePath: absolute,
    entryCount: entries.length,
    decodeMode
  };
}

export async function loadCorrections(correctionsPath: string): Promise<Map<string, string>> {
  const absolute = path.resolve(correctionsPath);

  try {
    const raw = await fs.readFile(absolute, "utf8");
    const map = new Map<string, string>();

    let inCorrectionsSection = false;
    for (const lineRaw of raw.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line || line.startsWith(";")) {
        continue;
      }

      if (line.startsWith("[") && line.endsWith("]")) {
        inCorrectionsSection = line.toLowerCase() === "[corrections]";
        continue;
      }

      if (!inCorrectionsSection) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const signature = line.slice(0, separatorIndex).trim();
      const shipName = line.slice(separatorIndex + 1).trim();

      if (signature && shipName) {
        map.set(signature.replace(/\\n/g, "\n"), shipName);
      }
    }

    return map;
  } catch {
    return new Map<string, string>();
  }
}

export function applyCorrections(baseMappings: Map<string, string>, corrections: Map<string, string>): Map<string, string> {
  const merged = new Map(baseMappings);
  for (const [signature, ship] of corrections) {
    merged.set(signature, ship);
  }
  return merged;
}
