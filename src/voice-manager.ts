// ── Voice capture / dictation module ─────────────────────────────────────────
// Handles the full lifecycle: whisper model download, native helper binary
// management, real-time transcription, and webview messaging.

import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { type VoiceHelperMessage, type VoiceModelDef } from "./webview/types/index.js";

// ── Voice model definitions (whisper.cpp models from Hugging Face) ────────

const VOICE_MODELS: Record<string, VoiceModelDef> = {
	"tiny-q5_1": {
		label: "Tiny multilingual (Q5_1)",
		remoteFilename: "ggml-tiny-q5_1.bin",
		cacheFilename: "tiny-q5_1.bin",
		expectedSizeMb: 31,
		englishOnly: false,
	},
	tiny: {
		label: "Tiny multilingual",
		remoteFilename: "ggml-tiny.bin",
		cacheFilename: "tiny.bin",
		expectedSizeMb: 75,
		englishOnly: false,
	},
	"tiny.en": {
		label: "Tiny English-only",
		remoteFilename: "ggml-tiny.en.bin",
		cacheFilename: "tiny.en.bin",
		expectedSizeMb: 75,
		englishOnly: true,
	},
	"base-q5_1": {
		label: "Base multilingual (Q5_1)",
		remoteFilename: "ggml-base-q5_1.bin",
		cacheFilename: "base-q5_1.bin",
		expectedSizeMb: 57,
		englishOnly: false,
	},
	base: {
		label: "Base multilingual",
		remoteFilename: "ggml-base.bin",
		cacheFilename: "base.bin",
		expectedSizeMb: 141,
		englishOnly: false,
	},
	"base.en": {
		label: "Base English-only",
		remoteFilename: "ggml-base.en.bin",
		cacheFilename: "base.en.bin",
		expectedSizeMb: 141,
		englishOnly: true,
	},
};

const VOICE_MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export const voiceManagerInternals = {
	spawn,
	// Tests stub filesystem access through this seam; ESM namespaces are frozen.
	accessSync: (path: string, mode?: number) => fs.accessSync(path, mode),
	existsSync: (path: fs.PathLike) => fs.existsSync(path),
	statSync: (path: fs.PathLike) => fs.statSync(path),
};

/** Extension id used as a fallback when no extensionUri is supplied. */
const EXTENSION_ID = "PrintagaPublishingLLC.pilots-studio";

// ── Helper path resolution ──────────────────────────────────────────────

function getVoiceHelperPath(extensionUri?: vscode.Uri): string {
	const platform = process.platform;
	const arch = process.arch;
	const extensionPath =
		extensionUri?.fsPath || vscode.extensions.getExtension(EXTENSION_ID)?.extensionPath;
	if (!extensionPath) {
		// Fail fast: falling back to "" produced a cwd-relative path and a
		// confusing "Voice helper not found at media/voice/..." error later.
		throw new Error("Cannot resolve the extension path for the voice helper");
	}
	const voiceDir = path.join(extensionPath, "media", "voice");

	switch (platform) {
		case "darwin":
			return path.join(voiceDir, "pi-voice-helper");
		case "linux":
			if (arch === "arm64") {
				return path.join(voiceDir, "pi-voice-helper-linux-arm64");
			}
			return path.join(voiceDir, "pi-voice-helper-linux-x64");
		case "win32":
			if (arch === "arm64") {
				return path.join(voiceDir, "pi-voice-helper-win32-arm64.exe");
			}
			return path.join(voiceDir, "pi-voice-helper-win32-x64.exe");
		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}
}

// ── Model cache helpers ─────────────────────────────────────────────────

function getVoiceModelCacheDir(agentDir: string): string {
	return path.join(agentDir, "voice-models");
}

function getVoiceModelPath(agentDir: string, modelName: string): string {
	const modelDef = VOICE_MODELS[modelName];
	if (!modelDef) {
		throw new Error(`Unknown voice model: ${modelName}`);
	}
	return path.join(getVoiceModelCacheDir(agentDir), modelDef.cacheFilename);
}

