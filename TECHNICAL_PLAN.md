# Sidepanel AI - Technical Plan

## Project Overview

Sidepanel AI is a Chrome extension that provides an AI-powered chat interface in the browser's sidepanel. The extension intelligently accesses and utilizes context from all open tabs to enhance AI conversations through OpenRouter.ai, enabling web automation capabilities.

### Key Features

- **Sidepanel Integration**: Native Chrome sidepanel UI for seamless workflow
- **Tab Context Awareness**: Access to content, URLs, and metadata from all open tabs
- **OpenRouter Integration**: Access to multiple AI models through OpenRouter.ai
- **Web Automation**: AI can open URLs, click elements, type text, and interact with web pages
- **Privacy-Focused**: Local processing with user-controlled data sharing
- **Entry Points & Shortcuts**: Context menus and keyboard shortcuts for fast actions
- **Media Summarization**: YouTube and PDF extraction & summarization
- **Cross-Tab Retrieval**: Rank relevant tab contexts to ground responses

## Architecture

### Core Components

```
├── Background Service Worker
│   ├── Tab Context Manager
│   ├── AI Model Router
│   ├── Web Automation Service
│   ├── Entry Points (Context Menus, Commands, Omnibox)
│   └── Storage Manager
├── Sidepanel UI
│   ├── Chat Interface
│   ├── Model Selector
│   ├── Quick Actions (Summarize page, Ask selection, Automate task)
│   └── Context Viewer
├── Content Scripts
│   ├── Tab Content Extractor
│   ├── Web Interaction Handler
│   └── Selection Bridge
└── Shared Utilities
    ├── AI API Clients
    ├── Web Automation Tools
    ├── Context Analyzers & Retrievers
    └── Security Validators
```

### Data Flow

1. **Context Collection**: Content scripts extract relevant data from active tabs
2. **Context Processing**: Background service processes and sanitizes tab data
3. **Query Analysis**: User input analyzed to determine optimal OpenRouter model and automation needs
4. **Model Selection**: Intelligent selection of appropriate model based on task requirements
5. **Tool Calling**: AI determines if web automation tools are needed
6. **Automation Execution**: Web Automation Service executes browser interactions if required
7. **Retrieval**: Rank and select top‑k tab contexts (and selection) to condition the model
8. **API Communication**: Secure communication with OpenRouter API
9. **Response Processing**: AI responses and automation results formatted and displayed in sidepanel

## Manifest V3 Configuration

### Required Permissions

```json
{
  "manifest_version": 3,
  "name": "Sidepanel AI",
  "version": "1.0.0",
  "permissions": [
    "sidePanel",
    "tabs",
    "activeTab",
    "storage",
    "scripting",
    "contextMenus",
    "commands"
  ],
  "host_permissions": ["<all_urls>"],
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' https://openrouter.ai"
  },
  "side_panel": {
    "default_path": "sidepanel/index.html"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "commands": {
    "open_sidepanel": {
      "description": "Open Sidepanel AI"
    },
    "summarize_page": {
      "description": "Summarize current page"
    },
    "ask_selection": {
      "description": "Ask about current selection"
    }
  }
}
```

### Sidepanel Configuration

- **Default Path**: `sidepanel/index.html`
- **Open Behavior**: Accessible via browser action or keyboard shortcut
- **Context Menu Integration**: "Ask AI about this page/selection" options

## Tab Context System

### Context Types

1. **Page Content**: Main article text, headings, and structured content
2. **Page Metadata**: Title, URL, description, keywords
3. **User Selections**: Highlighted text and selected elements
4. **Navigation History**: Recent browsing patterns
5. **Tab Relationships**: Related tabs in the same window

### Context Extraction Strategy

```javascript
// Content Script - context-extractor.js
class TabContextExtractor {
  extractPageContent() {
    // Remove scripts, styles, and navigation elements
    // Extract main content using readability algorithms
    // Identify key sections and headings
  }

  extractMetadata() {
    // Get page title, meta tags, canonical URL
    // Extract OpenGraph and Twitter Card data
  }

  monitorUserInteractions() {
    // Track text selections and clicks
    // Monitor scroll position and reading patterns
  }
}
```

