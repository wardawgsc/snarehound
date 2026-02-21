import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { LegacyStyleLogTailer } from "./logTailer.js";
import { applyCorrections, loadCorrections, loadShipLibrary, type ShipLibrary } from "./shipLibrary.js";

const backendUrl = process.env.AGENT_BACKEND_URL ?? "http://localhost:4000";
const agentId = process.env.AGENT_ID ?? `${os.hostname()}-agent`;
const agentToken = process.env.AGENT_SHARED_TOKEN ?? "dev-agent-token";
const heartbeatMs = Number(process.env.AGENT_HEARTBEAT_MS ?? 15000);
const enableMockEvent = (process.env.AGENT_ENABLE_MOCK_EVENT ?? "true").toLowerCase() === "true";
const logFilePath = process.env.AGENT_LOG_FILE_PATH ?? "";
const pollMs = Number(process.env.AGENT_LOG_POLL_MS ?? 700);
const flushMs = Number(process.env.AGENT_SIGNATURE_FLUSH_MS ?? 1500);
const shipLibraryReloadMs = Number(process.env.AGENT_SHIP_LIBRARY_RELOAD_MS ?? 30000);
const triggerText = process.env.AGENT_TRIGGER_TEXT ?? "Failed to get starmap route data!";
const correctionsPath = process.env.AGENT_SHIP_CORRECTIONS_PATH ?? path.resolve(process.cwd(), "data", "ship_corrections.ini");
const scriptBaseName = process.env.AGENT_LEGACY_SCRIPT_BASE ?? "snarehound_v1";
const keywords = (process.env.AGENT_SHIP_KEYWORDS ?? "Fire Area|ItemNavigation|Failed to get starmap route data!")
	.split("|")
	.map((value) => value.trim())
	.filter((value) => value.length > 0);
const agentVersion = "0.1.0";

let activeShipMappings = new Map<string, string>();
let shipLibraryReloadInFlight = false;

type LibraryReport = {
	sourcePath: string;
	entryCount: number;
	mappingCount: number;
	decodeMode: "plain" | "protected";
	correctionCount: number;
	loadedAt: string;
	error?: string;
};

type AgentEvent = {
	type: "ship.detected" | "ship.resolution.miss" | "lookup.requested" | "lookup.pushed";
	timestamp: string;
	[key: string]: unknown;
};