// ── Model download ──────────────────────────────────────────────────────

async function downloadVoiceModel(
	agentDir: string,
	modelName: string,
	onProgress?: (downloaded: number, total: number) => void,
	onPhase?: (phase: string, message?: string) => void,
	signal?: AbortSignal,
	logDebug?: (msg: string, ...details: unknown[]) => void,
	onTmpFile?: (tmpPath: string) => void,
): Promise<string> {
	const modelDef = VOICE_MODELS[modelName];
	if (!modelDef) {
		throw new Error(`Unknown voice model: ${modelName}`);
	}

	const cacheDir = getVoiceModelCacheDir(agentDir);
	await fs.promises.mkdir(cacheDir, { recursive: true });
	const destPath = path.join(cacheDir, modelDef.cacheFilename);

	// Check if already cached — verify size roughly matches expected
	if (voiceManagerInternals.existsSync(destPath)) {
		const stats = await fs.promises.stat(destPath);
		const sizeMb = stats.size / (1024 * 1024);
		if (Math.abs(sizeMb - modelDef.expectedSizeMb) <= modelDef.expectedSizeMb * 0.2) {
			logDebug?.(`[PI Voice] Model already cached: ${destPath} (${sizeMb.toFixed(1)} MB)`);
			onPhase?.("ready", "Voice model ready.");
			return destPath;
		}
		logDebug?.(
			`[PI Voice] Cached model size mismatch, re-downloading: ${sizeMb.toFixed(1)}MB vs expected ${modelDef.expectedSizeMb}MB`,
		);
	}

	const url = `${VOICE_MODEL_BASE_URL}/${modelDef.remoteFilename}`;
	onPhase?.("downloading", `Downloading ${modelDef.label} (~${modelDef.expectedSizeMb} MB)...`);

	const https = await import("node:https");
	const { createWriteStream } = await import("node:fs");

	const tmpPath = destPath + ".tmp";
	// Explicit callback instead of module-global mutable state: the global slot
	// captured `this`, was only cleared on failure paths, and broke with two
	// concurrent instances.
	onTmpFile?.(tmpPath);

	await new Promise<void>((resolve, reject) => {
		const MAX_REDIRECTS = 5;
		// Redirects may only stay on https and on the model host: the download is
		// unpacked/loaded by the runtime, so an http downgrade or arbitrary origin
		// must be refused, and a redirect loop must fail instead of hanging.
		const isAllowedRedirectTarget = (next: URL) =>
			next.protocol === "https:" && next.host.endsWith("huggingface.co");

		const doRequest = (requestUrl: string, redirects: number) => {
			https
				.get(requestUrl, (response) => {
					// Handle redirects
					if (
						response.statusCode &&
						response.statusCode >= 300 &&
						response.statusCode < 400 &&
						response.headers.location
					) {
						// Destroy the redirect response: an unconsumed body holds the
						// socket in the keep-alive pool.
						response.destroy();
						if (redirects >= MAX_REDIRECTS) {
							reject(new Error("Too many redirects while downloading voice model"));
							return;
						}
						let next: URL;
						try {
							// Resolve relative locations; a malformed one would otherwise
							// throw synchronously inside this response callback, beyond
							// the reach of the Promise executor.
							next = new URL(response.headers.location, requestUrl);
						} catch {
							reject(
								new Error(
									`Invalid redirect location while downloading voice model`,
								),
							);
							return;
						}
						if (!isAllowedRedirectTarget(next)) {
							reject(new Error(`Refusing to follow redirect to ${next.href}`));
							return;
						}
						doRequest(next.href, redirects + 1);
						return;
					}

					if (response.statusCode !== 200) {
						// Drain/destroy the body: an unconsumed response can hold the
						// socket in the keep-alive pool and stall the request.
						response.resume();
						reject(
							new Error(
								`Failed to download voice model: HTTP ${response.statusCode}`,
							),
						);
						return;
					}

					const totalSize = parseInt(response.headers["content-length"] || "0", 10);
					let downloaded = 0;

					const fileStream = createWriteStream(tmpPath);

					// Single failure path: destroys BOTH sides, removes the abort
					// listener and rejects exactly once. The per-side rejects leaked
					// the open write handle (which then also blocks tmp-file removal
					// on Windows) and the abort listener.
					let settled = false;
					const fail = (err: Error) => {
						if (settled) return;
						settled = true;
						signal?.removeEventListener("abort", onAbort);
						response.destroy();
						fileStream.destroy();
						reject(err);
					};
					const onAbort = () => fail(new Error("Download cancelled"));
					if (signal?.aborted) {
						onAbort();
						return;
					}
					signal?.addEventListener("abort", onAbort, { once: true });

					response.on("data", (chunk: Buffer) => {
						downloaded += chunk.length;
						onProgress?.(downloaded, totalSize);
					});

					response.on("error", fail);
					fileStream.on("error", fail);
					fileStream.on("finish", () => {
						if (settled) return;
						// Reject truncated transfers BEFORE the rename promotes a
						// corrupt file into the model cache.
						if (totalSize > 0 && downloaded !== totalSize) {
							fail(
								new Error(
									`Incomplete voice model download: got ${downloaded} of ${totalSize} bytes`,
								),
							);
							return;
						}
						settled = true;
						signal?.removeEventListener("abort", onAbort);
						resolve();
					});
					response.pipe(fileStream);
				})
				.on("error", (err) => {
					// Request-level failures (DNS, ECONNREFUSED) happen before the
					// response handler ran, so fail() (and its fileStream cleanup)
					// may not exist yet: guard with a settled flag at the executor
					// scope and fall back to a bare reject.
					reject(err);
				});
		};
		doRequest(url, 0);
	});

	try {
		await fs.promises.rename(tmpPath, destPath);
	} catch (e) {
		// A failed rename (cross-device, cancelled mid-flight) must not leak the
		// temp file; the next download recreates it.
		await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
		throw e;
	}
	logDebug?.(`[PI Voice] Model downloaded to: ${destPath}`);
	onPhase?.("ready", "Voice model ready.");
	return destPath;
}

