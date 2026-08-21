<script lang="ts">
	import { onMount } from 'svelte';

	interface ProviderAuth {
		provider: string;
		name: string;
		configured: boolean;
		status: string;
		custom: boolean;
		credentialType?: "oauth" | "api_key" | null;
		/** Provider offers an interactive OAuth login flow (PI CLI /login parity). */
		oauthLogin?: boolean;
		/** Stored models.json config (custom providers) for re-editing. */
		baseUrl?: string;
		api?: string;
		models?: Array<{ id: string; name?: string }>;
	}

	interface LoginPromptState {
		promptId: string;
		type: 'text' | 'secret' | 'select' | 'manual_code';
		message: string;
		placeholder?: string;
		options?: Array<{ id: string; label: string; description?: string }>;
	}

	interface LoginState {
		message: string;
		instructions?: string;
		authUrl?: string;
		userCode?: string;
		prompt: LoginPromptState | null;
	}

	interface Props {
		providers: ProviderAuth[];
	}

	let { providers = [] }: Props = $props();

	let editingProvider = $state<string | null>(null);
	let apiKeyInput = $state('');
	let showApiKey = $state(false);
	// provider -> last live auth-check result
	let authCheckResults = $state<Record<string, { configured: boolean; credentialType: "oauth" | "api_key" | null }>>(
		{}
	);
	// provider -> check in flight
	let checkingProvider = $state<Record<string, boolean>>({});

	let showAddForm = $state(false);
	let editingProviderId = $state<string | null>(null);
	let newProviderId = $state('');
	let newProviderName = $state('');
	let newProviderBaseUrl = $state('');
	let newProviderApiKey = $state('');
	let newProviderApi = $state('openai-completions');
	let newProviderModels = $state('');
	let showNewApiKey = $state(false);
	let addError = $state<string | null>(null);
	// While an addProvider request is in flight, its correlation id lets us react
	// only to THIS request's success/error replies, not unrelated host messages.
	let pendingAddId = $state<string | null>(null);
	let pendingRequestId = $state<string | null>(null);
	// Model discovery from the provider's own `/models` endpoint.
	let fetchingModels = $state(false);
	let fetchError = $state<string | null>(null);
	let pendingFetchId = $state<string | null>(null);

	const isEditingProvider = $derived(editingProviderId !== null);

	// ── OAuth login state (mirrors the PI CLI's /login dialog) ────────────────
	let loginStates = $state<Record<string, LoginState>>({});
	let loginResults = $state<
		Record<string, { success: boolean; message?: string; error?: string }>
	>({});
	let promptInputs = $state<Record<string, string>>({});

	const sortedProviders = $derived.by(() => {
		const configured = providers
			.filter((p) => p.configured)
			.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
		const unconfigured = providers
			.filter((p) => !p.configured)
			.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
		return { configured, unconfigured };
	});

	onMount(() => {
		sendMessage({ type: 'getProviderAuth' });
		// React only to replies correlated with our in-flight addProvider request:
		// a success `provider-added` ack resets the form; a correlated `error`
		// shows the server message and clears the pending state so the user retries.
		const onHostMessage = (event: MessageEvent) => {
			const msg = event.data;
			if (!msg || !msg.type || !pendingRequestId) return;
			if (
				msg.type === 'provider-added' &&
				msg.data?.requestId === pendingRequestId &&
				typeof msg.data?.provider === 'string'
			) {
				resetAddForm();
			} else if (
				msg.type === 'error' &&
				msg.data?.requestId === pendingRequestId
			) {
				addError =
					typeof msg.data?.message === 'string'
						? msg.data.message
						: 'Failed to add provider';
				pendingAddId = null;
				pendingRequestId = null;
			}
		};
		window.addEventListener('message', onHostMessage);

		const onCheckResult = (event: MessageEvent) => {
			const msg = event.data;
			if (!msg || !msg.type) return;
			// An uncorrelated error (e.g. checkProviderAuth threw in the host)
			// arrives as a bare `error` message with no requestId. Only treat it
			// as an auth-check failure when a check is actually in flight.
			if (msg.type === 'error' && !msg.data?.requestId) {
				const anyChecking = Object.values(checkingProvider).some(Boolean);
				if (!anyChecking) return;
				for (const id of Object.keys(checkingProvider)) {
					if (checkingProvider[id]) checkingProvider[id] = false;
				}
				const detail =
					typeof msg.data?.message === 'string'
						? msg.data.message
						: 'Auth check failed';
				const toast = (window as any).__toast;
				toast?.showToast({
					type: 'error',
					title: 'Auth check failed',
					message: detail,
				});
				return;
			}
			if (msg.type !== 'provider-auth-check-result') return;
			const d = msg.data;
			if (!d || typeof d.provider !== 'string') return;
			checkingProvider[d.provider] = false;
			if (typeof d.configured === 'boolean') {
				authCheckResults[d.provider] = {
					configured: d.configured,
					credentialType: d.credentialType ?? null,
				};
				const toast = (window as any).__toast;
				if (!toast?.showToast) return;
				if (d.configured) {
					const label =
						d.credentialType === 'oauth' ? 'OAuth active' : 'API key valid';
					toast.showToast({
						type: 'success',
						title: label,
						message: `Credentials verified for ${d.provider}`,
					});
				} else {
					toast.showToast({
						type: 'warning',
						title: 'No credentials',
						message: `No ${d.credentialType ?? 'configured'} credentials found for ${d.provider}`,
					});
				}
			}
		};
		window.addEventListener('message', onCheckResult);

		// Model discovery replies for the add/edit form: a correlated
		// `provider-models` fills the models textarea; a correlated `error`
		// surfaces the failure so the user can retry.
		const onFetchModelsMessage = (event: MessageEvent) => {
			const msg = event.data;
			if (!msg || !msg.type || !pendingFetchId) return;
			if (
				msg.type === 'provider-models' &&
				msg.data?.requestId === pendingFetchId &&
				Array.isArray(msg.data?.models)
			) {
				fetchingModels = false;
				fetchError = null;
				pendingFetchId = null;
				const lines = (msg.data.models as Array<{ id: string; name?: string }>).map(
					(m) => (m.name ? `${m.id}, ${m.name}` : m.id)
				);
				// Assign unconditionally so an empty provider response clears any
				// stale entries in the textarea.
				newProviderModels = lines.join('\n');				(window as any).__toast?.showToast({
					type: 'success',
					title: 'Models fetched',
					message: `Found ${lines.length} model${lines.length === 1 ? '' : 's'} from the provider`,
				});
			} else if (msg.type === 'error' && msg.data?.requestId === pendingFetchId) {
				fetchingModels = false;
				pendingFetchId = null;
				fetchError =
					typeof msg.data?.message === 'string'
						? msg.data.message
						: 'Failed to fetch models';
			}
		};
		window.addEventListener('message', onFetchModelsMessage);

		// OAuth login flow: progress events, prompts awaiting an answer, and the
		// final result all arrive as provider-login-* messages from the host.
		const onLoginMessage = (event: MessageEvent) => {
			const msg = event.data;
			if (!msg || !msg.type) return;
			const d = msg.data ?? {};
			if (msg.type === 'provider-login-event' && typeof d.provider === 'string') {
				const login = loginStates[d.provider] ?? { message: '', prompt: null };
				const ev = d.event ?? {};
				if (ev.type === 'auth_url') {
					login.authUrl = ev.url;
					login.instructions = ev.instructions ?? undefined;
					login.message = 'Authorization required — your browser opened automatically.';
				} else if (ev.type === 'device_code') {
					login.userCode = ev.userCode;
					login.authUrl = ev.verificationUri;
					login.message = 'Waiting for authentication…';
				} else if (ev.type === 'info' || ev.type === 'progress') {
					login.message = ev.message ?? '';
				}
				loginStates[d.provider] = login;
			} else if (
				msg.type === 'provider-login-prompt' &&
				typeof d.provider === 'string' &&
				d.prompt
			) {
				const login = loginStates[d.provider] ?? { message: '', prompt: null };
				login.prompt = d.prompt as LoginPromptState;
				loginStates[d.provider] = login;
				promptInputs[d.provider] = '';
			} else if (
				msg.type === 'provider-login-result' &&
				typeof d.provider === 'string'
			) {
				delete loginStates[d.provider];
				if (d.success !== true || d.message) {
					loginResults[d.provider] = {
						success: d.success === true,
						message: d.message,
						error: d.error
					};
				}
			}
		};
		window.addEventListener('message', onLoginMessage);
		return () => {
			window.removeEventListener('message', onHostMessage);
			window.removeEventListener('message', onCheckResult);
			window.removeEventListener('message', onLoginMessage);
			window.removeEventListener('message', onFetchModelsMessage);
		};
	});

	function checkAuth(provider: string) {
		checkingProvider[provider] = true;
		sendMessage({ type: 'checkProviderAuth', data: { provider } });
	}

	function sendMessage(msg: any) {
		if (typeof (window as any).vscode?.postMessage === 'function') {
			(window as any).vscode.postMessage(msg);
		}
	}

	function startEditApiKey(provider: string) {
		editingProvider = provider;
		apiKeyInput = '';
		showApiKey = false;
	}

	function cancelEditApiKey() {
		editingProvider = null;
		apiKeyInput = '';
	}

	async function saveApiKey() {
		if (!editingProvider || !apiKeyInput.trim()) return;
		sendMessage({
			type: 'setApiKey',
			data: { provider: editingProvider, apiKey: apiKeyInput.trim() }
		});
		providers = providers.map((p) =>
			p.provider === editingProvider ? { ...p, configured: true, status: 'stored' } : p
		);
		editingProvider = null;
		apiKeyInput = '';
	}

	function resetAddForm() {
		showAddForm = false;
		editingProviderId = null;
		newProviderId = '';
		newProviderName = '';
		newProviderBaseUrl = '';
		newProviderApiKey = '';
		newProviderApi = 'openai-completions';
		newProviderModels = '';
		showNewApiKey = false;
		addError = null;
		pendingAddId = null;
		pendingRequestId = null;
		fetchingModels = false;
		fetchError = null;
		pendingFetchId = null;
	}

	/** Open the form in add mode (fresh provider). */
	function openAddForm() {
		if (showAddForm && !isEditingProvider) {
			resetAddForm();
			return;
		}
		resetAddForm();
		showAddForm = true;
	}

	/**
	 * Open the form in edit mode for an existing custom provider, prefilled
	 * from its stored models.json config so name/baseUrl/api/models can all be
	 * changed (not just the API key). Submitting re-sends `addProvider`, which
	 * replaces the entry in place.
	 */
	function startEditProvider(p: {
		provider: string;
		name: string;
		baseUrl?: string;
		api?: string;
		models?: Array<{ id: string; name?: string }>;
	}) {
		resetAddForm();
		editingProviderId = p.provider;
		showAddForm = true;
		newProviderId = p.provider;
		newProviderName = p.name === p.provider ? '' : p.name;
		newProviderBaseUrl = p.baseUrl ?? '';
		newProviderApi = p.api ?? 'openai-completions';
		newProviderModels = (p.models ?? [])
			.map((m) => (m.name ? `${m.id}, ${m.name}` : m.id))
			.join('\n');
	}

	/** Query the provider's own `/models` endpoint to discover available models. */
	function fetchModels() {
		const baseUrl = newProviderBaseUrl.trim();
		if (!baseUrl) {
			fetchError = 'Enter a base URL first — models are fetched from the provider endpoint.';
			return;
		}
		if (fetchingModels) return;
		addError = null;
		fetchError = null;
		const requestId =
			typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `fetch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		pendingFetchId = requestId;
		fetchingModels = true;
		sendMessage({
			type: 'fetchProviderModels',
			id: requestId,
			data: {
				baseUrl,
				api: newProviderApi.trim() || undefined,
				apiKey: newProviderApiKey.trim() || undefined
			}
		});
	}

	function parseModelLines(text: string): { id: string; name?: string }[] {
		const out: { id: string; name?: string }[] = [];
		const seen = new Set<string>();
		for (const raw of text.split('\n')) {
			const line = raw.trim();
			if (!line) continue;
			// Support "id,name" (optional display name) or just "id".
			const comma = line.indexOf(',');
			const id = (comma >= 0 ? line.slice(0, comma) : line).trim();
			const name = comma >= 0 ? line.slice(comma + 1).trim() : '';
			if (!id || seen.has(id)) continue;
			seen.add(id);
			out.push(name ? { id, name } : { id });
		}
		return out;
	}

	async function addProvider() {
		addError = null;
		const providerId = newProviderId.trim();
		if (!providerId) {
			addError = 'Provider ID is required';
			return;
		}
		// Correlate this request so only its success/error replies affect the form.
		const requestId =
			typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `add-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const models = parseModelLines(newProviderModels);
		pendingAddId = providerId;
		pendingRequestId = requestId;
		sendMessage({
			type: 'addProvider',
			id: requestId,
			data: {
				provider: providerId,
				name: newProviderName.trim() || undefined,
				baseUrl: newProviderBaseUrl.trim() || undefined,
				apiKey: newProviderApiKey.trim() || undefined,
				api: newProviderApi.trim() || undefined,
				// In edit mode always send the list (even empty) so clearing the
				// textarea actually removes the stored models.
				models: isEditingProvider || models.length ? models : undefined
			}
		});
	}

	async function removeAuth(provider: string) {
		sendMessage({
			type: 'removeAuth',
			data: { provider }
		});
		providers = providers.map((p) =>
			p.provider === provider ? { ...p, configured: false, status: 'not_configured' } : p
		);
	}

	async function deleteProvider(provider: string) {
		// Do not mutate local state here: wait for the host's provider-auth refresh
		// (sent on success) to remove the provider. If the backend fails, the UI
		// stays consistent with the backend.
		sendMessage({
			type: 'removeProvider',
			data: { provider }
		});
	}

	// ── OAuth login actions ────────────────────────────────────────────────────

	function startLogin(provider: string) {
		delete loginResults[provider];
		loginStates[provider] = { message: 'Starting OAuth login…', prompt: null };
		sendMessage({ type: 'loginProvider', data: { provider } });
	}

	function cancelLogin(provider: string) {
		sendMessage({ type: 'cancelProviderLogin', data: { provider } });
	}

	function respondPrompt(provider: string, promptId: string, value: string) {
		const login = loginStates[provider];
		if (login) login.prompt = null;
		sendMessage({
			type: 'providerLoginPromptResponse',
			data: { provider, promptId, value }
		});
	}

	function cancelPrompt(provider: string, promptId: string) {
		const login = loginStates[provider];
		if (login) login.prompt = null;
		sendMessage({
			type: 'providerLoginPromptResponse',
			data: { provider, promptId, cancelled: true }
		});
	}

	function openLoginUrl(url: string) {
		sendMessage({ type: 'openLoginUrl', data: { url } });
	}

	async function copyText(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// Clipboard API unavailable in this webview; the text is also shown
			// inline for manual copy.
		}
	}

	function dismissLoginResult(provider: string) {
		delete loginResults[provider];
	}

	function statusLabel(status: string): string {
		switch (status) {
			case 'stored': return 'API Key saved';
			case 'environment': return 'Using env var';
			case 'runtime': return 'Runtime override';
			case 'oauth': case 'oauth_configured': return 'OAuth configured';
			case 'models_json_key': return 'Key from models.json';
			case 'models_json_command': return 'Command from models.json';
			case 'configured': return 'Configured';
			case 'not_configured': default: return 'Not configured';
		}
	}
