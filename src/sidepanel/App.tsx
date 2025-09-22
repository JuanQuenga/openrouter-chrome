import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2,
  XCircle,
  Info,
  Loader2,
  Mic,
  Square,
  Settings,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as OR from "@/utils/openrouter-client.js";

type ChatMessage = {
  role: "user" | "assistant" | "system" | "function";
  content: string;
  name?: string;
  automation?: {
    isAutomation: true;
    success?: boolean;
    action?: string;
    debug?: any;
  };
};

// Context summary removed from UI

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [stream, setStream] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [models, setModels] = useState<any[]>([]);
  const [model, setModel] = useState<string>("auto");
  const [loading, setLoading] = useState(false);
  const [allowAllAutomation, setAllowAllAutomation] = useState(false);
  const [automationWhitelist, setAutomationWhitelist] = useState("");
  const [automationRateLimit, setAutomationRateLimit] = useState<number>(20);
  // removed unused seedPrompt state
  const [debugMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [sttProvider, setSttProvider] = useState<"webspeech" | "gemini">(
    "gemini"
  );
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [sttError, setSttError] = useState<string>("");

  // Usage and balance
  const [lastPromptTokens, setLastPromptTokens] = useState<number | null>(null);
  const [lastCompletionTokens, setLastCompletionTokens] = useState<
    number | null
  >(null);
  const [remainingCredits, setRemainingCredits] = useState<number | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Load settings
  useEffect(() => {
    (async () => {
      try {
        const stored = await chrome.storage?.local.get([
          "openrouter_api_key",
          "automation_enabled",
          "stream_enabled",
          "preferred_model",
          "stt_provider",
          "gemini_api_key",
        ]);
        const k = stored?.openrouter_api_key || "";
        setApiKey(k);
        setHasKey(!!k);
        if (typeof stored?.automation_enabled === "boolean") {
          setAutomationEnabled(stored.automation_enabled);
        }
        if (typeof stored?.automation_allow_all === "boolean") {
          setAllowAllAutomation(stored.automation_allow_all);
        }
        if (typeof stored?.automation_rate_limit === "number") {
          setAutomationRateLimit(stored.automation_rate_limit);
        }
        if (typeof stored?.automation_whitelist === "string") {
          setAutomationWhitelist(stored.automation_whitelist);
        } else if (Array.isArray(stored?.automation_whitelist)) {
          setAutomationWhitelist(stored.automation_whitelist.join(", "));
        }
        if (typeof stored?.stream_enabled === "boolean") {
          setStream(stored.stream_enabled);
        }
        if (typeof stored?.preferred_model === "string") {
          setModel(stored.preferred_model);
        }
        if (
          stored?.stt_provider === "gemini" ||
          stored?.stt_provider === "webspeech"
        ) {
          setSttProvider(stored.stt_provider);
        }
        if (typeof stored?.gemini_api_key === "string") {
          setGeminiApiKey(stored.gemini_api_key);
        }
        if (k) {
          await fetchModels(k);
        }
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // Context summary removed

  // Load and consume any seed prompt set by entry points
  useEffect(() => {
    (async () => {
      try {
        const { seed_prompt } = await chrome.storage.local.get(["seed_prompt"]);
        if (typeof seed_prompt === "string" && seed_prompt.trim().length > 0) {
          setInput(seed_prompt.trim());
          // clear after consumption
          await chrome.storage.local.remove(["seed_prompt"]);
        }
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  const client = useMemo(
    () => (hasKey ? new OR.OpenRouterClient(apiKey) : null),
    [hasKey, apiKey]
  );

  useEffect(() => {
    (async () => {
      if (!client) return;
      try {
        const credits = await client.getCredits();
        setRemainingCredits(credits.remaining);
      } catch (_) {
        setRemainingCredits(null);
      }
    })();
  }, [client]);

  function capitalize(text: string): string {
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function cleanAction(name?: string): string {
    if (!name) return "Tool";
    return capitalize(String(name).replace(/[_-]+/g, " "));
  }

  function shortenUrl(url?: string): string {
    if (!url) return "URL";
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
    } catch {
      return url.length > 60 ? url.slice(0, 57) + "..." : url;
    }
  }

  function buildAutomationMessage(
    name: string,
    args: any,
    result: any
  ): { text: string; meta: NonNullable<ChatMessage["automation"]> } {
    const success = result?.success !== false && !result?.error;
    const err = typeof result?.error === "string" ? result.error : undefined;
    let text = "";
    switch (name) {
      case "open_url":
        text = success
          ? `Opened ${shortenUrl(args?.url)}${args?.newTab ? " (new tab)" : ""}`
          : `Open URL failed${args?.url ? ` for ${shortenUrl(args.url)}` : ""}${
              err ? `: ${err}` : ""
            }`;
        break;
      case "wait_for_element":
        text = success
          ? `Element ready: ${args?.selector || "(selector)"}`
          : `Wait for ${args?.selector || "(selector)"} failed${
              err ? `: ${err}` : ""
            }`;
        break;
      case "type_text":
        text = success
          ? `Typed into ${args?.selector || "(selector)"}`
          : `Typing failed for ${args?.selector || "(selector)"}${
              err ? `: ${err}` : ""
            }`;
        break;
      case "click_element":
        text = success
          ? `Clicked ${args?.selector || "(selector)"}`
          : `Click failed for ${args?.selector || "(selector)"}${
              err ? `: ${err}` : ""
            }`;
        break;
      case "get_page_content":
        text = success
          ? "Captured page content"
          : `Get page content failed${err ? `: ${err}` : ""}`;
        break;
      case "ebay_search":
        text = success
          ? `eBay search started for "${args?.query || ""}"${
              args?.soldOnly === false ? "" : ", Sold only"
            }${
              args?.condition && args?.condition !== "any"
                ? `, Condition: ${args?.condition}`
                : ""
            }`
          : `eBay search failed${err ? `: ${err}` : ""}`;
        break;
      case "fetch_prices":
        text = success
          ? `Fetched prices for "${args?.query || "query"}"`
          : `Fetch prices failed${err ? `: ${err}` : ""}`;
        break;
      case "upc_lookup":
        text = success
          ? `Found UPCs for "${args?.query || "query"}"`
          : `UPC lookup failed${err ? `: ${err}` : ""}`;
        break;
      default:
        text = success
          ? `${cleanAction(name)} succeeded`
          : `${cleanAction(name)} failed${err ? `: ${err}` : ""}`;
    }
    return {
      text,
      meta: {
        isAutomation: true,
        success,
        action: name,
        debug: { args, result },
      },
    };
  }

  async function fetchModels(k: string) {
    try {
      const tempClient = new OR.OpenRouterClient(k);
      const res = await tempClient.listModels();
      setModels(Array.isArray(res) ? res : []);
    } catch (e) {
      setModels([]);
    }
  }

  // Settings can be toggled via chat actions in the future

  async function saveSettings() {
    await chrome.storage.local.set({
      openrouter_api_key: apiKey,
      automation_enabled: automationEnabled,
      automation_allow_all: allowAllAutomation,
      automation_rate_limit: automationRateLimit,
      automation_whitelist: automationWhitelist,
      stream_enabled: stream,
      preferred_model: model,
      stt_provider: sttProvider,
      gemini_api_key: geminiApiKey,
    });
    setHasKey(!!apiKey);
    if (apiKey) await fetchModels(apiKey);
    setIsSettingsOpen(false);
  }

  function uiModelLabel(m: any) {
    return m?.id || m?.slug || String(m);
  }

  // OpenRouter auto routing is used instead of a local heuristic when "Auto Select" is chosen

  async function handleSend() {
    if (!input.trim()) return;
    if (!client) {
      setIsSettingsOpen(true);
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // Use OpenRouter's Auto Router when "Auto Select" is chosen
      let selectedModel = model === "auto" ? "openrouter/auto" : model;
      if (!selectedModel) selectedModel = "openrouter/auto";

      // If streaming enabled, do simple streaming without tools
      if (stream) {
        const draftIndex = messages.length + 1;
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
        setLastPromptTokens(null);
        setLastCompletionTokens(null);
        await client.chatWithStreaming(
          selectedModel,
          [...messages, userMsg],
          null,
          (choice: any) => {
            const delta = choice?.delta || {};
            const text = delta?.content || "";
            if (text) {
              setMessages((prev) => {
                const next = [...prev];
                next[draftIndex] = {
                  role: "assistant",
                  content: (next[draftIndex]?.content || "") + text,
                };
                return next;
              });
            }
          },
          {
            onUsage: (u: any) => {
              if (typeof u?.prompt_tokens === "number")
                setLastPromptTokens(u.prompt_tokens);
              if (typeof u?.completion_tokens === "number")
                setLastCompletionTokens(u.completion_tokens);
            },
          }
        );
        // Refresh credits after a call
        try {
          const credits = await client.getCredits();
          setRemainingCredits(credits.remaining);
        } catch (error) {
          console.warn("Sidepanel AI: Failed to refresh credits", error);
        }
        setLoading(false);
        return;
      }

      // Non-streaming with tool calling
      const toolFns = [
        ...(automationEnabled ? OR.AUTOMATION_FUNCTIONS : []),
        ...(((OR as any).TODO_FUNCTIONS as any[]) || []),
        ...(((OR as any).SUMMARIZER_FUNCTIONS as any[]) || []),
      ];
      let convo = [...messages, userMsg];
      setLastPromptTokens(null);
      setLastCompletionTokens(null);
      for (let i = 0; i < 3; i++) {
        const result = await client.chat(selectedModel, convo, toolFns, {});
        const usage =
          (result && (result.usage || result.response?.usage)) || null;
        if (usage) {
          if (typeof usage.prompt_tokens === "number")
            setLastPromptTokens(usage.prompt_tokens);
          if (typeof usage.completion_tokens === "number")
            setLastCompletionTokens(usage.completion_tokens);
        }
        const msg = result?.choices?.[0]?.message;
        if (!msg) break;

        // Tool call path (supports tools API and legacy function_call)
        const toolCalls: any[] = Array.isArray((msg as any)?.tool_calls)
          ? (msg as any).tool_calls
          : (msg as any)?.function_call
          ? [
              {
                type: "function",
                function: {
                  name: (msg as any).function_call.name,
                  arguments: (msg as any).function_call.arguments,
                },
              },
            ]
          : [];

        if (toolCalls.length > 0) {
          for (const call of toolCalls) {
            const fnName = call?.function?.name;
            let args: any = {};
            try {
              args = call?.function?.arguments
                ? JSON.parse(call.function.arguments)
                : {};
            } catch {
              args = {};
            }
            const toolResult = await executeAutomationFunction(fnName, args);
            const autoMsg = buildAutomationMessage(fnName, args, toolResult);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: autoMsg.text,
                automation: autoMsg.meta,
              },
            ]);
            const functionMessage: ChatMessage = {
              role: "function",
              name: fnName,
              content: JSON.stringify(toolResult ?? {}),
            } as any;
            convo = [
              ...convo,
              { role: "assistant", content: "" } as any,
              functionMessage,
            ];
          }
          continue; // ask again with function result(s)
        }

        // Standard assistant response
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: msg.content || "" },
        ]);
        break;
      }
      // Refresh credits after a call
      try {
        const credits = await client.getCredits();
        setRemainingCredits(credits.remaining);
      } catch (error) {
        console.warn("Sidepanel AI: Failed to refresh credits", error);
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${error?.message || String(error)}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // --- Speech to Text ---
  function isWebSpeechSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    );
  }

  function startWebSpeech() {
    setSttError("");
    try {
      const SR: any =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      if (!SR) {
        setSttError("Speech Recognition not supported in this browser");
        return;
      }
      const recognition = new SR();
      recognition.lang = navigator.language || "en-US";
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.onresult = (event: any) => {
        let interim = "";
        let finalText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += transcript;
          else interim += transcript;
        }
        const merged = (finalText || interim).trim();
        if (merged) setInput((prev) => (prev ? prev + " " : "") + merged);
      };
      recognition.onerror = (e: any) => {
        const error = e?.error;
        if (error === "not-allowed") {
          setSttError(
            "Microphone access is blocked. Visit chrome://settings/content/microphone and allow Sidepanel AI, then reload the extension."
          );
        } else if (error === "service-not-allowed") {
          setSttError("Speech service blocked. Check Chrome's site settings.");
        } else {
          setSttError(error || "Speech recognition error");
        }
        setIsRecording(false);
      };
      recognition.onend = () => {
        setIsRecording(false);
      };
      recognitionRef.current = recognition;
      recognition.start();
      setIsRecording(true);
    } catch (e: any) {
      setSttError(e?.message || String(e));
      setIsRecording(false);
    }
  }

  function stopWebSpeech() {
    try {
      recognitionRef.current?.stop?.();
    } catch (e) {
      // ignore
    } finally {
      setIsRecording(false);
    }
  }

  async function startGeminiRecording() {
    setSttError("");
    try {
      if (!geminiApiKey) {
        setSttError("Set Gemini API key in Settings");
        return;
      }
      // Preflight: ensure mic exists
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasMic = devices.some((d) => d.kind === "audioinput");
        if (!hasMic) {
          setSttError("No microphone detected");
          return;
        }
      } catch {
        // ignore, continue to permission request
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        try {
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          await transcribeWithGemini(blob);
        } catch (e: any) {
          setSttError(e?.message || String(e));
        } finally {
          stream.getTracks().forEach((t) => t.stop());
          setIsRecording(false);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setIsRecording(true);
    } catch (e: any) {
      // Common permission errors
      const msg = String(e?.name || e?.message || e);
      if (msg.includes("NotAllowedError")) {
        setSttError("Microphone permission denied");
      } else if (msg.includes("NotFoundError")) {
        setSttError("No microphone found");
      } else if (msg.includes("SecurityError")) {
        setSttError("Microphone blocked by browser settings");
      } else {
        setSttError(e?.message || String(e));
      }
      setIsRecording(false);
    }
  }

  function stopGeminiRecording() {
    try {
      mediaRecorderRef.current?.state === "recording" &&
        mediaRecorderRef.current.stop();
    } catch (e) {
      // ignore
    }
  }

  async function transcribeWithGemini(blob: Blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const base64Audio = btoa(
      String.fromCharCode(...new Uint8Array(arrayBuffer))
    );
    const mime = blob.type || "audio/webm";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(
      geminiApiKey
    )}`;
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Transcribe this audio to plain text without extra commentary.",
            },
            { inlineData: { mimeType: mime, data: base64Audio } },
          ],
        },
      ],
    } as any;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Gemini STT error: ${res.status} ${txt}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (text) setInput((prev) => (prev ? prev + " " : "") + text.trim());
  }

  function toggleRecording() {
    if (isRecording) {
      if (sttProvider === "webspeech") stopWebSpeech();
      else stopGeminiRecording();
      return;
    }
    if (sttProvider === "webspeech") startWebSpeech();
    else startGeminiRecording();
  }

  async function getActiveTabId(): Promise<number | undefined> {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tabs?.[0]?.id as number | undefined;
    } catch {
      return undefined;
    }
  }

  async function executeAutomationFunction(name: string, params: any) {
    const ensureTabId = async (maybeId: any) =>
      typeof maybeId === "number" ? maybeId : await getActiveTabId();
    switch (name) {
      case "summarizer_availability": {
        try {
          const available = typeof (self as any).Summarizer !== "undefined";
          if (!available)
            return { available: false, status: "unavailable" } as any;
          const status = await (self as any).Summarizer.availability?.();
          return { available: status !== "unavailable", status } as any;
        } catch (e: any) {
          return { available: false, error: e?.message || String(e) } as any;
        }
      }
      case "summarizer_create": {
        try {
          if (typeof (self as any).Summarizer === "undefined")
            return {
              success: false,
              error: "Summarizer API not supported",
            } as any;
          if (!navigator.userActivation?.isActive)
            return { success: false, error: "User activation required" } as any;
          const opts: any = {
            type: params?.type,
            length: params?.length,
            format: params?.format,
            sharedContext: params?.sharedContext,
            monitor(m: any) {
              m.addEventListener("downloadprogress", () => {});
            },
          };
          const summarizer = await (self as any).Summarizer.create(opts);
          // Store a weak ref on window for the session
          (window as any).__sidepanelSummarizer = summarizer;
          return { success: true } as any;
        } catch (e: any) {
          return { success: false, error: e?.message || String(e) } as any;
        }
      }
      case "summarizer_summarize": {
        try {
          const text = String(params?.text || "");
          if (!text) return { success: false, error: "Missing text" } as any;
          let summarizer = (window as any).__sidepanelSummarizer;
          if (!summarizer) {
            // Best-effort create with defaults; still requires activation
            if (typeof (self as any).Summarizer === "undefined")
              return {
                success: false,
                error: "Summarizer API not supported",
              } as any;
            if (!navigator.userActivation?.isActive)
              return {
                success: false,
                error: "User activation required",
              } as any;
            summarizer = await (self as any).Summarizer.create({
              type: "key-points",
              length: "medium",
              format: "markdown",
              monitor(m: any) {
                m.addEventListener("downloadprogress", () => {});
              },
            });
            (window as any).__sidepanelSummarizer = summarizer;
          }
          const out = await summarizer.summarize(text, {
            context: params?.context,
          });
          return {
            success: true,
            summary: typeof out === "string" ? out : String(out),
          } as any;
        } catch (e: any) {
          return { success: false, error: e?.message || String(e) } as any;
        }
      }
      case "open_url":
        return await chrome.runtime.sendMessage({
          action: "open_url",
          url: params.url,
          newTab: !!params.newTab,
        });
      case "ebay_search": {
        // Orchestrate the multi-step eBay flow
        const query = String(params.query || "").trim();
        if (!query)
          return {
            success: false,
            error: "Missing query",
            action: "ebay_search",
          } as any;
        const newTab = !!params.newTab;
        const soldOnly = params.soldOnly !== false; // default true
        const condition = String(params.condition || "").toLowerCase();

        // 1) Open eBay
        const open = await chrome.runtime.sendMessage({
          action: "open_url",
          url: "https://www.ebay.com/",
          newTab,
        });
        // Use active tab after navigation
        const tabId = await getActiveTabId();
        if (!tabId || open?.success === false) return open;

        // 2) Wait for search input
        const waitedInput = await chrome.runtime.sendMessage({
          action: "wait_for_element",
          selector: "#gh-ac",
          tabId,
          timeout: 20000,
        });
        if (waitedInput?.success === false) return waitedInput;

        // 3) Type query
        const typed = await chrome.runtime.sendMessage({
          action: "type_text",
          selector: "#gh-ac",
          text: query,
          tabId,
        });
        if (typed?.success === false) return typed;

        // 4) Click search button
        const waitedBtn = await chrome.runtime.sendMessage({
          action: "wait_for_element",
          selector: "#gh-search-btn",
          tabId,
          timeout: 15000,
        });
        if (waitedBtn?.success === false) return waitedBtn;
        const clicked = await chrome.runtime.sendMessage({
          action: "click_element",
          selector: "#gh-search-btn",
          tabId,
        });
        if (clicked?.success === false) return clicked;

        // 5) Wait for results
        const waitedResults = await chrome.runtime.sendMessage({
          action: "wait_for_element",
          selector: "#srp-river-results",
          tabId,
          timeout: 25000,
        });
        if (waitedResults?.success === false) return waitedResults;

        if (soldOnly) {
          // 6) Apply Sold Items filter
          const soldSelector =
            'li[name="LH_Sold"] a.x-refine__multi-select-link';
          const waitedSold = await chrome.runtime.sendMessage({
            action: "wait_for_element",
            selector: soldSelector,
            tabId,
            timeout: 15000,
          });
          if (waitedSold?.success === false) return waitedSold;
          const clickedSold = await chrome.runtime.sendMessage({
            action: "click_element",
            selector: soldSelector,
            tabId,
          });
          if (clickedSold?.success === false) return clickedSold;
          // 7) Confirm reload
          const waitedFiltered = await chrome.runtime.sendMessage({
            action: "wait_for_element",
            selector: "#srp-river-results",
            tabId,
            timeout: 25000,
          });
          if (waitedFiltered?.success === false) return waitedFiltered;
        }

        // 8) Apply Condition filter if requested
        if (condition && condition !== "any") {
          // Open the condition flyout menu button
          const conditionButtonSelector =
            '[data-testid="condition_menu"] .fake-menu-button__button';
          const waitedCondBtn = await chrome.runtime.sendMessage({
            action: "wait_for_element",
            selector: conditionButtonSelector,
            tabId,
            timeout: 15000,
          });
          if (waitedCondBtn?.success === false) return waitedCondBtn;
          const clickedCondBtn = await chrome.runtime.sendMessage({
            action: "click_element",
            selector: conditionButtonSelector,
            tabId,
          });
          if (clickedCondBtn?.success === false) return clickedCondBtn;

          // Map condition to menu item label and/or URL param values
          const conditionToPredicate = {
            new: "New",
            open_box: "Open box",
            ebay_refurbished: "eBay Refurbished",
            used: "Used",
            for_parts: "For parts or not working",
          } as Record<string, string>;
          const targetLabel = conditionToPredicate[condition];

          if (targetLabel) {
            // Wait for the flyout menu content to render
            const menuContentSelector =
              '[data-testid="condition_menu"] .fake-menu-button__menu a.fake-menu-button__item';
            const waitedMenu = await chrome.runtime.sendMessage({
              action: "wait_for_element",
              selector: menuContentSelector,
              tabId,
              timeout: 15000,
            });
            if (waitedMenu?.success === false) return waitedMenu;

            // Click the specific condition item by matching textContent
            const clickByLabel = await chrome.scripting.executeScript({
              target: { tabId },
              func: (label, menuSel) => {
                const items = Array.from(document.querySelectorAll(menuSel));
                const found = items.find((el) =>
                  (el.textContent || "")
                    .trim()
                    .toLowerCase()
                    .includes(label.toLowerCase())
                );
                if (found) {
                  (found as HTMLElement).click();
                  return { success: true };
                }
                return {
                  success: false,
                  error: `Condition option not found: ${label}`,
                };
              },
              args: [targetLabel, menuContentSelector],
            });
            const condRes = clickByLabel?.[0]?.result || { success: false };
            if (condRes?.success === false)
              return { action: "ebay_search", ...condRes } as any;

            // Wait for results refresh
            const waitedCondFiltered = await chrome.runtime.sendMessage({
              action: "wait_for_element",
              selector: "#srp-river-results",
              tabId,
              timeout: 25000,
            });
            if (waitedCondFiltered?.success === false)
              return waitedCondFiltered;
          }
        }

        return {
          success: true,
          action: "ebay_search",
          params: { query, soldOnly, condition, newTab },
          data: true,
        } as any;
      }
      case "click_element":
        return await chrome.runtime.sendMessage({
          action: "click_element",
          selector: params.selector,
          tabId: await ensureTabId(params.tabId),
        });
      case "type_text":
        return await chrome.runtime.sendMessage({
          action: "type_text",
          selector: params.selector,
          text: params.text,
          tabId: await ensureTabId(params.tabId),
        });
      case "get_page_content":
        return await chrome.runtime.sendMessage({
          action: "get_page_content",
          tabId: await ensureTabId(params.tabId),
          includeForms: params.includeForms,
        });
      case "wait_for_element":
        return await chrome.runtime.sendMessage({
          action: "wait_for_element",
          selector: params.selector,
          tabId: await ensureTabId(params.tabId),
          timeout: params.timeout,
        });
      // --- TODO tool dispatch ---
      case "todo_create":
        return await chrome.runtime.sendMessage({
          action: "todo_create",
          title: params.title,
          notes: params.notes,
          priority: params.priority,
          dueAt: params.dueAt,
          session: params.session,
        });
      case "todo_list":
        return await chrome.runtime.sendMessage({
          action: "todo_list",
          session: params.session,
        });
      case "todo_update":
        return await chrome.runtime.sendMessage({
          action: "todo_update",
          id: params.id,
          title: params.title,
          notes: params.notes,
          priority: params.priority,
          dueAt: params.dueAt,
          session: params.session,
        });
      case "todo_set_status":
        return await chrome.runtime.sendMessage({
          action: "todo_set_status",
          id: params.id,
          done: !!params.done,
          session: params.session,
        });
      case "todo_delete":
        return await chrome.runtime.sendMessage({
          action: "todo_delete",
          id: params.id,
          session: params.session,
        });
      case "todo_clear":
        return await chrome.runtime.sendMessage({
          action: "todo_clear",
          session: params.session,
          onlyDone: params.onlyDone !== false,
        });
      case "todo_summary":
        return await chrome.runtime.sendMessage({
          action: "todo_summary",
          session: params.session,
        });
      case "sheets_read_range":
        return await chrome.runtime.sendMessage({
          action: "sheets_read_range",
          spreadsheetId: params.spreadsheetId,
          range: params.range,
        });
      case "sheets_write_range":
        return await chrome.runtime.sendMessage({
          action: "sheets_write_range",
          spreadsheetId: params.spreadsheetId,
          range: params.range,
          values: params.values,
          valueInputOption: params.valueInputOption,
        });
      case "sheets_append_rows":
        return await chrome.runtime.sendMessage({
          action: "sheets_append_rows",
          spreadsheetId: params.spreadsheetId,
          range: params.range,
          values: params.values,
          valueInputOption: params.valueInputOption,
        });
      case "sheets_append_page_summary":
        return await chrome.runtime.sendMessage({
          action: "sheets_append_page_summary",
          spreadsheetId: params.spreadsheetId,
          sheetName: params.sheetName,
          valueInputOption: params.valueInputOption,
        });
      case "fetch_prices":
        return await chrome.runtime.sendMessage({
          action: "fetch_prices",
          query: params.query,
          maxResults: params.maxResults,
          newTab: params.newTab,
          includeUsed: params.includeUsed,
        });
      case "upc_lookup":
        return await chrome.runtime.sendMessage({
          action: "upc_lookup",
          query: params.query,
          maxResults: params.maxResults,
          newTab: params.newTab,
        });
      default:
        return { error: `Unknown function: ${name}` };
    }
  }

  // Removed quick action helper; actions should appear via chat

  return (
    <div className="w-full h-screen bg-background flex flex-col">
      {/* Header */}
      <Card className="rounded-none border-x-0 border-t-0">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center justify-center">
              <img
                src="/icons/icon.svg"
                alt="OpenRouter Logo"
                className="h-8 w-auto"
              />
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSettingsOpen(true)}
              className="h-8 w-8 p-0"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Context summary removed to keep all actions/responses inside chat */}

      {/* Chat */}
      <div className="flex-1 flex flex-col p-4 space-y-4 overflow-hidden">
        <div ref={listRef} className="flex-1 overflow-y-auto space-y-3 pr-1">
          {messages.map((m, idx) => (
            <Card
              key={idx}
              className={
                m.role === "assistant"
                  ? "ml-auto bg-muted"
                  : "bg-primary/5 border-primary/20 max-w-[85%]"
              }
            >
              <CardContent className="p-3">
                {m.automation?.isAutomation ? (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 text-sm">
                      {m.automation?.success === true ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                      ) : m.automation?.success === false ? (
                        <XCircle className="h-4 w-4 text-red-600 mt-0.5" />
                      ) : (
                        <Info className="h-4 w-4 text-blue-600 mt-0.5" />
                      )}
                      <span className="whitespace-pre-wrap break-words">
                        {m.content}
                      </span>
                    </div>
                    {debugMode && (
                      <pre className="text-xs bg-background/50 border rounded p-2 overflow-auto max-h-48">
                        {JSON.stringify(m.automation?.debug ?? {}, null, 2)}
                      </pre>
                    )}
                  </div>
                ) : (
                  <div className="text-sm prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {m.content}
                    </ReactMarkdown>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {loading && (
            <Card className="ml-auto bg-muted">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-sm opacity-70">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Thinking</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-2">
          {/* Usage / Balance line */}
          <div className="text-xs text-muted-foreground flex items-center gap-3 pl-1">
            {lastPromptTokens != null || lastCompletionTokens != null ? (
              <span>
                {lastPromptTokens != null ? `in: ${lastPromptTokens}` : ""}
                {lastPromptTokens != null && lastCompletionTokens != null
                  ? " · "
                  : ""}
                {lastCompletionTokens != null
                  ? `out: ${lastCompletionTokens}`
                  : ""}
              </span>
            ) : null}
            {remainingCredits != null ? (
              <span title="Remaining OpenRouter credits">
                balance: ${remainingCredits.toFixed(2)}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={model}
              onValueChange={(v) => {
                setModel(v);
                chrome.storage.local.set({ preferred_model: v });
              }}
            >
              <SelectTrigger className="w-60">
                <SelectValue placeholder="Auto Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto Select</SelectItem>
                {models.map((m) => (
                  <SelectItem key={uiModelLabel(m)} value={uiModelLabel(m)}>
                    {uiModelLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={!stream ? "default" : "secondary"}
              size="sm"
              onClick={() => {
                const nv = !stream;
                setStream(nv);
                chrome.storage.local.set({ stream_enabled: nv });
              }}
            >
              {!stream ? "Agentic" : "Streaming"}
            </Button>
          </div>

          <div className="relative w-full">
            <Input
              type="text"
              placeholder={
                hasKey
                  ? "Ask me anything..."
                  : "Enter API key in settings to start"
              }
              className="w-full pr-32 h-12"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) handleSend();
              }}
              disabled={!hasKey || loading}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex space-x-1">
              <Button
                variant={isRecording ? "destructive" : "secondary"}
                size="sm"
                onClick={toggleRecording}
                disabled={
                  loading ||
                  (sttProvider === "webspeech" && !isWebSpeechSupported())
                }
                title={
                  sttProvider === "webspeech"
                    ? isWebSpeechSupported()
                      ? isRecording
                        ? "Stop listening"
                        : "Start voice input (Web Speech)"
                      : "Web Speech API not supported"
                    : isRecording
                    ? "Stop recording"
                    : "Start voice input (Gemini)"
                }
                className="h-8"
              >
                {isRecording ? (
                  <Square className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="sm"
                onClick={handleSend}
                disabled={!hasKey || loading}
                className="h-8"
              >
                Send
              </Button>
            </div>
          </div>
          {(isRecording || sttError) && (
            <div className="text-xs text-muted-foreground pl-1">
              {isRecording
                ? sttProvider === "webspeech"
                  ? "Listening..."
                  : "Recording..."
                : null}
              {sttError ? (isRecording ? " • " : "") + sttError : null}
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal (simple) */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card border rounded-lg w-[520px] max-w-[90vw] p-4 space-y-3 shadow-lg">
            <div className="text-lg font-semibold">Settings</div>
            <div className="space-y-2">
              <label className="text-sm">OpenRouter API Key</label>
              <Input
                type="password"
                placeholder="sk-or-v1-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Voice Input</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-sm">STT Provider</label>
                  <Select
                    value={sttProvider}
                    onValueChange={(v: any) => setSttProvider(v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="webspeech">
                        Web Speech (free)
                      </SelectItem>
                      <SelectItem value="gemini">Gemini (API key)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {sttProvider === "gemini" && (
                  <div>
                    <label className="text-sm">Gemini API Key</label>
                    <Input
                      type="password"
                      placeholder="AIza..."
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Web Speech is free and local. Gemini may incur costs but is
                reliable.
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Automation Safety</div>
              <div className="flex items-center gap-2 text-sm">
                <input
                  id="allowAll"
                  type="checkbox"
                  checked={allowAllAutomation}
                  onChange={(e) => setAllowAllAutomation(e.target.checked)}
                />
                <label htmlFor="allowAll">
                  Allow all domains (disable whitelist)
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className="text-sm">
                    Domain whitelist (comma-separated)
                  </label>
                  <Input
                    placeholder="example.com, github.com"
                    value={automationWhitelist}
                    onChange={(e) => setAutomationWhitelist(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm">Rate limit per 30s</label>
                  <Input
                    type="number"
                    min={1}
                    value={automationRateLimit}
                    onChange={(e) =>
                      setAutomationRateLimit(Number(e.target.value || 1))
                    }
                  />
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Actions are restricted to HTTP(S) pages. Sensitive form values
                are redacted from context.
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Keyboard Shortcuts</div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Open extension: Click the toolbar icon.</div>
                <div>
                  Set your own shortcut: chrome://extensions/shortcuts →
                  "Sidepanel AI".
                </div>
                <div>Send message: Enter</div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setIsSettingsOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={saveSettings}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