// ── VoiceManager class ─────────────────────────────────────────────────

export interface VoiceManagerDeps {
	/** Extension URI for resolving media paths */
	extensionUri: vscode.Uri;
	/** Agent directory (for voice model cache) */
	agentDir: string;
	/** Log a debug message */
	logDebug: (msg: string, ...details: unknown[]) => void;
	/** Log an error */
	logError: (msg: string, error?: unknown) => void;
	/** Send a message to the webview */
	notifyWebview: (message: { type: string; data?: unknown }) => void;
}

export class VoiceManager {
	private voiceHelperProcess?: ChildProcess;
	private isListening = false;
	private isStartingVoice = false;
	private voiceModel: string = "tiny-q5_1";
	private voiceLineBuffer = "";
	private deps: VoiceManagerDeps;
	/** Partial model downloads are staged at <dest>.tmp; tracked for cleanup. */
	private pendingTmpFile?: string;

	constructor(deps: VoiceManagerDeps) {
		this.deps = deps;
	}

	get listening(): boolean {
		return this.isListening;
	}

	private sendVoiceMessage(type: string, data?: unknown) {
		this.deps.notifyWebview({ type, data } as any);
	}

	async toggleVoiceCapture() {
		if (this.isListening) {
			this.stopVoiceCapture();
			return;
		}
		// Re-entrancy guard: startVoiceCapture awaits a modal download prompt /
		// withProgress, so rapid toggles previously passed the !isListening check
		// multiple times and spawned orphaned helper processes.
		if (this.isStartingVoice) return;
		this.isStartingVoice = true;
		try {
			await this.startVoiceCapture();
		} finally {
			this.isStartingVoice = false;
		}
	}