### Context Processing Pipeline

1. **Raw Data Collection**: Gather all available context from active tabs
2. **Content Filtering**: Remove sensitive data and irrelevant content
3. **Relevance Scoring**: Rank context based on recency and user interaction
4. **Retrieval**: Score per‑tab summaries and selections, pick top‑k
5. **Summarization**: Condense large content into digestible chunks
6. **Security Sanitization**: Strip potentially harmful data

## OpenRouter AI Integration

### API Integration

```javascript
// OpenRouter API Client
class OpenRouterClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = "https://openrouter.ai/api/v1";
  }

  async chat({
    model,
    messages,
    tools,
    toolChoice = "auto",
    temperature = 0.7,
  }) {
    const payload = {
      model,
      messages,
      temperature,
      ...(tools && tools.length ? { tools, tool_choice: toolChoice } : {}),
    };

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

    if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);
    return await response.json();
  }
}
```

### Model Selection Strategy

Since OpenRouter provides access to multiple models through a unified API, the extension uses intelligent model selection based on:

- **Task Type**: Different models excel at different tasks (coding, analysis, creative writing)
- **Context Size**: Models have varying context window limits
- **Response Speed**: Faster models for quick interactions, slower but better models for complex tasks
- **Cost Efficiency**: Balance between quality and API costs

### Key Integration Points

- **Tool Calling**: OpenRouter supports tool calling for web automation
- **Streaming**: Real-time response streaming for better user experience
- **Model Discovery**: Dynamic model availability through OpenRouter's API
- **Unified Authentication**: Single API key for all supported models

## Web Automation System

### Automation Capabilities

1. **URL Navigation**: Open URLs in current or new tabs
2. **Element Interaction**: Click buttons, links, and interactive elements
3. **Text Input**: Type text into form fields and inputs
4. **Page Content Analysis**: Extract visible text and interactive elements
5. **Element Detection**: Wait for elements to appear on pages

### Tool Calling Integration

```javascript
// Web Automation Tools (OpenAI-compatible tools schema)
const AUTOMATION_TOOLS = [
  {
    type: "function",
    function: {
      name: "open_url",
      description: "Navigate to a specific URL",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          newTab: { type: "boolean", default: false },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "click_element",
      description: "Click on an element by CSS selector",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          tabId: { type: "number" },
        },
        required: ["selector"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Type text into an input element",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          text: { type: "string" },
          tabId: { type: "number" },
        },
        required: ["selector", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_page_content",
      description: "Extract visible content and interactive elements",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number" },
          includeForms: { type: "boolean", default: true },
        },
      },
    },
  },
];
```

### Automation Flow

1. **Intent Detection**: AI analyzes user query for automation requirements
2. **Tool Selection**: Determine appropriate web automation tools
3. **Safety Checks**: Validate actions against security policies
4. **Execution**: Perform browser interactions via Chrome APIs
5. **Result Processing**: Format automation results for user feedback
6. **Error Handling**: Graceful failure recovery and user notification
7. **Audit Logging**: Store recent actions (domain, action, timestamp) locally

### Safety Measures

- **Domain Whitelisting**: Restrict automation to approved domains
- **Rate Limiting**: Prevent excessive automated interactions
- **User Confirmation**: Require explicit consent for sensitive actions
- **Audit Logging**: Track all automation activities
- **Timeout Protection**: Prevent infinite waiting states

## Entry Points & Quick Actions

### Context Menus

- Page: "Ask AI about this page"
- Selection: "Ask AI about selection"
- Actions seed an initial prompt and open the sidepanel

### Keyboard Shortcuts (Commands)

- `open_sidepanel`: Open the sidepanel
- `summarize_page`: Seed "Summarize this page" prompt
- `ask_selection`: Ask about current selection (requests selection from content script)

### Quick Actions (Sidepanel UI)

