<script lang="ts">
	import ChatPanel from './components/ChatPanel.svelte';
	import SessionTree from './components/SessionTree.svelte';
	import ModelSelector from './components/ModelSelector.svelte';
	import SettingsPanel from './components/SettingsPanel.svelte';
	import ToolsPanel from './components/ToolsPanel.svelte';
	import PiPackagesPanel from './components/PiPackagesPanel.svelte';
	import ProviderSettings from './components/ProviderSettings.svelte';
	import Header from './components/Header.svelte';
	import Toast from './components/Toast.svelte';
	import OnboardingTour from './components/OnboardingTour.svelte';
	import ExportDialog from './components/ExportDialog.svelte';
	import PromptTemplates from './components/PromptTemplates.svelte';

	interface ImageContent {
		type: 'image';
		data: string;
		mimeType: string;
		name?: string;
	}

	interface ToolCallResult {
		content?: string;
		details?: any;
		isError?: boolean;
	}

	interface Message {
		role: 'user' | 'assistant' | 'system';
		content: string;
		thinking?: string;
		images?: ImageContent[];
		timestamp: number;
		isStreaming?: boolean;
		toolCalls?: ToolCallMessage[];
	}

	interface ToolCallMessage {
		toolCallId: string;
		toolName: string;
		args: Record<string, unknown>;
		result?: ToolCallResult;
		isError?: boolean;
		status: 'pending' | 'streaming' | 'complete';
	}

	interface Model {
		id: string;
		provider: string;
		name: string;
	}

	let activeTab = $state<'chat' | 'sessions' | 'models' | 'providers' | 'tools' | 'settings' | 'packages'>('chat');
	let messages = $state<Message[]>([]);
	let isStreaming = $state(false);
	let draftInputText = $state('');
	let models = $state<Model[]>([]);
	let isInitialized = $state(false);
	let currentModel = $state<string | null>(null);
	let favoriteModels = $state<string[]>([]);
	let thinkingLevel = $state<string>('medium');
	let autoContext = $state(true);
	let contextPercent = $state<number | null>(null);
	let contextTokens = $state<number | null>(null);
	let contextWindow = $state(0);
	let autoCompaction = $state(true);
	let sessionResources = $state<any>(null);
	let tokensIn = $state(0);
	let tokensOut = $state(0);
	let tokensTotal = $state(0);
	let tokensCacheRead = $state(0);
	let providers = $state<Array<{provider: string; name: string; configured: boolean; status: string}>>([]);
	let isListening = $state(false);
	let activeToolCalls: Map<string, { toolName: string; args: any }> = $state(new Map());

	// Update notification state
	let hasUpdates = $state(false);
	let piUpdateAvailable = $state<string | null>(null);
	let packageUpdateCount = $state(0);

	// Feature states: onboarding, export, prompt templates
	let showOnboarding = $state(false);
	let showExport = $state(false);
	let showPromptTemplates = $state(false);
	let previousResourceCount = $state<Record<string, number>>({});

	// Toast helper - uses global from Toast component
	function showToast(opts: { type: 'info' | 'success' | 'warning' | 'error'; title: string; message?: string; persistent?: boolean; duration?: number }) {
		const t = (window as any).__toast;
		if (t?.showToast) t.showToast(opts);
	}

	// Poll context usage and token stats every 5s once initialized
	$effect(() => {
		if (!isInitialized) return;
		const vscode = (window as any).vscode;
		if (!vscode?.postMessage) return;

		function poll() {
			vscode.postMessage({ type: 'getContextUsage' });
			vscode.postMessage({ type: 'getSessionStats' });
		}
		poll();
		const id = setInterval(poll, 5000);
		return () => clearInterval(id);
	});

	$effect(() => {
		const acquireVsCodeApi = typeof window !== 'undefined' ? (window as any).acquireVsCodeApi : null;
		if (typeof acquireVsCodeApi === 'function') {
			const vscode = acquireVsCodeApi();
			if (typeof vscode?.postMessage !== 'function') return;
			(window as any).vscode = vscode;

			window.addEventListener('message', handleVSCodeMessage);
			vscode.postMessage({ type: 'ready' });

			return () => {
				window.removeEventListener('message', handleVSCodeMessage);
			};
		}
	});

	$effect(() => {
		if (activeTab !== 'models' && activeTab !== 'providers') return;
		if (typeof (window as any).vscode?.postMessage === 'function') {
			(window as any).vscode.postMessage({ type: 'getModels' });
			(window as any).vscode.postMessage({ type: 'getProviderAuth' });
		}
	});

	// Global keyboard shortcut handler (Features 5, 3)
	$effect(() => {
		function handleKeydown(e: KeyboardEvent) {
			const target = e.target as HTMLElement;
			const isInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.contentEditable === 'true';
			
			// Always allow Escape to close dialogs, even from inputs
			if (e.key === 'Escape') {
				showExport = false;
				showPromptTemplates = false;
				showOnboarding = false;
				return;
			}

			// Don't handle other shortcuts when typing in input
			if (isInput) return;

			switch (e.key) {
				case '1': activeTab = 'chat'; e.preventDefault(); break;
				case '2': activeTab = 'sessions'; e.preventDefault(); break;
				case '3': activeTab = 'models'; e.preventDefault(); break;
				case '4': activeTab = 'providers'; e.preventDefault(); break;
				case '5': activeTab = 'tools'; e.preventDefault(); break;
				case '6': activeTab = 'packages'; e.preventDefault(); break;
				case '7': activeTab = 'settings'; e.preventDefault(); break;
			}
		}

		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});

	function handleVSCodeMessage(event: MessageEvent) {
		const { type, data } = event.data;

		switch (type) {
			case 'ready':
				handleReady(data);
				break;
			case 'pi-event':
				handlePiEvent(data);
				break;
			case 'session-updated':
				activeTab = 'chat';
				break;
			case 'session-history':
				messages = data.messages || [];
				activeTab = 'chat';
				break;
			case 'models-updated':
				models = data.models;
				break;

			case 'model-changed':
				currentModel = data.modelId;
				break;

			case 'thinking-level-changed':
				thinkingLevel = data.level;
				break;

			case 'context-usage':
				if (data) {
					contextPercent = data.percent;
					contextTokens = data.tokens;
					contextWindow = data.contextWindow;
					if (data.autoCompactionEnabled !== undefined) {
						autoCompaction = data.autoCompactionEnabled;
					}
				}
				break;

			case 'session-stats':
				if (data?.tokens) {
					tokensIn = data.tokens.input || 0;
					tokensOut = data.tokens.output || 0;
					tokensTotal = data.tokens.total || 0;
					tokensCacheRead = data.tokens.cacheRead || 0;
				}
				break;

			case 'session-resources':
				// Track previous resource counts for change detection (Feature 9)
				if (sessionResources) {
					previousResourceCount = {
						files: (sessionResources as any).contextFileCount ?? 0,
						skills: (sessionResources as any).skillCount ?? 0,
						extensions: (sessionResources as any).extensionCount ?? 0,
						prompts: (sessionResources as any).promptCount ?? 0,
						packages: (sessionResources as any).packageCount ?? 0,
					};
				}
				sessionResources = data;
				console.log('[PI Webview] session-resources received:', JSON.stringify(data));
				break;

			case 'auto-compaction-changed':
				autoCompaction = data.enabled;
				break;

			case 'provider-auth':
				providers = data || [];
				break;

			case 'switchTab':
				if (data?.tab) {
					activeTab = data.tab;
				}
				break;

			case 'pickModel':
			case 'show-login':
				break;

			case 'new-session':
				handleNewSession();
				break;

			case 'error':
				isStreaming = false;
				showToast({ type: 'error', title: 'Error', message: data.message || 'An error occurred', persistent: true });
				messages = [
					...messages,
					{
						role: 'system',
						content: `❌ Error: ${data.message || 'An error occurred'}`,
						timestamp: data.timestamp || Date.now()
					}
				];
				break;

			case 'updates-available':
				hasUpdates = true;
				piUpdateAvailable = data?.piVersion ?? null;
				packageUpdateCount = data?.packageCount ?? 0;
				if (data?.piVersion) {
					showToast({ type: 'info', title: `PI CLI v${data.piVersion} available`, message: 'Click the update button in the header to update.' });
				}
				break;

			case 'updates-cleared':
				hasUpdates = false;
				piUpdateAvailable = null;
				packageUpdateCount = 0;
				break;

			case 'system-message':
				messages = [
					...messages,
					{
						role: 'system',
						content: data.message || '',
						timestamp: Date.now()
					}
				];
				break;

			case 'voice-listening-changed':
				isListening = data?.listening ?? false;
				break;

			case 'voice-transcription':
				if (data?.text) {
					window.dispatchEvent(new CustomEvent('voice-transcription', { detail: data.text }));
				}
				break;
		}
	}

	function handleReady(data: any) {
		isInitialized = true;
		if (data?.models) models = data.models;
		if (data?.currentModel) currentModel = data.currentModel;
		if (data?.favoriteModels) favoriteModels = data.favoriteModels;
		if (data?.thinkingLevel) thinkingLevel = data.thinkingLevel;

		// Show onboarding on first launch (Feature 3)
		try {
			const hasSeenTour = localStorage.getItem('pilots-seen-tour');
			if (!hasSeenTour) {
				showOnboarding = true;
			}
		} catch {}
	}

	function handlePiEvent(event: any) {
		switch (event.type) {
			case 'agent_start':
				isStreaming = true;
				break;

			case 'message_start':
				{
					const msgRole = event.message?.role || 'assistant';
					if (messages.length > 0) {
						const lastMsg = messages[messages.length - 1];
						if (lastMsg.isStreaming) {
							messages = [
								...messages.slice(0, -1),
								{ ...lastMsg, isStreaming: false }
							];
						}
					}
					if (msgRole === 'assistant' || !msgRole || msgRole === 'system') {
						messages = [
							...messages,
							{
								role: msgRole || 'assistant',
								content: '',
								timestamp: Date.now(),
								isStreaming: true
							}
						];
					}
				}
				break;

			case 'message_end':
				if (messages.length > 0) {
					const lastMsg = messages[messages.length - 1];
					if (lastMsg.isStreaming) {
						messages = [
							...messages.slice(0, -1),
							{ ...lastMsg, isStreaming: false }
						];
					}
				}
				break;

			case 'turn_start':
				break;

			case 'turn_end':
				break;

			case 'message_update':
				{
					const hasStreaming = messages.length > 0 && messages[messages.length - 1].isStreaming;
					if (!hasStreaming && isStreaming) {
						messages = [
							...messages,
							{
								role: 'assistant',
								content: '',
								timestamp: Date.now(),
								isStreaming: true
							}
						];
					}
				}
				if (event.assistantMessageEvent?.type === 'thinking_delta' && messages.length > 0) {
					const lastMsg = messages[messages.length - 1];
					if (lastMsg.isStreaming) {
						messages = [
							...messages.slice(0, -1),
							{
								...lastMsg,
								thinking: (lastMsg.thinking || '') + event.assistantMessageEvent.delta,
								content: lastMsg.content || ''
							}
						];
					}
					break;
				}
				if (event.assistantMessageEvent?.type === 'text_delta' && messages.length > 0) {
					const lastMsg = messages[messages.length - 1];
					if (lastMsg.isStreaming) {
						messages = [
							...messages.slice(0, -1),
							{
								...lastMsg,
								content: lastMsg.content + event.assistantMessageEvent.delta
							}
						];
					}
				}
				break;

			case 'agent_end':
				isStreaming = false;
				if (messages.length > 0) {
					const lastMsg = messages[messages.length - 1];
					if (lastMsg.isStreaming) {
						messages = [
							...messages.slice(0, -1),
							{
								...lastMsg,
								isStreaming: false
							}
						];
					}
				}
				break;

			case 'compaction_start':
				showToast({ type: 'info', title: 'Compacting context...', message: event.reason || 'auto' });
				break;

			case 'compaction_end':
				if (event.errorMessage) {
					showToast({ type: 'warning', title: 'Compaction error', message: event.errorMessage, persistent: true });
				} else if (event.result) {
					showToast({ type: 'success', title: 'Context compacted', message: event.result.tokensSaved ? `Saved ${event.result.tokensSaved} tokens` : undefined });
				}
				if (typeof (window as any).vscode?.postMessage === 'function') {
					(window as any).vscode.postMessage({ type: 'getContextUsage' });
				}
				break;

			case 'auto_retry_start':
				showToast({ type: 'warning', title: `Retry ${event.attempt}/${event.maxAttempts}`, message: event.errorMessage });
				break;

			case 'auto_retry_end':
				if (!event.success && event.finalError) {
					showToast({ type: 'error', title: 'All retries exhausted', message: event.finalError, persistent: true });
				}
				break;

			case 'tool_execution_start':
				activeToolCalls.set(event.toolCallId, {
					toolName: event.toolName,
					args: event.args || {}
				});
				messages = [
					...messages,
					{
						role: 'system',
						content: '',
						timestamp: Date.now(),
						toolCalls: [{
							toolCallId: event.toolCallId,
							toolName: event.toolName,
							args: event.args || {},
							status: 'pending'
						}]
					}
				];
				break;

			case 'tool_execution_update':
				activeToolCalls.set(event.toolCallId, {
					toolName: event.toolName,
					args: event.args || {}
				});
				const updateMsgIdx = messages.findLastIndex((m) => 
					m.role === 'system' && m.toolCalls?.some(tc => tc.toolCallId === event.toolCallId)
				);
				if (updateMsgIdx >= 0) {
					messages = [
						...messages.slice(0, updateMsgIdx),
						{
							...messages[updateMsgIdx],
							toolCalls: messages[updateMsgIdx].toolCalls!.map(tc =>
								tc.toolCallId === event.toolCallId
								? { ...tc, status: 'streaming' }
								: tc
							)
						},
						...messages.slice(updateMsgIdx + 1)
					];
				}
				break;

			case 'tool_execution_end':
				const toolResult = activeToolCalls.get(event.toolCallId);
				if (toolResult || messages.length > 0) {
					activeToolCalls.delete(event.toolCallId);
					const lastSystemIdx = messages.findLastIndex((m) => 
						m.role === 'system' && m.toolCalls?.some(tc => tc.toolCallId === event.toolCallId)
					);
					if (lastSystemIdx >= 0) {
						messages = [
							...messages.slice(0, lastSystemIdx),
							{
								...messages[lastSystemIdx],
								toolCalls: messages[lastSystemIdx].toolCalls!.map(tc =>
									tc.toolCallId === event.toolCallId
									? { ...tc, status: 'complete', result: {
										content: event.result?.content?.map((c: any) => c.text || '').join('\n') || '',
										details: event.result?.details,
										isError: event.isError
									}, isError: event.isError }
									: tc
								)
							},
							...messages.slice(lastSystemIdx + 1)
						];
					}
				}
				break;

			case 'model_select':
				showToast({ type: 'info', title: 'Model changed', message: event.model?.name || event.model?.id || 'unknown' });
				break;

			case 'thinking_level_select':
				showToast({ type: 'info', title: `Thinking level: ${event.level}` });
				break;

			case 'queue_update':
				if (event.steering?.length > 0) {
					for (const text of event.steering) {
						messages = [
							...messages,
							{
								role: 'system',
								content: `📥 Queued (interrupt): ${text.slice(0, 100)}`,
								timestamp: Date.now()
							}
						];
					}
				}
				if (event.followUp?.length > 0) {
					for (const text of event.followUp) {
						messages = [
							...messages,
							{
								role: 'system',
								content: `📨 Queued (after response): ${text.slice(0, 100)}`,
								timestamp: Date.now()
							}
						];
					}
				}
				break;

			case 'session_info_changed':
				break;

			case 'session_tree':
				messages = [
					...messages,
					{
						role: 'system',
						content: `🌳 Session tree navigated${event.label ? `: ${event.label}` : ''}`,
						timestamp: Date.now()
					}
				];
				break;
		}
	}

	function sendMessage(msg: any) {
		if (typeof (window as any).vscode?.postMessage === 'function') {
			(window as any).vscode.postMessage(msg);
		}
	}

	async function handleSendPrompt(text: string, images?: ImageContent[]) {
		const newMsg: Message = {
			role: 'user',
			content: text || '',
			images: images && images.length > 0 ? images : undefined,
			timestamp: Date.now()
		};
		messages = [...messages, newMsg];
		sendMessage({ type: 'prompt', data: { text, images } });
	}

	function handleEditMessage(index: number, newText: string) {
		messages = messages.map((msg, i) => {
			if (i === index && msg.role === 'user') {
				return { ...msg, content: newText, timestamp: Date.now() };
			}
			return msg;
		});
	}

	function handleExportDone() {
		showToast({ type: 'success', title: 'Export initiated', message: 'Check the messages for export status.' });
		showExport = false;
	}

	function handleInsertPromptTemplate(text: string) {
		draftInputText = text;
		showPromptTemplates = false;
		activeTab = 'chat';
	}

	async function handleNewSession() {
		messages = [];
		contextPercent = null;
		contextTokens = null;
		contextWindow = 0;
		sendMessage({ type: 'newSession' });
	}

	function getModelDisplay(modelId: string | null): string {
		if (!modelId) return 'No model';
		const m = models.find(m => m.id === modelId);
		return m ? m.name : modelId.split('/').slice(1).join('/') || modelId;
	}

	async function handleSwitchModel(modelId: string) {
		currentModel = modelId;
		sendMessage({ type: 'switchModel', data: { modelId } });
	}

	async function handleToggleFavorite(modelId: string) {
		const isFav = favoriteModels.includes(modelId);
		sendMessage({ type: 'toggleFavorite', data: { modelId, isFavorite: !isFav } });
		if (isFav) {
			favoriteModels = favoriteModels.filter(m => m !== modelId);
		} else {
			favoriteModels = [...favoriteModels, modelId];
		}
	}

	function handleSelectFavorite(modelId: string) {
		handleSwitchModel(modelId);
	}

	async function handleSetThinkingLevel(level: string) {
		thinkingLevel = level;
		sendMessage({ type: 'setThinkingLevel', data: { level } });
	}

	async function handleAbort() {
		sendMessage({ type: 'abort' });
		isStreaming = false;
	}

	function handleCompact() {
		sendMessage({ type: 'compact' });
	}

	function handleToggleVoice() {
		sendMessage({ type: 'toggle-voice-capture' });
	}

	async function handleRenameSession() {
		sendMessage({ type: 'showRenameSessionDialog' });
	}

	// Listen for show-tour event from SettingsPanel
	$effect(() => {
		function handleShowTour() { showOnboarding = true; }
		window.addEventListener('show-tour', handleShowTour);
		return () => window.removeEventListener('show-tour', handleShowTour);
	});

	function completeOnboarding() {
		showOnboarding = false;
		try {
			localStorage.setItem('pilots-seen-tour', 'true');
		} catch {}
		showToast({ type: 'success', title: 'Tour complete!', message: 'Press 1-7 to switch tabs, use / for commands.' });
	}