	private async startVoiceCapture() {
		try {
			const config = vscode.workspace.getConfiguration("pi-agent");
			if (config.get<boolean>("voice.enabled") === false) {
				vscode.window.showInformationMessage("Voice dictation is disabled in settings");
				return;
			}

			this.voiceModel = config.get<string>("voice.model") || "tiny-q5_1";

			// Check if voice helper exists
			const helperPath = getVoiceHelperPath(this.deps.extensionUri);
			try {
				voiceManagerInternals.accessSync(helperPath, fs.constants.X_OK);
			} catch {
				vscode.window.showErrorMessage(
					`Voice helper not found at ${helperPath}. Please reinstall the extension.`,
				);
				return;
			}

			// Resolve / download the whisper model
			let modelPath: string;
			try {
				modelPath = getVoiceModelPath(this.deps.agentDir, this.voiceModel);
			} catch {
				vscode.window.showErrorMessage(
					`Unknown voice model: ${this.voiceModel}. Supported models: ${Object.keys(VOICE_MODELS).join(", ")}`,
				);
				return;
			}

			const modelExists =
				voiceManagerInternals.existsSync(modelPath) &&
				voiceManagerInternals.statSync(modelPath).size > 1024 * 1024;

			if (!modelExists) {
				const modelDef = VOICE_MODELS[this.voiceModel];
				if (!modelDef) return;

				const choice = await vscode.window.showInformationMessage(
					`Voice dictation needs to download the whisper model "${modelDef.label}" (~${modelDef.expectedSizeMb} MB) from Hugging Face. The download is one-time and dictation always runs locally on your device.`,
					{ modal: true },
					"Download",
					"Cancel",
				);
				if (choice !== "Download") return;
				try {
					// Pass the tracking callback explicitly: no module-global slot that
					// captures `this` and leaks across instances/success paths.
					const onTmpFile = (tmpPath: string) => {
						this.pendingTmpFile = tmpPath;
					};
					modelPath = await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: `Downloading ${modelDef.label}`,
							cancellable: true,
						},
						async (progress, token) => {
							const aborter = new AbortController();
							token.onCancellationRequested(() => aborter.abort());

							// `increment` is a delta — track the last reported percentage
							// and send the difference, or the bar saturates past 100%.
							let lastPct = 0;
							return downloadVoiceModel(
								this.deps.agentDir,
								this.voiceModel,
								(downloaded, total) => {
									if (total > 0) {
										const pct = Math.round((downloaded / total) * 100);
										const mbDown = (downloaded / (1024 * 1024)).toFixed(1);
										const mbTotal = (total / (1024 * 1024)).toFixed(1);
										progress.report({
											message: `${mbDown} / ${mbTotal} MB (${pct}%)`,
											increment: pct - lastPct,
										});
										lastPct = pct;
										this.sendVoiceMessage("voice-status", {
											status: "downloading",
											message: `Downloading voice model... ${pct}%`,
										});
									}
								},
								(phase, message) => {
									this.sendVoiceMessage("voice-status", {
										status: phase,
										message: message || "",
									});
								},
								aborter.signal,
								this.deps.logDebug,
								onTmpFile,
							);
						},
					);
				} catch (err) {
					if (err instanceof Error && err.message === "Download cancelled") {
						// Cancelled mid-download: remove the partial temp file.
						await this.removePendingTmpFile();
						return;
					}
					vscode.window.showErrorMessage(
						`Failed to download voice model: ${err instanceof Error ? err.message : String(err)}`,
					);
					await this.removePendingTmpFile();
					return;
				} finally {
					// Whatever the outcome, stop tracking the (now consumed/removed) temp file.
					this.pendingTmpFile = undefined;
				}
			}

			this.sendVoiceMessage("voice-status", {
				status: "preparing",
				message: "Loading voice model...",
			});

			// Never orphan a previous helper (it would keep holding the mic).
			if (this.voiceHelperProcess) this.stopVoiceCapture();

