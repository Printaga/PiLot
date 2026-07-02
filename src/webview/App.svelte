<script lang="ts">
  import ChatPanel from "./components/ChatPanel.svelte";
  import SessionTree from "./components/SessionTree.svelte";
  import ModelSelector from "./components/ModelSelector.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import ToolsPanel from "./components/ToolsPanel.svelte";
  import PiPackagesPanel from "./components/PiPackagesPanel.svelte";
  import SkillsPanel from "./components/SkillsPanel.svelte";
  import ProviderSettings from "./components/ProviderSettings.svelte";
  import Header from "./components/Header.svelte";
  import Toast from "./components/Toast.svelte";
  import OnboardingTour from "./components/OnboardingTour.svelte";
  import ExportDialog from "./components/ExportDialog.svelte";
  import PromptTemplates from "./components/PromptTemplates.svelte";
  import type { ImageContent, Message, Model } from "./types/index";

  let activeTab = $state<
    | "chat"
    | "sessions"
    | "models"
    | "providers"
    | "tools"
    | "settings"
    | "packages"
    | "skills"
  >("chat");
  let messages = $state<Message[]>([]);
  let isStreaming = $state(false);
  let draftInputText = $state("");
  let draftInputImages = $state<ImageContent[]>([]);
  let models = $state<Model[]>([]);
  let isInitialized = $state(false);
  let currentModel = $state<string | null>(null);
  let favoriteModels = $state<string[]>([]);
  let thinkingLevel = $state<string>("medium");
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
  let providers = $state<
    Array<{
      provider: string;
      name: string;
      configured: boolean;
      status: string;
    }>
  >([]);
  let isListening = $state(false);
  let activeToolCalls: Map<string, { toolName: string; args: any }> = $state(
    new Map(),
  );
  let toolPreset = $state<string | null>(null);

  // Update notification state
  let hasUpdates = $state(false);
  let piUpdateAvailable = $state<string | null>(null);
  let packageUpdateCount = $state(0);
  let appVersion = $state("0.0.0");
  let piCliVersion = $state<string | null>(null);
  let isBinaryAvailable = $state(false);

  // Footer data for PI TUI-style status line
  let footerCwd = $state("");
  let footerGitBranch = $state<string | null>(null);
  let footerSessionName = $state<string | null>(null);

  // Feature states: onboarding, export, prompt templates
  let showOnboarding = $state(false);
  let showExport = $state(false);
  let showPromptTemplates = $state(false);
  let previousResourceCount = $state<Record<string, number>>({});

  // Activity status bar: package statuses from ctx.ui.setStatus() and derived events
  interface ActivityItem {
    text: string;
    type: "extension" | "tool" | "system";
    timestamp: number;
  }
  let activityStatuses = $state<Record<string, ActivityItem>>({});

  // Toast helper - uses global from Toast component
  function showToast(opts: {
    type: "info" | "success" | "warning" | "error";
    title: string;
    message?: string;
    persistent?: boolean;
    duration?: number;
  }) {
    const t = (window as any).__toast;
    if (t?.showToast) t.showToast(opts);
  }

  // Poll context usage and token stats every 5s once initialized
  $effect(() => {
    if (!isInitialized) return;
    const vscode = (window as any).vscode;
    if (!vscode?.postMessage) return;

    function poll() {
      vscode.postMessage({ type: "getContextUsage" });
      vscode.postMessage({ type: "getSessionStats" });
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  });

  $effect(() => {
    const acquireVsCodeApi =
      typeof window !== "undefined" ? (window as any).acquireVsCodeApi : null;
    if (typeof acquireVsCodeApi === "function") {
      const vscode = acquireVsCodeApi();
      if (typeof vscode?.postMessage !== "function") return;
      (window as any).vscode = vscode;

      window.addEventListener("message", handleVSCodeMessage);
      vscode.postMessage({ type: "ready" });

      return () => {
        window.removeEventListener("message", handleVSCodeMessage);
      };
    }
  });

  $effect(() => {
    if (activeTab !== "models" && activeTab !== "providers") return;
    if (typeof (window as any).vscode?.postMessage === "function") {
      (window as any).vscode.postMessage({ type: "getModels" });
      (window as any).vscode.postMessage({ type: "getProviderAuth" });
    }
  });

  // Global keyboard shortcut handler (Features 5, 3)
  $effect(() => {
    function handleKeydown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.contentEditable === "true";

      // Always allow Escape to close dialogs, even from inputs
      if (e.key === "Escape") {
        showExport = false;
        showPromptTemplates = false;
        showOnboarding = false;
        return;
      }

      // Don't handle other shortcuts when typing in input
      if (isInput) return;

      switch (e.key) {
        case "1":
          activeTab = "chat";
          e.preventDefault();
          break;
        case "2":
          activeTab = "sessions";
          e.preventDefault();
          break;
        case "3":
          activeTab = "models";
          e.preventDefault();
          break;
        case "4":
          activeTab = "providers";
          e.preventDefault();
          break;
        case "5":
          activeTab = "tools";
          e.preventDefault();
          break;
        case "6":
          activeTab = "packages";
          e.preventDefault();
          break;
        case "7":
          activeTab = "skills";
          e.preventDefault();
          break;
        case "8":
          activeTab = "settings";
          e.preventDefault();
          break;
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  /** Extract text content from an AssistantMessage (content may be a string or array of content blocks). */
  function extractTextFromAssistantMessage(msg: any): string {
    if (!msg) return "";
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((c: any) => c.type === "text" && typeof c.text === "string")
        .map((c: any) => c.text)
        .join("");
    }
    return "";
  }

  /** Extract thinking content from an AssistantMessage. */
  function extractThinkingFromAssistantMessage(msg: any): string | undefined {
    if (!msg) return undefined;
    if (Array.isArray(msg.content)) {
      const thinkingBlocks = msg.content.filter(
        (c: any) => c.type === "thinking" && typeof c.thinking === "string",
      );
      if (thinkingBlocks.length === 0) return undefined;
      return thinkingBlocks.map((c: any) => c.thinking).join("\n");
    }
    return undefined;
  }

  function handleVSCodeMessage(event: MessageEvent) {
    const { type, data } = event.data;

    switch (type) {
      case "ready":
        handleReady(data);
        break;
      case "pi-event":
        handlePiEvent(data);
        break;
      case "session-updated":
        activeTab = "chat";
        break;
      case "session-history":
        messages = data.messages || [];
        draftInputText = "";
        draftInputImages = [];
        maybeShowForkHint(messages);
        activeTab = "chat";
        break;
      case "fork-input-restored":
        draftInputText = data?.text || "";
        draftInputImages = Array.isArray(data?.images) ? data.images : [];
        activeTab = "chat";
        break;
      case "models-updated":
        models = data.models;
        break;

      case "model-changed":
        currentModel = data.modelId;
        break;

      case "thinking-level-changed":
        thinkingLevel = data.level;
        break;

      case "context-usage":
        if (data) {
          contextPercent = data.percent;
          contextTokens = data.tokens;
          contextWindow = data.contextWindow;
          if (data.autoCompactionEnabled !== undefined) {
            autoCompaction = data.autoCompactionEnabled;
          }
        }
        break;

      case "session-stats":
        if (data?.tokens) {
          tokensIn = data.tokens.input || 0;
          tokensOut = data.tokens.output || 0;
          tokensTotal = data.tokens.total || 0;
          tokensCacheRead = data.tokens.cacheRead || 0;
        }
        break;

      case "session-resources":
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
        break;

      case "auto-compaction-changed":
        autoCompaction = data.enabled;
        break;

      case "provider-auth":
        providers = data || [];
        break;

      case "settings-response":
        toolPreset = data?.toolPreset ?? null;
        break;

      case "switchTab":
        if (data?.tab) {
          activeTab = data.tab;
        }
        break;

      case "pickModel":
      case "show-login":
        break;

      case "new-session":
        handleNewSession();
        break;

      case "edit-last-message": {
        // Find the last user message in the messages array
        const lastUserIdx = messages.reduceRight(
          (found, msg, i) => (found === -1 && msg.role === "user" ? i : found),
          -1,
        );
        if (lastUserIdx !== -1) {
          editRequestIndex = lastUserIdx;
        }
        break;
      }

      case "error":
        isStreaming = false;
        // Clean up any dangling streaming message that never got message_end
        // (e.g. when agent.prompt() throws before emitting end events)
        if (messages.length > 0 && messages[messages.length - 1].isStreaming) {
          const lastMsg = messages[messages.length - 1];
          messages = [
            ...messages.slice(0, -1),
            { ...lastMsg, isStreaming: false },
          ];
        }
        showToast({
          type: "error",
          title: "Error",
          message: data.message || "An error occurred",
          persistent: true,
        });
        messages = [
          ...messages,
          {
            role: "system",
            content: `❌ Error: ${data.message || "An error occurred"}`,
            timestamp: data.timestamp || Date.now(),
          },
        ];
        break;

      case "updates-available":
        hasUpdates = true;
        piUpdateAvailable = data?.piVersion ?? null;
        packageUpdateCount = data?.packageCount ?? 0;
        if (data?.piVersion) {
          showToast({
            type: "info",
            title: `PI CLI v${data.piVersion} available`,
            message: "Click the update button in the header to update.",
          });
        }
        break;

      case "updates-cleared":
        hasUpdates = false;
        piUpdateAvailable = null;
        packageUpdateCount = 0;
        break;

      case "system-message":
        messages = [
          ...messages,
          {
            role: "system",
            content: data.message || "",
            timestamp: Date.now(),
          },
        ];
        break;

      case "voice-listening-changed":
        isListening = data?.listening ?? false;
        break;

      case "voice-transcription":
        if (data?.text) {
          window.dispatchEvent(
            new CustomEvent("voice-transcription", { detail: data.text }),
          );
        }
        break;

      case "extension-status": {
        // Individual extension status update from ctx.ui.setStatus(key, text)
        const { key, text } = data;
        if (text === undefined || text === null) {
          // Extension cleared its status — only remove if it's an extension-type key
          const current = activityStatuses[key];
          if (current && current.type === "extension") {
            const { [key]: _, ...rest } = activityStatuses;
            activityStatuses = rest;
          }
        } else {
          activityStatuses = {
            ...activityStatuses,
            [key]: { text, type: "extension", timestamp: Date.now() },
          };
        }
        break;
      }

      case "extension-statuses-full": {
        // Full sync of all extension statuses
        if (data && typeof data === "object") {
          const updates: Record<string, ActivityItem> = {};
          for (const [key, text] of Object.entries(data)) {
            if (typeof text === "string") {
              updates[key] = { text, type: "extension", timestamp: Date.now() };
            }
          }
          // Merge: keep non-extension (tool/system) entries, update extension entries
          const merged: Record<string, ActivityItem> = {};
          for (const [k, v] of Object.entries(activityStatuses)) {
            if (v.type !== "extension") {
              merged[k] = v; // preserve tool/system statuses
            }
          }
          for (const [k, v] of Object.entries(updates)) {
            merged[k] = v;
          }
          activityStatuses = merged;
        }
        break;
      }

      case "extension-statuses-clear":
        // All extension statuses cleared (e.g., session switch)
        {
          const kept: Record<string, ActivityItem> = {};
          for (const [k, v] of Object.entries(activityStatuses)) {
            if (v.type !== "extension") {
              kept[k] = v;
            }
          }
          activityStatuses = kept;
        }
        break;

      case "footer-data": {
        // Footer data from extension host (cwd, git branch, session name)
        if (data.cwd) footerCwd = data.cwd;
        if (data.gitBranch !== undefined) footerGitBranch = data.gitBranch;
        if (data.sessionName !== undefined)
          footerSessionName = data.sessionName;
        break;
      }

      case "activity-start": {
        const { key, text, activityType } = data;
        activityStatuses = {
          ...activityStatuses,
          [key]: {
            text: text || key,
            type: activityType || "system",
            timestamp: Date.now(),
          },
        };
        break;
      }

      case "activity-end": {
        const { key } = data;
        const { [key]: _, ...rest } = activityStatuses;
        activityStatuses = rest;
        break;
      }

      case "extension-notify": {
        const { message, type: _type } = data;
        if (message) {
          // Show package notifications as system messages in chat instead of popup toasts
          messages = [
            ...messages,
            {
              role: "system",
              content: message,
              timestamp: Date.now(),
              isStreaming: false,
            },
          ];
        }
        break;
      }
    }
  }

  function handleReady(data: any) {
    isInitialized = true;
    if (data?.appVersion) appVersion = data.appVersion;
    if (data?.models) models = data.models;
    if (data?.currentModel) currentModel = data.currentModel;
    if (data?.favoriteModels) favoriteModels = data.favoriteModels;
    piCliVersion = data?.piCliVersion ?? null;
    isBinaryAvailable = data?.isBinaryAvailable ?? false;
    if (data?.thinkingLevel) thinkingLevel = data.thinkingLevel;

    // Show onboarding on first launch (Feature 3)
    try {
      const hasSeenTour = localStorage.getItem("pilots-seen-tour");
      if (!hasSeenTour) {
        showOnboarding = true;
      }
    } catch {}
  }

  function handlePiEvent(event: any) {
    switch (event.type) {
      case "agent_start":
        isStreaming = true;
        break;

      case "message_start":
        {
          const msgRole = event.message?.role || "assistant";
          if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg.isStreaming) {
              messages = [
                ...messages.slice(0, -1),
                { ...lastMsg, isStreaming: false },
              ];
            }
          }
          // Extract initial text content from the message if available
          // (covers non-streaming providers or partial content in start event)
          const startContent = extractTextFromAssistantMessage(event.message);
          const startThinking = extractThinkingFromAssistantMessage(
            event.message,
          );
          if (msgRole === "assistant" || !msgRole || msgRole === "system") {
            messages = [
              ...messages,
              {
                role: msgRole || "assistant",
                content: startContent || "",
                thinking: startThinking || undefined,
                timestamp: event.message?.timestamp || Date.now(),
                isStreaming: true,
              },
            ];
          }
        }
        break;

      case "message_end":
        if (messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          // Extract final content from the completed message to ensure nothing is lost
          let finalContent = extractTextFromAssistantMessage(event.message);
          const finalThinking = extractThinkingFromAssistantMessage(
            event.message,
          );
          // Surface provider errors (rate limit, out of credits, etc.)
          // The agent sets stopReason="error" + errorMessage on the assistant message
          if (
            event.message?.stopReason === "error" &&
            event.message?.errorMessage
          ) {
            finalContent = `❌ ${event.message.errorMessage}`;
          }
          if (lastMsg.isStreaming) {
            messages = [
              ...messages.slice(0, -1),
              {
                ...lastMsg,
                // Use the final message content if it's more complete than what we accumulated
                content: finalContent || lastMsg.content || "",
                thinking: finalThinking || lastMsg.thinking,
                isStreaming: false,
              },
            ];
          }
        }
        break;

      case "turn_start":
        break;

      case "turn_end":
        break;

      case "message_update":
        {
          const hasStreaming =
            messages.length > 0 && messages[messages.length - 1].isStreaming;
          if (!hasStreaming && isStreaming) {
            messages = [
              ...messages,
              {
                role: "assistant",
                content: "",
                timestamp: Date.now(),
                isStreaming: true,
              },
            ];
          }
        }
        // Handle thinking deltas — append to the thinking buffer
        if (
          event.assistantMessageEvent?.type === "thinking_delta" &&
          messages.length > 0
        ) {
          const lastMsg = messages[messages.length - 1];
          if (lastMsg.isStreaming) {
            messages = [
              ...messages.slice(0, -1),
              {
                ...lastMsg,
                thinking:
                  (lastMsg.thinking || "") + event.assistantMessageEvent.delta,
                content: lastMsg.content || "",
              },
            ];
          }
          break;
        }
        // Handle text deltas — append to the content buffer
        if (
          event.assistantMessageEvent?.type === "text_delta" &&
          messages.length > 0
        ) {
          const lastMsg = messages[messages.length - 1];
          if (lastMsg.isStreaming) {
            messages = [
              ...messages.slice(0, -1),
              {
                ...lastMsg,
                content: lastMsg.content + event.assistantMessageEvent.delta,
              },
            ];
          }
          break;
        }
        // For other message_update events (text_end, thinking_end, toolcall_*),
        // sync content from the partial message if it's more complete than what we have.
        // This ensures content is captured even if some delta events were dropped.
        if (
          event.assistantMessageEvent &&
          event.message &&
          messages.length > 0
        ) {
          const lastMsg = messages[messages.length - 1];
          if (lastMsg.isStreaming) {
            const partialContent = extractTextFromAssistantMessage(
              event.message,
            );
            const partialThinking = extractThinkingFromAssistantMessage(
              event.message,
            );
            // Only update if the partial message content is longer than what we've accumulated
            if (
              partialContent &&
              partialContent.length > (lastMsg.content || "").length
            ) {
              messages = [
                ...messages.slice(0, -1),
                {
                  ...lastMsg,
                  content: partialContent,
                  thinking: partialThinking || lastMsg.thinking,
                },
              ];
            } else if (
              partialThinking &&
              partialThinking.length > (lastMsg.thinking || "").length
            ) {
              messages = [
                ...messages.slice(0, -1),
                {
                  ...lastMsg,
                  thinking: partialThinking,
                },
              ];
            }
          }
        }
        break;

      case "agent_end":
        isStreaming = false;
        if (messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          if (lastMsg.isStreaming) {
            // Try to extract content from the last agent message in the event
            let agentEndContent: string | undefined;
            let agentEndThinking: string | undefined;
            if (event.messages && Array.isArray(event.messages)) {
              // Find last assistant message from the agent_end payload
              for (let i = event.messages.length - 1; i >= 0; i--) {
                const m = event.messages[i];
                if (m.role === "assistant") {
                  agentEndContent = extractTextFromAssistantMessage(m);
                  agentEndThinking = extractThinkingFromAssistantMessage(m);
                  // Surface provider errors from agent_end payload too
                  if (m.stopReason === "error" && m.errorMessage) {
                    agentEndContent = `❌ ${m.errorMessage}`;
                  }
                  break;
                }
              }
            }
            messages = [
              ...messages.slice(0, -1),
              {
                ...lastMsg,
                content: agentEndContent || lastMsg.content || "",
                thinking: agentEndThinking || lastMsg.thinking,
                isStreaming: false,
              },
            ];
          }
        }
        break;

      case "compaction_start":
        showToast({
          type: "info",
          title: "Compacting context...",
          message: event.reason || "auto",
        });
        break;

      case "compaction_end":
        if (event.errorMessage) {
          showToast({
            type: "warning",
            title: "Compaction error",
            message: event.errorMessage,
            persistent: true,
          });
        } else if (event.result) {
          showToast({
            type: "success",
            title: "Context compacted",
            message: event.result.tokensSaved
              ? `Saved ${event.result.tokensSaved} tokens`
              : undefined,
          });
        }
        if (typeof (window as any).vscode?.postMessage === "function") {
          (window as any).vscode.postMessage({ type: "getContextUsage" });
        }
        break;

      case "auto_retry_start":
        showToast({
          type: "warning",
          title: `Retry ${event.attempt}/${event.maxAttempts}`,
          message: event.errorMessage,
        });
        break;

      case "auto_retry_end":
        if (!event.success && event.finalError) {
          showToast({
            type: "error",
            title: "All retries exhausted",
            message: event.finalError,
            persistent: true,
          });
        }
        break;

      case "tool_execution_start":
        activeToolCalls.set(event.toolCallId, {
          toolName: event.toolName,
          args: event.args || {},
        });
        messages = [
          ...messages,
          {
            role: "system",
            content: "",
            timestamp: Date.now(),
            toolCalls: [
              {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args || {},
                status: "pending",
              },
            ],
          },
        ];
        break;

      case "tool_execution_update":
        activeToolCalls.set(event.toolCallId, {
          toolName: event.toolName,
          args: event.args || {},
        });
        const updateMsgIdx = messages.findLastIndex(
          (m) =>
            m.role === "system" &&
            m.toolCalls?.some((tc) => tc.toolCallId === event.toolCallId),
        );
        if (updateMsgIdx >= 0) {
          messages = [
            ...messages.slice(0, updateMsgIdx),
            {
              ...messages[updateMsgIdx],
              toolCalls: messages[updateMsgIdx].toolCalls!.map((tc) =>
                tc.toolCallId === event.toolCallId
                  ? { ...tc, status: "streaming" }
                  : tc,
              ),
            },
            ...messages.slice(updateMsgIdx + 1),
          ];
        }
        break;

      case "tool_execution_end":
        const toolResult = activeToolCalls.get(event.toolCallId);
        if (toolResult || messages.length > 0) {
          activeToolCalls.delete(event.toolCallId);
          const lastSystemIdx = messages.findLastIndex(
            (m) =>
              m.role === "system" &&
              m.toolCalls?.some((tc) => tc.toolCallId === event.toolCallId),
          );
          if (lastSystemIdx >= 0) {
            messages = [
              ...messages.slice(0, lastSystemIdx),
              {
                ...messages[lastSystemIdx],
                toolCalls: messages[lastSystemIdx].toolCalls!.map((tc) =>
                  tc.toolCallId === event.toolCallId
                    ? {
                        ...tc,
                        status: "complete",
                        result: {
                          content:
                            event.result?.content
                              ?.map((c: any) => c.text || "")
                              .join("\n") || "",
                          details: event.result?.details,
                          isError: event.isError,
                        },
                        isError: event.isError,
                      }
                    : tc,
                ),
              },
              ...messages.slice(lastSystemIdx + 1),
            ];
          }
        }
        break;

      case "model_select":
        showToast({
          type: "info",
          title: "Model changed",
          message: event.model?.name || event.model?.id || "unknown",
        });
        break;

      case "thinking_level_select":
        showToast({ type: "info", title: `Thinking level: ${event.level}` });
        break;

      case "queue_update":
        if (event.steering?.length > 0) {
          for (const text of event.steering) {
            messages = [
              ...messages,
              {
                role: "system",
                content: `📥 Queued (interrupt): ${text.slice(0, 100)}`,
                timestamp: Date.now(),
              },
            ];
          }
        }
        if (event.followUp?.length > 0) {
          for (const text of event.followUp) {
            messages = [
              ...messages,
              {
                role: "system",
                content: `📨 Queued (after response): ${text.slice(0, 100)}`,
                timestamp: Date.now(),
              },
            ];
          }
        }
        break;

      case "session_info_changed":
        break;

      case "session_tree":
        messages = [
          ...messages,
          {
            role: "system",
            content: `🌳 Session tree navigated${event.label ? `: ${event.label}` : ""}`,
            timestamp: Date.now(),
          },
        ];
        break;
    }
  }

  function sendMessage(msg: any) {
    if (typeof (window as any).vscode?.postMessage === "function") {
      (window as any).vscode.postMessage(msg);
    }
  }

  function maybeShowForkHint(currentMessages: any[]) {
    try {
      const hasSeenHint = localStorage.getItem("pilots-seen-fork-hint");
      if (hasSeenHint) return;

      const hasForkableUserMessage = currentMessages.some(
        (message) => message?.role === "user" && message?.entryId,
      );
      if (!hasForkableUserMessage) return;

      localStorage.setItem("pilots-seen-fork-hint", "true");
      showToast({
        type: "info",
        title: "New fork shortcut",
        message:
          "Hover any user message and click the fork icon to branch from that point.",
        duration: 5500,
      });
    } catch {}
  }

  async function handleSendPrompt(text: string, images?: ImageContent[]) {
    const newMsg: Message = {
      role: "user",
      content: text || "",
      images: images && images.length > 0 ? images : undefined,
      timestamp: Date.now(),
    };
    messages = [...messages, newMsg];
    sendMessage({ type: "prompt", data: { text, images } });
  }

  let editRequestIndex = $state<number | null>(null);

  function handleEditMessage(index: number, newText: string) {
    // Update local state immediately
    messages = messages.map((msg, i) => {
      if (i === index && msg.role === "user") {
        return { ...msg, content: newText, timestamp: Date.now() };
      }
      return msg;
    });
    // Send edit to extension host for persistence
    (window as any).vscode?.postMessage({
      type: "edit-message",
      data: { index, text: newText },
    });
  }

  function handleForkMessage(entryId: string) {
    sendMessage({
      type: "forkSession",
      data: { entryId },
    });
  }

  function handleInsertPromptTemplate(text: string) {
    draftInputText = text;
    draftInputImages = [];
    showPromptTemplates = false;
    activeTab = "chat";
  }

  async function handleNewSession() {
    messages = [];
    contextPercent = null;
    contextTokens = null;
    contextWindow = 0;
    activityStatuses = {};
    sendMessage({ type: "newSession" });
  }

  function getModelDisplay(modelId: string | null): string {
    if (!modelId) return "No model";
    const m = models.find((m) => m.id === modelId);
    return m ? m.name : modelId.split("/").slice(1).join("/") || modelId;
  }

  async function handleSwitchModel(modelId: string) {
    currentModel = modelId;
    sendMessage({ type: "switchModel", data: { modelId } });
  }

  async function handleToggleFavorite(modelId: string) {
    const isFav = favoriteModels.includes(modelId);
    sendMessage({
      type: "toggleFavorite",
      data: { modelId, isFavorite: !isFav },
    });
    if (isFav) {
      favoriteModels = favoriteModels.filter((m) => m !== modelId);
    } else {
      favoriteModels = [...favoriteModels, modelId];
    }
  }

  function handleSelectFavorite(modelId: string) {
    handleSwitchModel(modelId);
  }

  async function handleSetThinkingLevel(level: string) {
    thinkingLevel = level;
    sendMessage({ type: "setThinkingLevel", data: { level } });
  }

  async function handleAbort() {
    sendMessage({ type: "abort" });
    isStreaming = false;
  }

  function handleCompact() {
    sendMessage({ type: "compact" });
  }

  function handleToggleVoice() {
    sendMessage({ type: "toggle-voice-capture" });
  }

  async function handleRenameSession() {
    sendMessage({ type: "showRenameSessionDialog" });
  }

  // Listen for show-tour event from SettingsPanel
  $effect(() => {
    function handleShowTour() {
      showOnboarding = true;
    }
    window.addEventListener("show-tour", handleShowTour);
    return () => window.removeEventListener("show-tour", handleShowTour);
  });

  function completeOnboarding() {
    showOnboarding = false;
    try {
      localStorage.setItem("pilots-seen-tour", "true");
    } catch {}
    showToast({
      type: "success",
      title: "Tour complete!",
    });
  }
</script>

<div class="app">
  <Header
    {appVersion}
    {currentModel}
    modelName={getModelDisplay(currentModel)}
    {piCliVersion}
    providerName={currentModel?.split("/")[0] || ""}
    {thinkingLevel}
    onNewSession={handleNewSession}
    {favoriteModels}
    {models}
    onSelectFavorite={handleSelectFavorite}
    onThinkingLevelChange={handleSetThinkingLevel}
    onRenameSession={handleRenameSession}
    onSwitchToModels={() => (activeTab = "models")}
    onRunUpdate={() => sendMessage({ type: "checkForUpdates" })}
    onShowTour={() => (showOnboarding = true)}
    {hasUpdates}
    {piUpdateAvailable}
    {packageUpdateCount}
  />

  <div class="main">
    <nav class="sidebar">
      <div class="nav-group">
        <button
          onclick={() => (activeTab = "chat")}
          class:active={activeTab === "chat"}
          title="Conversation"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
            />
          </svg>
        </button>

        <button
          onclick={() => (activeTab = "sessions")}
          class:active={activeTab === "sessions"}
          title="History"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

        <button
          onclick={() => (activeTab = "models")}
          class:active={activeTab === "models"}
          title="Models"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1m-1.636 6.364l-.707-.707M12 21v-1m-6.364-1.636l.707-.707M3 12h1m1.636-6.364l.707.707M12 8a4 4 0 110 8 4 4 0 010-8z"
            />
          </svg>
        </button>

        <button
          onclick={() => (activeTab = "providers")}
          class:active={activeTab === "providers"}
          title="Provider Settings"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M12 15v3M12 6v3M6 9h12M8 12a4 4 0 108 0 4 4 0 00-8 0z" />
          </svg>
        </button>

        <button
          onclick={() => (activeTab = "tools")}
          class:active={activeTab === "tools"}
          title="Capabilities"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
            />
          </svg>
        </button>

        <button
          onclick={() => (activeTab = "packages")}
          class:active={activeTab === "packages"}
          title="Packages"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M21 16.5c0 .552-.448 1-1 1H4c-.552 0-1-.448-1-1V8.5c0-.552.448-1 1-1h16c.552 0 1 .448 1 1v8zM21 8.5V6c0-.552-.448-1-1-1H4c-.552 0-1 .448-1 1v2.5M4 12h16"
            />
          </svg>
        </button>

        <button
          onclick={() => (activeTab = "skills")}
          class:active={activeTab === "skills"}
          title="Skills"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </button>
      </div>

      <div class="nav-footer">
        <button
          onclick={() => (activeTab = "settings")}
          class:active={activeTab === "settings"}
          title="Preferences"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </nav>

    <main class="content">
      {#if activeTab === "chat"}
        <ChatPanel
          {messages}
          {isStreaming}
          onSend={handleSendPrompt}
          onNewSession={handleNewSession}
          onAbort={handleAbort}
          {sessionResources}
          {isBinaryAvailable}
          {piCliVersion}
          {isListening}
          onToggleVoice={handleToggleVoice}
          bind:inputText={draftInputText}
          bind:inputImages={draftInputImages}
          {tokensIn}
          {tokensOut}
          {tokensTotal}
          {tokensCacheRead}
          {contextPercent}
          {contextTokens}
          {contextWindow}
          {autoCompaction}
          onCompact={handleCompact}
          {editRequestIndex}
          onEditMessage={handleEditMessage}
          onForkMessage={handleForkMessage}
          onShowExport={() => (showExport = true)}
          onShowPromptTemplates={() => (showPromptTemplates = true)}
          {previousResourceCount}
          {activityStatuses}
          {footerCwd}
          {footerGitBranch}
          {footerSessionName}
        />
      {:else if activeTab === "sessions"}
        <SessionTree />
      {:else if activeTab === "models"}
        <ModelSelector
          {models}
          {currentModel}
          {favoriteModels}
          {providers}
          onSelect={handleSwitchModel}
          onToggleFavorite={handleToggleFavorite}
        />
      {:else if activeTab === "providers"}
        <ProviderSettings {providers} />
      {:else if activeTab === "tools"}
        <ToolsPanel {toolPreset} />
      {:else if activeTab === "packages"}
        <PiPackagesPanel />
      {:else if activeTab === "skills"}
        <SkillsPanel {sessionResources} />
      {:else}
        <SettingsPanel
          {autoContext}
          {appVersion}
          {thinkingLevel}
          onAutoContextChange={(value) => {
            autoContext = value;
            sendMessage({ type: "setAutoContext", data: { enabled: value } });
          }}
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
    border: 4px solid var(--color-border);
  }

  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
    position: relative;
    border-top: 2px solid var(--color-border);
  }

  .sidebar {
    width: 56px;
    background: var(--color-surface);
    border-right: 2px solid var(--color-border);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: var(--space-4) 0;
    z-index: 10;
    box-shadow: 4px 0 0px rgba(0, 0, 0, 0.5);
  }

  .nav-group,
  .nav-footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
  }

  .sidebar button {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0;
    border: 2px solid transparent;
    color: var(--color-text-muted);
    transition: all var(--transition-fast);
    position: relative;
    background: transparent;
  }

  .sidebar button:hover {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    border: 2px solid var(--color-border);
    transform: translate(-2px, -2px);
    box-shadow: 2px 2px 0px var(--color-primary);
  }

  .sidebar button.active {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    border: 2px solid var(--color-primary);
    box-shadow: 4px 4px 0px rgba(0, 0, 0, 1);
    transform: translate(-2px, -2px);
  }

  .sidebar button.active::after {
    display: none;
  }

  .content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: transparent;
    position: relative;
  }
</style>