</script>

<div class="app">
	<Header
		{currentModel}
		modelName={getModelDisplay(currentModel)}
		providerName={currentModel?.split('/')[0] || ''}
		{thinkingLevel}
		onNewSession={handleNewSession}
		{favoriteModels}
		{models}
		onSelectFavorite={handleSelectFavorite}
		onThinkingLevelChange={handleSetThinkingLevel}
		onRenameSession={handleRenameSession}
		onSwitchToModels={() => activeTab = 'models'}
		onRunUpdate={() => sendMessage({ type: 'checkForUpdates' })}
		onShowTour={() => (showOnboarding = true)}
		{hasUpdates}
		{piUpdateAvailable}
		{packageUpdateCount}
	/>

	<div class="main">
		<nav class="sidebar">
			<div class="nav-group">
				<button onclick={() => (activeTab = 'chat')} class:active={activeTab === 'chat'} title="Conversation (1)">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
					</svg>
				</button>

				<button onclick={() => (activeTab = 'sessions')} class:active={activeTab === 'sessions'} title="History (2)">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
				</button>

				<button onclick={() => (activeTab = 'models')} class:active={activeTab === 'models'} title="Models (3)">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1m-1.636 6.364l-.707-.707M12 21v-1m-6.364-1.636l.707-.707M3 12h1m1.636-6.364l.707.707M12 8a4 4 0 110 8 4 4 0 010-8z" />
					</svg>
				</button>

				<button onclick={() => (activeTab = 'providers')} class:active={activeTab === 'providers'} title="Provider Settings (4)">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M12 15v3M12 6v3M6 9h12M8 12a4 4 0 108 0 4 4 0 00-8 0z" />
					</svg>
				</button>

				<button onclick={() => (activeTab = 'tools')} class:active={activeTab === 'tools'} title="Capabilities (5)">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
					</svg>
				</button>

				<button onclick={() => (activeTab = 'packages')} class:active={activeTab === 'packages'} title="Packages (6)">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M21 16.5c0 .552-.448 1-1 1H4c-.552 0-1-.448-1-1V8.5c0-.552.448-1 1-1h16c.552 0 1 .448 1 1v8zM21 8.5V6c0-.552-.448-1-1-1H4c-.552 0-1 .448-1 1v2.5M4 12h16" />
					</svg>
				</button>
			</div>

			<div class="nav-footer">
				<button onclick={() => (activeTab = 'settings')} class:active={activeTab === 'settings'} title="Preferences (7)">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
						<circle cx="12" cy="12" r="3" />
					</svg>
				</button>
			</div>
		</nav>

		<main class="content">
			{#if activeTab === 'chat'}
				<ChatPanel 
					{messages} 
					{isStreaming} 
					onSend={handleSendPrompt} 
					onNewSession={handleNewSession} 
					onAbort={handleAbort} 
					{sessionResources} 
					{isListening} 
					onToggleVoice={handleToggleVoice} 
					bind:inputText={draftInputText} 
					{tokensIn} 
					{tokensOut} 
					{tokensTotal} 
					{tokensCacheRead}
					{contextPercent}
					{contextTokens}
					{contextWindow}
					{autoCompaction}
					onCompact={handleCompact}
					onEditMessage={handleEditMessage}
					onShowExport={() => (showExport = true)}
					onShowPromptTemplates={() => (showPromptTemplates = true)}
					previousResourceCount={previousResourceCount}
				/>
			{:else if activeTab === 'sessions'}
				<SessionTree />
			{:else if activeTab === 'models'}
				<ModelSelector {models} {currentModel} {favoriteModels} {providers} onSelect={handleSwitchModel} onToggleFavorite={handleToggleFavorite} />
			{:else if activeTab === 'providers'}
				<ProviderSettings {providers} />
			{:else if activeTab === 'tools'}
				<ToolsPanel />
			{:else if activeTab === 'packages'}
				<PiPackagesPanel />
			{:else}
				<SettingsPanel
					{autoContext}
					{thinkingLevel}
					onAutoContextChange={(value) => (autoContext = value)}
					onThinkingLevelChange={handleSetThinkingLevel}
				/>
			{/if}
		</main>
	</div>
</div>

<Toast />

{#if showOnboarding}
	<OnboardingTour
		onComplete={completeOnboarding}
		onDismiss={completeOnboarding}
	/>
{/if}

{#if showExport}
	<ExportDialog onClose={() => (showExport = false)} />
{/if}

{#if showPromptTemplates}
	<PromptTemplates
		onSelectTemplate={handleInsertPromptTemplate}
		onClose={() => (showPromptTemplates = false)}
	/>
{/if}

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: var(--color-bg);
		color: var(--color-text);
	}

	.main {
		display: flex;
		flex: 1;
		overflow: hidden;
		position: relative;
	}

	.sidebar {
		width: 52px;
		background: oklch(from var(--color-surface) l c h / 0.3);
		backdrop-filter: blur(20px);
		border-right: 1px solid var(--glass-border);
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding: var(--space-4) 0;
		z-index: 10;
		box-shadow: 1px 0 10px oklch(0% 0 0 / 0.1);
	}

	.nav-group, .nav-footer {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
	}

	.sidebar button {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-lg);
		color: var(--color-text-muted);
		transition: all var(--transition-interactive);
		position: relative;
	}

	.sidebar button:hover {
		background: var(--surface-tint);
		color: var(--color-text);
		transform: scale(1.05);
	}

	.sidebar button.active {
		background: var(--accent-glow);
		color: var(--color-primary);
		box-shadow: inset 0 0 0 1px var(--color-primary);
	}

	.sidebar button.active::after {
		content: '';
		position: absolute;
		left: -8px;
		width: 4px;
		height: 20px;
		background: var(--color-primary);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		box-shadow: 0 0 12px var(--color-primary);
	}

	.content {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
		position: relative;
	}
</style>