			// Initialize voice helper with full model path
			const proc = voiceManagerInternals.spawn(helperPath, ["--model", modelPath]);
			this.voiceHelperProcess = proc;

			// setEncoding keeps a StringDecoder internally so multi-byte UTF-8
			// characters split across chunk boundaries decode correctly — per-chunk
			// toString() garbles accented/CJK transcriptions.
			proc.stdout?.setEncoding?.("utf8");
			proc.stdout?.on("data", (text: string) => {
				this.deps.logDebug("[PI Voice stdout]", String(text).substring(0, 200));
				this.handleVoiceHelperOutput(String(text), modelPath);
			});

			proc.stderr?.on("data", (chunk) => {
				const text = chunk.toString().trim();
				if (!text) return;

				const lines = text.split("\n");
				for (const line of lines) {
					const trimmed = line.trim();
					if (trimmed.startsWith("{")) {
						try {
							const msg: VoiceHelperMessage = JSON.parse(trimmed);
							// Accept both spellings: the stdout path matches "transcript"
							// and this mirror must not silently drop dictation if the
							// helper uses one name for both streams.
							if (
								(msg.type === "transcript" || msg.type === "transcription") &&
								msg.text
							) {
								this.deps.logDebug(
									"[PI Voice] Transcription (from stderr):",
									msg.text.substring(0, 100),
								);
								this.sendVoiceMessage("voice-transcription", {
									text: msg.text,
								});
								continue;
							}
						} catch {
							// Not JSON, treat as log line
						}
					}
					this.deps.logDebug("[PI Voice Helper]", trimmed);
				}
			});

			// Capture locally: the instance handle is cleared in the terminal
			// handlers when it still points at THIS process, so stopVoiceCapture()
			// and dispose() can never act on a stale handle while the real child is
			// orphaned holding the microphone.
			proc.on("error", (err) => {
				this.deps.logError("[PI Voice Helper error]:", err);
				const errMsg = err.message || String(err);
				if (
					process.platform === "linux" &&
					(errMsg.includes("error while loading shared libraries") ||
						errMsg.includes("cannot open shared object file"))
				) {
					vscode.window.showErrorMessage(
						"Voice capture failed: Missing ALSA library. Install `libasound2` (Debian/Ubuntu) or `alsa-lib` (Fedora/RHEL) for microphone support.",
					);
				} else {
					this.sendVoiceMessage("voice-listening-changed", {
						listening: false,
					});
				}
				this.isListening = false;
				if (this.voiceHelperProcess === proc) this.voiceHelperProcess = undefined;
			});