- Summarize Page
- Ask about Selection
- Automate Task (enables tool calling)

## Media Extraction

### YouTube

- Detect YouTube pages and attempt transcript extraction from DOM
- Fallback: timed text tracks when available
- Provide a "Summarize video" quick action

### PDF

- Integrate `pdfjs-dist` via worker to extract text client-side
- Paginate large PDFs and stream summaries

## Retrieval Across Tabs

- Maintain per-tab summaries in background
- Score by recency, interaction, and keyword overlap
- Select top‑k to prepend to the system prompt

## Persistence & Security

- Conversation history in IndexedDB (optional), with pin/star
- Configurable redaction patterns and context security filters
- Automation activity log (latest N actions)

## UI Components

### Sidepanel Layout

```
┌─────────────────────────────────┐
│ ┌─ Model Selector ─┐ ┌─ Settings┐ │
│ │ Auto ▾           │ │ ⚙️       │ │
│ └──────────────────┘ └─────────┘ │
├─────────────────────────────────┤
│ ┌─ Context Summary ────────────┐ │
│ │ 📄 Current Tab: example.com   │ │
│ │ 📊 2.3K words • 5 sections    │ │
│ │ 💡 Key topics: React, API... │ │
│ └──────────────────────────────┘ │
├─────────────────────────────────┤
│ ┌─ Chat Interface ─────────────┐ │
│ │ You: How does React work?    │ │
│ │                              │ │
│ │ AI: React is a JavaScript... │ │
│ │                              │ │
│ │ ┌─ Message Input ──────────┐ │ │
│ │ │ Ask me anything...       │ │ │
│ │ └─────────────────────────┘ │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

### Key UI Features

- Collapsible Context Panel
- Message Threading with context references
- Model Info/Confidence Indicator
- Quick Actions & Automation Toggle

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)

- [x] Set up manifest v3 project structure with automation permissions
- [x] Implement basic sidepanel UI
- [x] Create tab context extraction system
- [x] Build background service worker framework
- [x] Add web automation service foundation

### Phase 2: OpenRouter Integration (Week 3-4)

- [x] Implement OpenRouter API client with tool calling and streaming support
- [x] Build model selection logic for OpenRouter models
- [x] Create intelligent model routing based on task requirements
- [x] Add OpenRouter API key management system
- [x] Implement web automation tool definitions (open_url, click_element, type_text, get_page_content, wait_for_element)

### Phase 3: Context Processing (Week 5-6)

- [x] Enhance content extraction algorithms (baseline extractor in content script)
- [x] Implement context summarization (background summary endpoint)
- [x] Add relevance scoring system (simple recency/selection/length scoring)
- [ ] Build context security filters (extendable redact patterns)

### Phase 4: Entry Points & Quick Actions (Week 6-7)

- [ ] Add context menus for page/selection and seed prompts
- [ ] Add keyboard shortcuts (commands) for open/summarize/ask selection
- [ ] Implement selection bridge from content script to sidepanel
- [ ] Add Quick Actions to sidepanel header

### Phase 5: Media & Retrieval (Week 7-8)

- [ ] Add YouTube transcript extraction and "Summarize video" action
- [ ] Add PDF text extraction using `pdfjs-dist` worker
- [ ] Implement cross‑tab retrieval (top‑k summaries into system prompt)

### Phase 6: Automation UX & Persistence (Week 8-9)

- [ ] Normalize automation results, add human‑readable summaries
- [ ] Activity log for automation actions
- [ ] Conversation history in IndexedDB with pin/star

### Phase 7: Testing & Deployment (Week 9-10)

- [ ] Comprehensive testing across browsers
- [ ] Performance optimization
- [ ] Security audit
- [ ] Chrome Web Store submission

## Security Considerations

### Data Protection

- **Local Processing**: All context processing happens locally
- **User Consent**: Explicit permission for tab access
- **Data Sanitization**: Remove sensitive information before AI processing
- **API Security**: Secure storage of API keys using Chrome storage

### Privacy Measures

- **No Data Retention**: Context data not stored permanently
- **Opt-in Sharing**: User controls what context is shared
- **Transparent Processing**: Clear indication of data usage
- **Compliance**: GDPR/CCPA compliance for data handling

### Content Security

- **XSS Prevention**: Sanitize all content before display
- **CSP Headers**: Strict Content Security Policy (include connect-src https://openrouter.ai for API calls)
- **Permission Scoping**: Minimal required permissions
- **Regular Audits**: Security code reviews and penetration testing

### Automation Security

- **Domain Restrictions**: Whitelist approved domains for automation
- **Action Rate Limiting**: Prevent excessive automated interactions
- **User Consent**: Require explicit permission for automation features
- **Audit Logging**: Track all automation actions for transparency
- **Input Validation**: Sanitize all automation parameters
- **Timeout Protection**: Prevent infinite loops and hanging operations

## Testing Strategy

### Unit Testing

- Context extraction accuracy
- Model selection logic
- API client reliability
- UI component functionality
- Web automation function execution
- Safety validation logic

### Integration Testing

- End-to-end chat workflows
- Cross-tab context sharing
- Model switching behavior
- Error handling scenarios
- Web automation workflows
- Function calling integration

### Performance Testing

- Large context processing
- Concurrent tab monitoring
- Memory usage optimization
- API response times

### Security Testing

- Permission escalation attempts
- Data leakage prevention
- XSS vulnerability testing
- API key protection
- Automation security validation
- Domain restriction enforcement
- Rate limiting effectiveness

## Technology Stack

### Frontend

- **React 19**: Modern UI framework with hooks
- **TypeScript**: Type safety and developer experience
- **Tailwind CSS v4**: Utility-first styling framework
- **shadcn/ui**: Re-usable component library built on Radix UI and Tailwind
- **Vite**: Fast build tool and dev server

### Backend/Extension

- **Chrome Extension APIs**: Manifest V3, Sidepanel, Tabs API
- **Service Workers**: Background processing
- **Web Workers**: Heavy computation off main thread

### AI Integration

- **OpenRouter API**: Unified access to multiple AI models
- **Fetch API**: HTTP client for API communication
- **Streaming Support**: Real-time response streaming
- **Local Storage**: OpenRouter API key management
- **IndexedDB**: Conversation history (optional)

### Development Tools

- **ESLint + Prettier**: Code quality
- **Vitest**: Unit testing
- **Playwright**: E2E testing

## Success Metrics

### Technical Metrics

- **Context Accuracy**: >90% relevant content extraction
- **Response Time**: <2 seconds for model selection
- **Memory Usage**: <50MB during normal operation
- **API Reliability**: >99.5% success rate

### User Experience Metrics

- **Task Completion**: Users can accomplish tasks 2x faster
- **Model Selection Accuracy**: >85% user satisfaction with auto-selection
- **Context Relevance**: >80% of responses reference appropriate context
- **Automation Success Rate**: >90% of automation tasks complete successfully

## Risk Mitigation

### Technical Risks

- **API Limits**: Implement request queuing and caching
- **Browser Compatibility**: Focus on Chrome Manifest V3 support
- **Performance Issues**: Optimize context processing algorithms
- **Security Vulnerabilities**: Regular security audits and updates
- **Automation Abuse**: Implement strict safety measures and user controls
- **Function Calling Complexity**: Thorough testing of AI function execution

### Business Risks

- **API Costs**: Monitor usage and implement cost controls
- **User Adoption**: Gather feedback and iterate quickly
- **Competition**: Match and exceed Sidekick’s entry points and media summarization (`https://chromesidekick.com/`)
- **Regulatory Changes**: Stay updated on privacy regulations

## Future Enhancements

### Short Term (3-6 months)

- Voice input/output integration
- Advanced context filtering options
- Multi-language support
- Model performance analytics

### Long Term (6-12 months)

- Plugin ecosystem for specialized AI models
- Team collaboration features
- Advanced analytics and insights
- Mobile companion app

---

_This technical plan will be updated as implementation progresses and new requirements emerge._
