// OpenRouter API Client for Sidepanel AI

class OpenRouterClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = "https://openrouter.ai/api/v1";
    this.models = null;
  }

  async chat(model, messages, functions = null, options = {}) {
    const payload = {
      model: model,
      messages: messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 1000,
      // Ask OpenRouter to include usage in the response if supported
      usage: { include: true },
      ...options,
    };

    // Migrate deprecated functions to tools API
    if (functions && functions.length > 0) {
      payload.tools = functions.map((f) => ({
        type: "function",
        function: {
          name: f.name,
          description: f.description,
          parameters: f.parameters,
        },
      }));
      if (options.functionCall) {
        payload.tool_choice =
          options.functionCall === "auto"
            ? "auto"
            : { type: "function", function: { name: options.functionCall } };
      } else {
        payload.tool_choice = "auto";
      }
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": chrome.runtime.getURL(""),
        "X-Title": "Sidepanel AI",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const result = await response.json();
    return result;
  }

  async chatWithStreaming(
    model,
    messages,
    functions = null,
    onChunk = null,
    options = {}
  ) {
    const payload = {
      model: model,
      messages: messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 1000,
      stream: true,
      // Ask OpenRouter to include usage in the final stream event if supported
      usage: { include: true },
      ...options,
    };

    // Use tools API for streaming as well
    if (functions && functions.length > 0) {
      payload.tools = functions.map((f) => ({
        type: "function",
        function: {
          name: f.name,
          description: f.description,
          parameters: f.parameters,
        },
      }));
      payload.tool_choice = options.functionCall || "auto";
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": chrome.runtime.getURL(""),
        "X-Title": "Sidepanel AI",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep incomplete line for next iteration

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;

          try {
            const chunk = JSON.parse(data);
            // If the provider includes usage in any streamed frame, surface it via optional callback
            const maybeUsage =
              chunk?.usage || chunk?.response?.usage || chunk?.x_usage || null;
            if (maybeUsage && typeof options.onUsage === "function") {
              try {
                options.onUsage(maybeUsage);
              } catch (_) {}
            }
            if (onChunk && chunk.choices && chunk.choices[0]) {
              onChunk(chunk.choices[0]);
            }
          } catch (e) {
            // Ignore parsing errors for now
          }
        }
      }
    }
  }

  // Fetch remaining credits and usage from OpenRouter
  async getCredits() {
    const response = await fetch(`${this.baseUrl}/credits`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": chrome.runtime.getURL(""),
        "X-Title": "Sidepanel AI",
      },
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }
    const json = await response.json();
    // Return normalized shape
    const data = json?.data || {};
    return {
      totalCredits: Number(data.total_credits ?? 0),
      totalUsage: Number(data.total_usage ?? 0),
      remaining: Math.max(
        0,
        Number(data.total_credits ?? 0) - Number(data.total_usage ?? 0)
      ),
    };
  }

  async listModels() {
    if (this.models) {
      return this.models;
    }

    const response = await fetch(`${this.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const result = await response.json();
    this.models = result.data;
    return this.models;
  }

  async getModelInfo(modelId) {
    const models = await this.listModels();
    return models.find((model) => model.id === modelId);
  }

  // Intelligent model selection based on task requirements
  async selectModelForTask(taskType, context = {}) {
    const models = await this.listModels();

    // Define model preferences based on task type
    const modelPreferences = {
      coding: [
        "anthropic/claude-3-opus",
        "openai/gpt-4",
        "anthropic/claude-3-sonnet",
      ],
      analysis: [
        "anthropic/claude-3-opus",
        "openai/gpt-4-turbo",
        "anthropic/claude-3-sonnet",
      ],
      creative: [
        "anthropic/claude-3-sonnet",
        "openai/gpt-4",
        "anthropic/claude-3-haiku",
      ],
      quick: [
        "anthropic/claude-3-haiku",
        "openai/gpt-3.5-turbo",
        "meta-llama/llama-2-70b-chat",
      ],
      automation: [
        "anthropic/claude-3-sonnet",
        "openai/gpt-4",
        "anthropic/claude-3-opus",
      ],
    };

    const preferences = modelPreferences[taskType] || modelPreferences["quick"];

    // Find the first available preferred model
    for (const modelId of preferences) {
      const model = models.find((m) => m.id === modelId);
      if (model) {
        return model;
      }
    }

    // Fallback to first available model
    return models[0];
  }

  // Estimate cost for a request
  estimateCost(model, inputTokens, outputTokens = 0) {
    const pricing = model.pricing;
    if (!pricing) return null;

    const inputCost = (inputTokens * pricing.prompt) / 1000;
    const outputCost = (outputTokens * pricing.completion) / 1000;

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: "USD",
    };
  }

  // Validate API key
  async validateApiKey() {
    try {
      await this.listModels();
      return true;
    } catch (error) {
      return false;
    }
  }
}

// Automation functions for web interactions
const AUTOMATION_FUNCTIONS = [
  {
    name: "open_url",
    description: "Navigate to a specific URL in the browser",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to navigate to",
        },
        newTab: {
          type: "boolean",
          description: "Whether to open in a new tab",
          default: false,
        },
      },
      required: ["url"],
    },
  },
  {
    name: "ebay_search",
    description:
      "Open eBay, search for a term, and optionally filter to Sold items",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to enter into eBay's search box",
        },
        soldOnly: {
          type: "boolean",
          description: "If true, apply the Sold Items filter",
          default: true,
        },
        condition: {
          type: "string",
          enum: [
            "any",
            "new",
            "open_box",
            "ebay_refurbished",
            "used",
            "for_parts",
          ],
          description:
            "Item condition to filter by (any, new, open_box, ebay_refurbished, used, for_parts)",
        },
        newTab: {
          type: "boolean",
          description: "Whether to open search in a new tab",
          default: false,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_prices",
    description:
      "Search the web (Google Shopping) for current prices for a product. If query is omitted, use the active tab's title. Returns a list of offers.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Product name or description to search for",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of offers to return",
          default: 5,
        },
        sources: {
          type: "array",
          description:
            "Optional list of stores to search directly instead of Google Shopping.",
          items: {
            type: "string",
            enum: ["amazon", "bestbuy", "walmart", "newegg", "bh", "target"],
          },
        },
        maxPerSource: {
          type: "number",
          description:
            "Max results to collect per source when sources are provided",
          default: 3,
        },
        newTab: {
          type: "boolean",
          description: "Whether to open search in a new tab",
          default: true,
        },
        includeUsed: {
          type: "boolean",
          description: "Include used/refurb listings when available",
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: "upc_lookup",
    description:
      "Search upcitemdb.com for UPC/EAN/ISBN codes by product name and return normalized matches.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Product name to search on upcitemdb.com",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of codes to return",
          default: 10,
        },
        newTab: {
          type: "boolean",
          description: "Whether to open the search in a new tab",
          default: true,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "click_element",
    description: "Click on an element by CSS selector",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the element to click",
        },
        tabId: {
          type: "number",
          description: "ID of the tab to perform action in",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "type_text",
    description: "Type text into an input element",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the input element",
        },
        text: {
          type: "string",
          description: "Text to type into the element",
        },
        tabId: {
          type: "number",
          description: "ID of the tab to perform action in",
        },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "get_page_content",
    description: "Extract visible content and interactive elements from a page",
    parameters: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "ID of the tab to extract content from",
        },
        includeForms: {
          type: "boolean",
          description: "Whether to include form elements in the extraction",
          default: true,
        },
      },
      // tabId optional; we will fall back to the active tab
      required: [],
    },
  },
  {
    name: "wait_for_element",
    description: "Wait for an element to appear on the page",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the element to wait for",
        },
        tabId: {
          type: "number",
          description: "ID of the tab to check",
        },
        timeout: {
          type: "number",
          description: "Maximum time to wait in milliseconds",
          default: 10000,
        },
      },
      // tabId optional; we will fall back to the active tab
      required: ["selector"],
    },
  },
  {
    name: "sheets_read_range",
    description:
      "Read values from a Google Sheet range. If spreadsheetId omitted, infer from active Sheets tab.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "Google Spreadsheet ID (optional)",
        },
        range: {
          type: "string",
          description: "A1 notation range, e.g. Sheet1!A1:C10",
        },
      },
      required: ["range"],
    },
  },
  {
    name: "sheets_write_range",
    description:
      "Overwrite a range with values in a Google Sheet. If spreadsheetId omitted, infer from active Sheets tab.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "Google Spreadsheet ID (optional)",
        },
        range: {
          type: "string",
          description: "A1 notation range, e.g. Sheet1!A1:C10",
        },
        values: {
          type: "array",
          items: {
            type: "array",
            items: { type: ["string", "number", "null"] },
          },
          description: "2D array of values (rows)",
        },
        valueInputOption: {
          type: "string",
          enum: ["RAW", "USER_ENTERED"],
          default: "RAW",
        },
      },
      required: ["range", "values"],
    },
  },
  {
    name: "sheets_append_rows",
    description:
      "Append rows to a Google Sheet range. If spreadsheetId omitted, infer from active Sheets tab.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "Google Spreadsheet ID (optional)",
        },
        range: {
          type: "string",
          description: "A1 notation range, usually Sheet1!A:Z",
        },
        values: {
          type: "array",
          items: {
            type: "array",
            items: { type: ["string", "number", "null"] },
          },
          description: "2D array of values (rows)",
        },
        valueInputOption: {
          type: "string",
          enum: ["RAW", "USER_ENTERED"],
          default: "RAW",
        },
      },
      required: ["range", "values"],
    },
  },
  {
    name: "sheets_append_page_summary",
    description:
      "Append a row with the active tab's page summary (title, URL, excerpt, words, score, timestamp) to the given sheet.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "Google Spreadsheet ID (optional)",
        },
        sheetName: {
          type: "string",
          description: "Target sheet/tab name (default Sheet1)",
        },
        valueInputOption: {
          type: "string",
          enum: ["RAW", "USER_ENTERED"],
          default: "RAW",
        },
      },
      required: [],
    },
  },
];

// TODO/checklist tools for model self-management
const TODO_FUNCTIONS = [
  {
    name: "todo_create",
    description:
      "Create a TODO item to track a subtask or step toward the current goal.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short actionable task name" },
        notes: { type: "string", description: "Optional details/acceptance" },
        session: {
          type: "string",
          description:
            "Logical session/group key. Omit to use default session.",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Task priority",
        },
        dueAt: {
          type: "number",
          description: "Optional due timestamp in ms since epoch",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "todo_list",
    description: "List TODOs in the current session.",
    parameters: {
      type: "object",
      properties: {
        session: {
          type: "string",
          description: "Session key. Omit for default session.",
        },
      },
      required: [],
    },
  },
  {
    name: "todo_update",
    description: "Update fields on a TODO by id.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        dueAt: { type: "number" },
        session: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "todo_set_status",
    description: "Mark a TODO done or not done.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        done: { type: "boolean" },
        session: { type: "string" },
      },
      required: ["id", "done"],
    },
  },
  {
    name: "todo_delete",
    description: "Delete a TODO by id.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        session: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "todo_clear",
    description:
      "Clear TODOs in a session. Optionally only remove completed items.",
    parameters: {
      type: "object",
      properties: {
        session: { type: "string" },
        onlyDone: { type: "boolean", default: true },
      },
      required: [],
    },
  },
  {
    name: "todo_summary",
    description:
      "Summarize TODOs: counts by status/priority and next actionable item.",
    parameters: {
      type: "object",
      properties: {
        session: { type: "string" },
      },
      required: [],
    },
  },
];

// Chrome Built-in AI: Summarizer API tools
// These tools allow the model to request on-device summarization when available.
// Actual execution happens in the UI layer via executeAutomationFunction.
const SUMMARIZER_FUNCTIONS = [
  {
    name: "summarizer_availability",
    description:
      "Check if Chrome Summarizer API is usable on this device and context.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "summarizer_create",
    description:
      "Create or ensure a Summarizer instance with options (type, length, format, sharedContext). Requires user activation.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["key-points", "tldr", "teaser", "headline"],
          description: "Summary type",
        },
        length: {
          type: "string",
          enum: ["short", "medium", "long"],
          description: "Desired length",
        },
        format: {
          type: "string",
          enum: ["markdown", "plain-text"],
          description: "Output format",
        },
        sharedContext: {
          type: "string",
          description: "Shared context for the summarizer",
        },
      },
      required: [],
    },
  },
  {
    name: "summarizer_summarize",
    description:
      "Summarize provided text using on-device Summarizer. Falls back is handled by caller if not available.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to summarize" },
        context: {
          type: "string",
          description: "Optional per-request context",
        },
      },
      required: ["text"],
    },
  },
];

export {
  OpenRouterClient,
  AUTOMATION_FUNCTIONS,
  TODO_FUNCTIONS,
  SUMMARIZER_FUNCTIONS,
};