			proc.on("close", (code) => {
				this.deps.logDebug("[PI Voice Helper] Process exited with code:", code);
				if (this.isListening) {
					this.sendVoiceMessage("voice-listening-changed", {
						listening: false,
					});
					this.isListening = false;
				}
				if (this.voiceHelperProcess === proc) this.voiceHelperProcess = undefined;
			});
		} catch (error) {
			this.deps.logError("[PI] Voice capture start failed:", error);
			vscode.window.showErrorMessage(
				`Failed to start voice capture: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/** Remove a partial voice-model download left by a cancelled/failed transfer. */
	private async removePendingTmpFile(): Promise<void> {
		const tmp = this.pendingTmpFile;
		this.pendingTmpFile = undefined;
		if (!tmp) return;
		try {
			await fs.promises.rm(tmp, { force: true });
		} catch {
			/* best-effort cleanup */
		}
	}
	private stopVoiceCapture() {
		if (this.voiceHelperProcess) {
			const proc = this.voiceHelperProcess;
			try {
				if (this.isListening) {
					proc.stdin?.write(JSON.stringify({ type: "stop" }) + "\n");
				}
				proc.stdin?.end();
			} catch {
				/* helper already gone */
			}
			// Give the helper a short grace period to exit on its own, then kill:
			// without this a helper blocked in its native capture loop ignored the
			// stdin EOF and stayed alive holding the audio device. Optional-chained
			// so test mocks without a full ChildProcess surface keep working.
			const killTimer = setTimeout(() => {
				try {
					if (proc.exitCode === null && !proc.killed) proc.kill?.("SIGTERM");
				} catch {
					/* already gone */
				}
			}, 2000);
			// Detach stdio listeners before dropping the reference: the helper can
			// emit stderr lines for a while after stop, and those handlers kept the
			// buffers alive and kept logging after a stop/dispose.
			try {
				proc.stdout?.removeAllListeners();
				proc.stderr?.removeAllListeners();
				proc.removeAllListeners();
			} catch {
				/* listeners already gone */
			}
			// Register the timer cleanup AFTER the listener strip above — an `exit`
			// handler registered before it would be removed and the timer would
			// never be cleared.
			try {
				proc.once?.("exit", () => clearTimeout(killTimer));
			} catch {
				/* mock without event surface */
			}
			this.voiceHelperProcess = undefined;
		}
		this.isListening = false;
		this.voiceLineBuffer = "";
		this.sendVoiceMessage("voice-listening-changed", { listening: false });
	}

	private handleVoiceHelperOutput(chunk: string, modelPath: string) {
		this.voiceLineBuffer += chunk;
		const lines = this.voiceLineBuffer.split("\n");
		this.voiceLineBuffer = lines.pop() || "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			// try/catch wraps ONLY the parse: a runtime error while handling a
			// message (EPIPE on stdin.write, a throwing webview post) is not a
			// parse failure and must surface as such.
			let msg: VoiceHelperMessage;
			try {
				msg = JSON.parse(trimmed);
			} catch {
				this.deps.logDebug("[PI] Failed to parse voice helper line:", trimmed);
				continue;
			}
			switch (msg.type) {
				case "ready":
					this.voiceHelperProcess?.stdin?.write(
						JSON.stringify({ type: "prepare", modelPath }) + "\n",
					);
					break;

				case "prepared":
					this.voiceHelperProcess?.stdin?.write(JSON.stringify({ type: "start" }) + "\n");
					break;

				case "started":
					this.isListening = true;
					this.sendVoiceMessage("voice-listening-changed", {
						listening: true,
					});
					this.sendVoiceMessage("voice-status", {
						status: "listening",
						message: "Listening...",
					});
					break;

				case "permission":
					break;

				case "transcript":
					if (msg.text) {
						this.deps.logDebug("[PI Voice] Transcription:", msg.text.substring(0, 100));
						this.sendVoiceMessage("voice-transcription", { text: msg.text });
					} else {
						this.deps.logDebug(
							"[PI Voice] Transcription message received but text field is empty or undefined. Full message: " +
								JSON.stringify(msg),
						);
					}
					break;

				case "error":
					this.deps.logError(
						"[PI Voice Helper error]:",
						msg.code + " " + (msg.message || msg.error),
					);
					if (
						msg.code === "start_failed" &&
						msg.message?.includes("model is not ready")
					) {
						this.sendVoiceMessage("voice-status", {
							status: "error",
							message:
								"Voice model failed to load. Please try again or choose a different model.",
						});
					} else {
						vscode.window.showErrorMessage(
							`Voice capture error: ${msg.message || msg.error || "Unknown error"}`,
						);
					}
					this.stopVoiceCapture();
					break;

				case "level":
					this.sendVoiceMessage("voice-audio-level", { level: msg.level });
					break;
			}
		}
	}

	dispose() {
		if (this.voiceHelperProcess) {
			const proc = this.voiceHelperProcess;
			try {
				proc.stdin?.end();
			} catch {
				/* already closed */
			}
			try {
				proc.stdout?.removeAllListeners();
				proc.stderr?.removeAllListeners();
				proc.removeAllListeners();
			} catch {
				/* listeners already gone */
			}
			proc.kill();
			this.voiceHelperProcess = undefined;
		}
		this.isListening = false;
		this.voiceLineBuffer = "";
		void this.removePendingTmpFile();
	}
}