async function post(path: string, body: unknown): Promise<void> {
	const response = await fetch(`${backendUrl}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-agent-token": agentToken
		},
		body: JSON.stringify(body)
	});

	if (!response.ok) {
		const payload = await response.text();
		throw new Error(`POST ${path} failed: ${response.status} ${payload}`);
	}
}

async function registerAgent(): Promise<void> {
	await post("/v1/agent/register", {
		agentId,
		version: agentVersion,
		platform: process.platform
	});

	console.log(`[agent] registered as ${agentId}`);
}

async function sendHeartbeat(status = "running"): Promise<void> {
	await post("/v1/agent/heartbeat", {
		agentId,
		status
	});
}

async function sendEvent(event: AgentEvent): Promise<void> {
	await post("/v1/agent/events", {
		agentId,
		event
	});
}

async function sendLibraryReport(report: LibraryReport): Promise<void> {
	await post("/v1/agent/library/report", {
		agentId,
		report
	});
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function resolveShipLibraryPath(): Promise<string | null> {
	const fromEnv = process.env.AGENT_SHIP_LIBRARY_PATH;
	if (fromEnv) {
		return path.resolve(fromEnv);
	}

	const candidates = [
		path.resolve(process.cwd(), "..", "shiptypes.txt"),
		path.resolve(process.cwd(), "..", "..", "shiptypes.txt"),
		path.resolve(process.cwd(), "..", "..", "..", "shiptypes.txt")
	];

	for (const candidate of candidates) {
		if (await fileExists(candidate)) {
			return candidate;
		}
	}

	return null;
}

async function initializeShipResolution(): Promise<void> {
	if (shipLibraryReloadInFlight) {
		return;
	}

	shipLibraryReloadInFlight = true;

	const sourcePath = await resolveShipLibraryPath();
	if (!sourcePath) {
		const error = "shiptypes.txt not found (set AGENT_SHIP_LIBRARY_PATH)";
		console.warn(`[agent] ${error}`);
		await sendLibraryReport({
			sourcePath: "",
			entryCount: 0,
			mappingCount: 0,
			decodeMode: "plain",
			correctionCount: 0,
			loadedAt: new Date().toISOString(),
			error
		});
		shipLibraryReloadInFlight = false;
		return;
	}

	try {
		const library: ShipLibrary = await loadShipLibrary(sourcePath, scriptBaseName);
		const corrections = await loadCorrections(correctionsPath);
		activeShipMappings = applyCorrections(library.mappings, corrections);

		await sendLibraryReport({
			sourcePath: library.sourcePath,
			entryCount: library.entryCount,
			mappingCount: activeShipMappings.size,
			decodeMode: library.decodeMode,
			correctionCount: corrections.size,
			loadedAt: new Date().toISOString()
		});

		console.log(
			`[agent] ship library loaded (entries=${library.entryCount}, mappings=${activeShipMappings.size}, decode=${library.decodeMode})`
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown ship library load error";
		console.error("[agent] failed to load ship library", error);
		await sendLibraryReport({
			sourcePath,
			entryCount: 0,
			mappingCount: 0,
			decodeMode: "plain",
			correctionCount: 0,
			loadedAt: new Date().toISOString(),
			error: message
		});
	} finally {
		shipLibraryReloadInFlight = false;
	}
}

async function sendMockShipDetectedEvent(): Promise<void> {
	await sendEvent({
		type: "ship.detected",
		timestamp: new Date().toISOString(),
		shipName: "Mock Cutlass Black",
		signature: [
			"<Mock Signature 1>",
			"<Mock Signature 2>"
		]
	});

	console.log("[agent] sent mock ship.detected event");
}

async function startLogPolling(): Promise<void> {
	if (!logFilePath) {
		console.log("[agent] AGENT_LOG_FILE_PATH not set; skipping real log tailing");
		return;
	}

	const tailer = new LegacyStyleLogTailer({
		filePath: logFilePath,
		triggerText,
		keywords,
		flushMs,
		onShipDetected: async (payload) => {
			const resolvedShipName = activeShipMappings.get(payload.normalizedSignature) ?? payload.shipName;
			const resolvedBy = activeShipMappings.has(payload.normalizedSignature) ? "library" : "fallback";

			await sendEvent({
				type: "ship.detected",
				timestamp: new Date().toISOString(),
				shipName: resolvedShipName,
				signature: payload.signature,
				normalizedSignature: payload.normalizedSignature,
				triggerLine: payload.triggerLine,
				resolvedBy,
				source: "legacy-tailer"
			});

			if (resolvedShipName === "UNKNOWN") {
				await sendEvent({
					type: "ship.resolution.miss",
					timestamp: new Date().toISOString(),
					normalizedSignature: payload.normalizedSignature,
					signature: payload.signature,
					triggerLine: payload.triggerLine,
					source: "legacy-tailer"
				});
			}

			console.log(`[agent] ship.detected emitted (lines=${payload.signature.length}, resolvedBy=${resolvedBy})`);
		}
	});

	setInterval(() => {
		void tailer.tick().catch((error) => {
			console.error("[agent] log tail tick failed", error);
		});
	}, pollMs);

	console.log(`[agent] log tailer active (file=${logFilePath}, pollMs=${pollMs}, flushMs=${flushMs})`);
}

async function start(): Promise<void> {
	console.log(`[agent] starting (backend=${backendUrl}, id=${agentId})`);

	await registerAgent();
	await sendHeartbeat("startup");
	await initializeShipResolution();

	if (enableMockEvent) {
		await sendMockShipDetectedEvent();
	}

	await startLogPolling();

	setInterval(() => {
		void initializeShipResolution().catch((error) => {
			console.error("[agent] periodic ship library reload failed", error);
		});
	}, shipLibraryReloadMs);

	setInterval(() => {
		void sendHeartbeat().catch((error) => {
			console.error("[agent] heartbeat failed", error);
		});
	}, heartbeatMs);
}

void start().catch((error) => {
	console.error("[agent] fatal startup error", error);
	process.exit(1);
});
