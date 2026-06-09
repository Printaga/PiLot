<script lang="ts">
	interface ActivityItem {
		text: string;
		type: "extension" | "tool" | "system";
		timestamp: number;
	}

	interface Props {
		cwd: string;
		gitBranch: string | null;
		sessionName: string | null;
		activities: Record<string, ActivityItem>;
	}

	let { cwd, gitBranch, sessionName, activities }: Props = $props();

	/** Build pwd line: cwd (branch) • sessionName */
	const pwdLine = $derived.by(() => {
		let pwd = cwd;
		if (gitBranch) {
			pwd = `${pwd} (${gitBranch})`;
		}
		if (sessionName) {
			pwd = `${pwd} \u2022 ${sessionName}`;
		}
		return pwd;
	});

	/** Get extension statuses sorted by key, joined with spaces */
	const extensionStatusLine = $derived.by(() => {
		const extEntries = Object.entries(activities)
			.filter(([, item]) => item.type === "extension")
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, item]) => sanitizeStatusText(item.text));
		return extEntries.join(" ");
	});

	/** Check if agent is currently streaming (for spinner) */
	let isStreaming = $state(false);

	$effect(() => {
		const vscode = (window as any).vscode;
		if (!vscode) return;

		function handleMessage(event: MessageEvent) {
			const { type } = event.data;
			if (type === "pi-event") {
				const evt = event.data.data;
				if (evt?.type === "stream_start") isStreaming = true;
				if (evt?.type === "stream_end" || evt?.type === "agent_end")
					isStreaming = false;
			}
		}

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	});

	/** Braille spinner frames */
	const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let spinnerIndex = $state(0);

	$effect(() => {
		if (!isStreaming) return;
		const interval = setInterval(() => {
			spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
		}, 80);
		return () => clearInterval(interval);
	});

	const spinner = $derived(
		isStreaming ? spinnerFrames[spinnerIndex] : ""
	);

	/** Sanitize text for single-line display */
	function sanitizeStatusText(text: string): string {
		return text
			.replace(/[\r\n\t]/g, " ")
			.replace(/ +/g, " ")
			.trim();
	}
</script>

{#if pwdLine || extensionStatusLine}
	<div class="status-line">
		{#if pwdLine}
			<div class="status-line-pwd" title={cwd}>{pwdLine}</div>
		{/if}
		{#if extensionStatusLine}
			<div class="status-line-extensions">
				{#if spinner}<span class="status-spinner">{spinner}</span>{/if}
				<span>{extensionStatusLine}</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.status-line {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 2px var(--space-4);
		min-height: 20px;
		background: var(--color-surface-2);
		border-top: 1px solid oklch(from var(--color-border) l c h / 0.15);
		flex-shrink: 0;
		overflow: hidden;
	}

	.status-line-pwd {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 500;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		opacity: 0.7;
	}

	.status-line-extensions {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 500;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.status-spinner {
		color: var(--color-primary);
		flex-shrink: 0;
		animation: spin-step 0.08s steps(1) infinite;
	}

	@keyframes spin-step {
		0% { opacity: 1; }
		50% { opacity: 0.4; }
		100% { opacity: 1; }
	}
</style>
