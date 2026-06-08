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
	"tiny": {
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
	"base": {
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

const VOICE_MODEL_BASE_URL =
	"https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

// ── Helper path resolution ──────────────────────────────────────────────

function getVoiceHelperPath(extensionUri?: vscode.Uri): string {
	const platform = process.platform;
	const arch = process.arch;
	const extensionPath = extensionUri?.fsPath ||
		vscode.extensions.getExtension("PrintagaPublishingLLC.pilots-studio")?.extensionPath ||
		"";
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
): Promise<string> {
	const modelDef = VOICE_MODELS[modelName];
	if (!modelDef) {
		throw new Error(`Unknown voice model: ${modelName}`);
	}

	const cacheDir = getVoiceModelCacheDir(agentDir);
	await fs.promises.mkdir(cacheDir, { recursive: true });
	const destPath = path.join(cacheDir, modelDef.cacheFilename);

	// Check if already cached — verify size roughly matches expected
	if (fs.existsSync(destPath)) {
		const stats = await fs.promises.stat(destPath);
		const sizeMb = stats.size / (1024 * 1024);
		if (
			Math.abs(sizeMb - modelDef.expectedSizeMb) <=
			modelDef.expectedSizeMb * 0.2
		) {
			console.log(
				`[PI Voice] Model already cached: ${destPath} (${sizeMb.toFixed(1)} MB)`,
			);
			onPhase?.("ready", "Voice model ready.");
			return destPath;
		}
		console.log(
			`[PI Voice] Cached model size mismatch, re-downloading: ${sizeMb.toFixed(1)}MB vs expected ${modelDef.expectedSizeMb}MB`,
		);
	}

	const url = `${VOICE_MODEL_BASE_URL}/${modelDef.remoteFilename}`;
	onPhase?.(
		"downloading",
		`Downloading ${modelDef.label} (~${modelDef.expectedSizeMb} MB)...`,
	);

	const https = await import("node:https");
	const { createWriteStream } = await import("node:fs");

	const tmpPath = destPath + ".tmp";

	await new Promise<void>((resolve, reject) => {
		const doRequest = (requestUrl: string) => {
			https
				.get(requestUrl, (response) => {
					// Handle redirects
					if (
						response.statusCode &&
						response.statusCode >= 300 &&
						response.statusCode < 400 &&
						response.headers.location
					) {
						doRequest(response.headers.location);
						return;
					}

					if (response.statusCode !== 200) {
						reject(
							new Error(
								`Failed to download voice model: HTTP ${response.statusCode}`,
							),
						);
						return;
					}

					const totalSize = parseInt(
						response.headers["content-length"] || "0",
						10,
					);
					let downloaded = 0;

					const fileStream = createWriteStream(tmpPath);

					const onAbort = () => {
						response.destroy();
						fileStream.close();
						reject(new Error("Download cancelled"));
					};
					if (signal?.aborted) {
						onAbort();
						return;
					}
					signal?.addEventListener("abort", onAbort, { once: true });

					response.on("data", (chunk: Buffer) => {
						downloaded += chunk.length;
						onProgress?.(downloaded, totalSize);
					});

					response.on("error", reject);
					fileStream.on("error", reject);
					fileStream.on("finish", () => {
						signal?.removeEventListener("abort", onAbort);
						resolve();
					});
					response.pipe(fileStream);
				})
				.on("error", reject);
		};
		doRequest(url);
	});

	await fs.promises.rename(tmpPath, destPath);
	console.log(`[PI Voice] Model downloaded to: ${destPath}`);
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
	private voiceModel: string = "tiny-q5_1";
	private voiceLineBuffer = "";
	private deps: VoiceManagerDeps;

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
		} else {
			await this.startVoiceCapture();
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
				fs.accessSync(helperPath, fs.constants.X_OK);
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
				fs.existsSync(modelPath) &&
				fs.statSync(modelPath).size > 1024 * 1024;

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
					modelPath = await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: `Downloading ${modelDef.label}`,
							cancellable: true,
						},
						async (progress, token) => {
							const aborter = new AbortController();
							token.onCancellationRequested(() => aborter.abort());

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
											increment: pct,
										});
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
							);
						},
					);
				} catch (err) {
					if (err instanceof Error && err.message === "Download cancelled") return;
					vscode.window.showErrorMessage(
						`Failed to download voice model: ${err instanceof Error ? err.message : String(err)}`,
					);
					return;
				}
			}

			this.sendVoiceMessage("voice-status", {
				status: "preparing",
				message: "Loading voice model...",
			});

			// Initialize voice helper with full model path
			this.voiceHelperProcess = spawn(helperPath, ["--model", modelPath]);

			this.voiceHelperProcess.stdout?.on("data", (chunk) => {
				const text = chunk.toString();
				this.deps.logDebug("[PI Voice stdout]", text.substring(0, 200));
				this.handleVoiceHelperOutput(text, modelPath);
			});

			this.voiceHelperProcess.stderr?.on("data", (chunk) => {
				const text = chunk.toString().trim();
				if (!text) return;

				const lines = text.split("\n");
				for (const line of lines) {
					const trimmed = line.trim();
					if (trimmed.startsWith("{")) {
						try {
							const msg: VoiceHelperMessage = JSON.parse(trimmed);
							if (msg.type === "transcription" && msg.text) {
								this.deps.logDebug(
									"[PI Voice] Transcription (from stderr):",
									msg.text.substring(0, 100),
								);
								this.sendVoiceMessage("voice-transcription", { text: msg.text });
								continue;
							}
						} catch {
							// Not JSON, treat as log line
						}
					}
					this.deps.logDebug("[PI Voice Helper]", trimmed);
				}
			});

			this.voiceHelperProcess.on("error", (err) => {
				this.deps.logError("[PI Voice Helper error]:", err);
				const errMsg = err.message || String(err);
				if (process.platform === "linux" && (errMsg.includes("error while loading shared libraries") || errMsg.includes("cannot open shared object file"))) {
					vscode.window.showErrorMessage(
						"Voice capture failed: Missing ALSA library. Install `libasound2` (Debian/Ubuntu) or `alsa-lib` (Fedora/RHEL) for microphone support.",
					);
				} else {
					this.sendVoiceMessage("voice-listening-changed", { listening: false });
				}
				this.isListening = false;
			});

			this.voiceHelperProcess.on("close", (code) => {
				this.deps.logDebug("[PI Voice Helper] Process exited with code:", code);
				if (this.isListening) {
					this.sendVoiceMessage("voice-listening-changed", { listening: false });
					this.isListening = false;
				}
			});
		} catch (error) {
			this.deps.logError("[PI] Voice capture start failed:", error);
			vscode.window.showErrorMessage(
				`Failed to start voice capture: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private stopVoiceCapture() {
		if (this.voiceHelperProcess && this.isListening) {
			this.voiceHelperProcess.stdin?.write(JSON.stringify({ type: "stop" }) + "\n");
			this.voiceHelperProcess.stdin?.end();
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
			try {
				const msg: VoiceHelperMessage = JSON.parse(trimmed);

				switch (msg.type) {
					case "ready":
						this.voiceHelperProcess?.stdin?.write(
							JSON.stringify({ type: "prepare", modelPath }) + "\n",
						);
						break;

					case "prepared":
						this.voiceHelperProcess?.stdin?.write(
							JSON.stringify({ type: "start" }) + "\n",
						);
						break;

					case "started":
						this.isListening = true;
						this.sendVoiceMessage("voice-listening-changed", { listening: true });
						this.sendVoiceMessage("voice-status", {
							status: "listening",
							message: "Listening...",
						});
						break;

					case "permission":
						break;

					case "transcript":
						if (msg.text) {
							this.deps.logDebug(
								"[PI Voice] Transcription:",
								msg.text.substring(0, 100),
							);
							this.sendVoiceMessage("voice-transcription", { text: msg.text });
						} else {
							this.deps.logDebug(
								"[PI Voice] Transcription message received but text field is empty or undefined. Full message: " + JSON.stringify(msg),
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
			} catch {
				this.deps.logDebug(
					"[PI] Failed to parse voice helper line:",
					trimmed,
				);
			}
		}
	}

	dispose() {
		if (this.voiceHelperProcess) {
			this.voiceHelperProcess.stdin?.end();
			this.voiceHelperProcess.kill();
			this.voiceHelperProcess = undefined;
		}
		this.isListening = false;
		this.voiceLineBuffer = "";
	}
}