</script>

<div class="provider-settings">
	<div class="header">
		<div class="header-row">
			<div class="header-text">
				<h3>Provider API Settings</h3>
				<span class="subtitle">Configure API keys for model providers</span>
			</div>
			<div class="header-actions">
				<button
					class="btn small icon-btn"
					onclick={() => sendMessage({ type: 'refreshModels' })}
					title="Refresh provider list"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
						<path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
					</svg>
				</button>
				<button
					class="btn small"
					onclick={openAddForm}
					title="Add a custom provider"
				>
					+ Add provider
				</button>
				<button
					class="btn small config-btn"
					onclick={() => sendMessage({ type: 'openConfigFile', data: { file: 'auth' } })}
					title="Open auth.json for manual editing"
				>
					Open auth.json
				</button>
			</div>
		</div>
	</div>

	{#each Object.entries(loginStates) as [providerId, login] (providerId)}
		{@const providerName = providers.find((p) => p.provider === providerId)?.name ?? providerId}
		<div class="auth-card login-card">
			<div class="login-body">
				<div class="login-title">
					<span class="auth-name">Sign in to {providerName}</span>
					<span class="login-badge">OAuth</span>
				</div>
				{#if login.message}
					<div class="login-message">{login.message}</div>
				{/if}
				{#if login.instructions}
					<div class="login-instructions">{login.instructions}</div>
				{/if}
				{#if login.userCode}
					<div class="login-device-code">
						<span class="code">{login.userCode}</span>
						<button class="btn small" onclick={() => copyText(login.userCode ?? '')}>Copy code</button>
					</div>
				{/if}
				{#if login.authUrl}
					<div class="login-url">
						<span class="url">{login.authUrl}</span>
						<button class="btn small" onclick={() => openLoginUrl(login.authUrl ?? '')}>Open</button>
					</div>
				{/if}
				{#if login.prompt}
					<div class="login-prompt">
						<div class="prompt-message">{login.prompt.message}</div>
						{#if login.prompt.type === 'select'}
							<div class="prompt-options">
								{#each login.prompt.options ?? [] as opt (opt.id)}
									<button
										class="btn small"
										onclick={() => respondPrompt(providerId, login.prompt?.promptId ?? '', opt.id)}
									>
										{opt.label}{opt.description ? ` — ${opt.description}` : ''}
									</button>
								{/each}
							</div>
						{:else}
							<div class="input-group">
								<input
									type={login.prompt.type === 'secret' ? 'password' : 'text'}
									bind:value={promptInputs[providerId]}
									placeholder={login.prompt.placeholder ?? ''}
									onkeydown={(e) => {
										if (e.key === 'Enter') {
											respondPrompt(providerId, login.prompt?.promptId ?? '', promptInputs[providerId] ?? '');
										}
										}}
								/>
							</div>
							<div class="prompt-actions">
								<button
									class="btn primary small"
									onclick={() => respondPrompt(providerId, login.prompt?.promptId ?? '', promptInputs[providerId] ?? '')}
								>Submit</button
								>
								<button
									class="btn small"
									onclick={() => cancelPrompt(providerId, login.prompt?.promptId ?? '')}
								>Cancel</button
								>
							</div>
						{/if}
					</div>
				{/if}
				<div class="login-actions">
					<button class="btn small" onclick={() => cancelLogin(providerId)}>Cancel login</button>
				</div>
			</div>
		</div>
	{/each}

	{#each Object.entries(loginResults) as [providerId, res] (providerId)}
		{@const providerName = providers.find((p) => p.provider === providerId)?.name ?? providerId}
		<div class="auth-card login-card" class:failed={!res.success}>
			<div class="login-body">
				<div class="login-title">
					<span class="auth-name">{res.success ? 'Logged in to' : 'Login failed:'} {providerName}</span>
					<button class="icon-btn" onclick={() => dismissLoginResult(providerId)} title="Dismiss">✕</button>
				</div>
				{#if res.error}
					<div class="login-message error">{res.error}</div>
				{:else if res.message}
					<div class="login-message">{res.message}</div>
				{/if}
			</div>
		</div>
	{/each}

	{#if showAddForm}
		<div class="auth-card add-provider-card">
			<div class="auth-main">
				<div class="auth-icon">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
					</svg>
				</div>
				<div class="auth-info">
					<span class="auth-name">{isEditingProvider ? 'Edit custom provider' : 'Add custom provider'}</span>
					<span class="auth-status">Persisted to models.json (visible in TUI too)</span>
				</div>
			</div>

			<div class="add-provider-form">
				<div class="form-row">
					<label>
						<span>Provider ID *</span>
						<input
							bind:value={newProviderId}
							placeholder="e.g. kilocode"
							disabled={isEditingProvider}
							title={isEditingProvider ? 'Provider ID cannot be changed' : ''}
							onkeydown={(e) => e.key === 'Enter' && addProvider()}
						/>
					</label>
					<label>
						<span>Display name</span>
						<input
							bind:value={newProviderName}
							placeholder="e.g. Kilo Code"
							onkeydown={(e) => e.key === 'Enter' && addProvider()}
						/>
					</label>
				</div>
				<div class="form-row">
					<label>
						<span>Base URL</span>
						<input
							bind:value={newProviderBaseUrl}
							placeholder="https://..."
							onkeydown={(e) => e.key === 'Enter' && addProvider()}
						/>
					</label>
					<label>
						<span>API (optional)</span>
						<input
							bind:value={newProviderApi}
							placeholder="openai"
							onkeydown={(e) => e.key === 'Enter' && addProvider()}
						/>
					</label>
				</div>
				<label class="api-key-label">
					<span>API key (optional)</span>
					<div class="input-group">
						<input
							type={showNewApiKey ? 'text' : 'password'}
							bind:value={newProviderApiKey}
							placeholder="Paste API key here..."
							onkeydown={(e) => e.key === 'Enter' && addProvider()}
						/>
						<button
							class="vis-toggle"
							onclick={() => (showNewApiKey = !showNewApiKey)}
						>
							{#if showNewApiKey}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
							{:else}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
							{/if}
						</button>
					</div>
				</label>

				<label class="models-label">
					<span>Models (optional, one per line)</span>
					<textarea
						bind:value={newProviderModels}
						rows="3"
						placeholder={"gpt-4o\nllama3.1:8b, Llama 3.1 8B"}
					></textarea>
					<span class="field-hint">Each line is a model ID, optionally "id, Display Name". Saved to models.json and shown in model selection.</span>
					<div class="fetch-models-row">
						<button
							class="btn small"
							onclick={fetchModels}
							disabled={fetchingModels || !newProviderBaseUrl.trim()}
							title="Query the provider's /models endpoint and fill the list above"
						>
							{fetchingModels ? 'Fetching…' : 'Fetch available models'}
						</button>
						{#if !newProviderBaseUrl.trim()}
							<span class="field-hint">Enter a base URL to fetch the model list.</span>
						{:else}
							<span class="field-hint">Queries the OpenAI-compatible `{newProviderBaseUrl.trim().replace(/\/+$/, '')}/models` endpoint. For authenticated providers, paste the API key above first — stored keys are never sent back to this form.</span>
						{/if}
					</div>
					{#if fetchError}
						<div class="form-error">{fetchError}</div>
					{/if}
				</label>

				{#if addError}
					<div class="form-error">{addError}</div>
				{/if}

				<div class="auth-actions">
					<button class="btn primary small" onclick={addProvider} disabled={pendingAddId !== null}>
						{isEditingProvider ? 'Save changes' : 'Add provider'}
					</button>
					<button class="btn small" onclick={resetAddForm}>Cancel</button>
				</div>
			</div>
		</div>
	{/if}

	<div class="auth-list">
		{#each sortedProviders.configured as p}
			<div class="auth-card" data-configured={p.configured}>
				<div class="auth-main">
					<div class="auth-icon">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
							<path d="M7 11V7a5 5 0 0110 0v4" />
						</svg>
					</div>
					<div class="auth-info">
						<span class="auth-name">{p.name}</span>
						{#if p.custom}
							<span class="custom-badge">Custom</span>
						{/if}
						{#if authCheckResults[p.provider]?.credentialType === 'oauth'}
							<span class="auth-badge oauth">OAuth</span>
						{:else if (authCheckResults[p.provider]?.credentialType ?? p.credentialType) === 'api_key'}
							<span class="auth-badge api-key">API key</span>
						{/if}
						<span class="auth-status" class:configured={p.configured}>
							{statusLabel(p.status)}
						</span>
					</div>
				</div>

				{#if editingProvider === p.provider}
					<div class="auth-editor">
						<div class="input-group">
							<input
								type={showApiKey ? 'text' : 'password'}
								bind:value={apiKeyInput}
								placeholder="Paste API Key here..."
								onkeydown={(e) => e.key === 'Enter' && saveApiKey()}
							/>
							<button
								class="vis-toggle"
								onclick={() => (showApiKey = !showApiKey)}
							>
								{#if showApiKey}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
								{:else}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
								{/if}
							</button>
						</div>
						<div class="auth-actions">
							<button class="btn primary small" onclick={saveApiKey}>Save</button>
							<button class="btn small" onclick={cancelEditApiKey}>Cancel</button>
						</div>
					</div>
				{:else}
					<div class="auth-actions">
						{#if p.custom}
							<button
								class="icon-btn danger"
								onclick={() => deleteProvider(p.provider)}
								title="Delete provider"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
									<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
								</svg>
							</button>
						{:else if p.configured}
							<button
								class="icon-btn danger"
								onclick={() => removeAuth(p.provider)}
								title="Remove credentials"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
									<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
								</svg>
							</button>
						{/if}
						<button
							class="btn small"
							class:primary={!p.configured}
							onclick={() =>
								p.custom ? startEditProvider(p) : startEditApiKey(p.provider)}
						>
							{p.configured ? 'Update' : 'Configure'}
						</button>
						{#if p.oauthLogin}
							{#if loginStates[p.provider]}
								<button class="btn small" onclick={() => cancelLogin(p.provider)}>Cancel login</button>
							{:else}
								<button
									class="btn small"
									class:primary={!p.configured}
									onclick={() => startLogin(p.provider)}
										title="Sign in with your provider account (OAuth)"
									>
										Sign in
									</button>
							{/if}
						{/if}
						{#if p.configured}
							<button
								class="btn small"
								onclick={() => checkAuth(p.provider)}
								disabled={checkingProvider[p.provider]}
								title="Verify credentials with the provider"
							>
								{checkingProvider[p.provider] ? 'Checking…' : 'Check auth'}
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/each}

		{#if sortedProviders.configured.length > 0 && sortedProviders.unconfigured.length > 0}
			<div class="separator" role="separator">
				<span>Unconfigured Providers</span>
			</div>
		{/if}

		{#each sortedProviders.unconfigured as p}
			<div class="auth-card" data-configured={p.configured}>
				<div class="auth-main">
					<div class="auth-icon">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
							<path d="M7 11V7a5 5 0 0110 0v4" />
						</svg>
					</div>
					<div class="auth-info">
						<span class="auth-name">{p.name}</span>
						{#if p.custom}
							<span class="custom-badge">Custom</span>
						{/if}
						<span class="auth-status" class:configured={p.configured}>
							{statusLabel(p.status)}
						</span>
					</div>
				</div>

				{#if editingProvider === p.provider}
					<div class="auth-editor">
						<div class="input-group">
							<input
								type={showApiKey ? 'text' : 'password'}
								bind:value={apiKeyInput}
								placeholder="Paste API Key here..."
								onkeydown={(e) => e.key === 'Enter' && saveApiKey()}
							/>
							<button
								class="vis-toggle"
								onclick={() => (showApiKey = !showApiKey)}
							>
								{#if showApiKey}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
								{:else}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
								{/if}
							</button>
						</div>
						<div class="auth-actions">
							<button class="btn primary small" onclick={saveApiKey}>Save</button>
							<button class="btn small" onclick={cancelEditApiKey}>Cancel</button>
						</div>
					</div>
				{:else}
					<div class="auth-actions">
						{#if p.custom}
							<button
								class="icon-btn danger"
								onclick={() => deleteProvider(p.provider)}
								title="Delete provider"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
									<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
								</svg>
							</button>
						{:else if p.configured}
							<button
								class="icon-btn danger"
								onclick={() => removeAuth(p.provider)}
								title="Remove credentials"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
									<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
								</svg>
							</button>
						{/if}
						<button
							class="btn small"
							class:primary={!p.configured}
							onclick={() =>
								p.custom ? startEditProvider(p) : startEditApiKey(p.provider)}
						>
							{p.configured ? 'Update' : 'Configure'}
						</button>
						{#if p.oauthLogin}
							{#if loginStates[p.provider]}
								<button class="btn small" onclick={() => cancelLogin(p.provider)}>Cancel login</button>
							{:else}
								<button
									class="btn small"
									class:primary={!p.configured}
									onclick={() => startLogin(p.provider)}
										title="Sign in with your provider account (OAuth)"
									>
										Sign in
									</button>
							{/if}
						{/if}
						{#if p.configured}
							<button
								class="btn small"
								onclick={() => checkAuth(p.provider)}
								disabled={checkingProvider[p.provider]}
								title="Verify credentials with the provider"
							>
								{checkingProvider[p.provider] ? 'Checking…' : 'Check auth'}
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.provider-settings {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: var(--space-4);
		overflow-y: auto;
	}

	.header {
		margin-bottom: var(--space-4);
	}

	.header-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.header-actions {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.config-btn {
		white-space: nowrap;
	}

	h3 {
		font-size: var(--text-lg);
		font-weight: 800;
		margin-bottom: var(--space-1);
	}

	.subtitle {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.auth-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.auth-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.auth-main {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.auth-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		color: var(--color-text-muted);
	}

	.separator {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		margin: var(--space-2) 0;
	}

	.separator::before,
	.separator::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-border);
	}

	.separator span {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.auth-info { display: flex; flex-direction: column; line-height: 1.2; }

	.auth-name { font-size: var(--text-sm); font-weight: 600; }

	.auth-status { font-size: 10px; color: var(--color-text-muted); }
	.auth-status.configured { color: var(--color-success); }

	.auth-actions { display: flex; gap: var(--space-2); }

	.btn {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.btn.primary { background: var(--color-primary); color: var(--color-text-inverse); border-color: var(--color-primary); }
	.btn.small { padding: 4px 12px; font-size: 11px; }
	.btn:disabled { opacity: 0.6; cursor: not-allowed; }

	.icon-btn {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.icon-btn.danger { color: var(--color-error); }
	.icon-btn.danger:hover { background: oklch(from var(--color-error) l c h / 0.1); }

	.auth-editor {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.input-group {
		display: flex;
		background: var(--color-surface);
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.input-group input {
		flex: 1;
		background: transparent;
		border: none;
		padding: 6px 10px;
		font-size: 11px;
	}

	.vis-toggle {
		padding: 0 10px;
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.add-provider-card {
		border-style: dashed;
		border-color: var(--color-primary);
	}

	.add-provider-form {
		display: flex;
		flex-direction: column;
			gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.form-row {
		display: flex;
		gap: var(--space-3);
	}

	.form-row label,
	.api-key-label {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.add-provider-form label span {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-text-muted);
	}

	.add-provider-form input {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 6px 10px;
		font-size: 11px;
		color: var(--color-text);
	}

	.add-provider-form input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.api-key-label .input-group {
		border-color: var(--color-border);
	}

	.api-key-label .input-group input {
		border: none;
	}

	.form-error {
		font-size: 11px;
		color: var(--color-error);
	}

	.fetch-models-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.models-label textarea {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 6px 10px;
		font-size: 11px;
		font-family: var(--font-mono, monospace);
		color: var(--color-text);
		resize: vertical;
	}

	.models-label textarea:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.custom-badge {
		margin-left: var(--space-2);
		padding: 1px 6px;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-primary);
		background: oklch(from var(--color-primary) l c h / 0.12);
		border-radius: var(--radius-sm);
	}

	.auth-badge {
		margin-left: var(--space-2);
		padding: 1px 6px;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-radius: var(--radius-sm);
	}
	.auth-badge.oauth {
		color: var(--color-primary);
		background: oklch(from var(--color-primary) l c h / 0.12);
	}
	.auth-badge.api-key {
		color: var(--color-warning);
		background: oklch(from var(--color-warning) l c h / 0.12);
	}

	/* ── OAuth login cards ─────────────────────────────────────────────── */

	.login-card {
		align-items: flex-start;
	}

	.login-card.failed {
		border-color: var(--color-error, #f14c4c);
	}

	.login-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 100%;
	}

	.login-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.login-badge {
		padding: 1px 6px;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-primary);
		background: oklch(from var(--color-primary) l c h / 0.12);
		border-radius: var(--radius-sm);
	}

	.login-message {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.login-message.error {
		color: var(--color-error, #f14c4c);
	}

	.login-instructions {
		font-size: var(--text-sm);
		color: var(--color-warning);
	}

	.login-device-code,
	.login-url {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.login-device-code .code {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-lg);
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	.login-url .url {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-sm);
		color: var(--color-primary);
		word-break: break-all;
	}

	.login-prompt {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--color-surface-3, var(--color-surface-2));
		border-radius: var(--radius-md);
	}

	.prompt-message {
		font-size: var(--text-sm);
	}

	.prompt-options {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		align-items: stretch;
	}

	.prompt-actions {
		display: flex;
		gap: var(--space-2);
	}

	.login-actions {
		display: flex;
		justify-content: flex-end;
	}
</style>