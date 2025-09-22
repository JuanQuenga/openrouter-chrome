# Sidepanel AI

AI-powered chat interface in Chrome sidepanel with web automation capabilities.

## Overview

Sidepanel AI is a Chrome extension that provides an intelligent AI chat interface directly in your browser's sidepanel. It intelligently accesses and utilizes context from all open tabs to enhance AI conversations through OpenRouter.ai, enabling seamless web automation capabilities.

## Features

- **Sidepanel Integration**: Native Chrome sidepanel UI for seamless workflow
- **Tab Context Awareness**: Access to content, URLs, and metadata from all open tabs
- **OpenRouter Integration**: Access to multiple AI models through OpenRouter.ai unified API
- **Web Automation**: AI can open URLs, click elements, type text, and interact with web pages
- **Privacy-Focused**: Local processing with user-controlled data sharing
- **Multi-Model Support**: Intelligent model selection based on task requirements

## Project Structure

```
├── manifest.json              # Chrome extension manifest (V3)
├── src/
│   ├── background/            # Background service worker
│   │   └── background.js      # Tab management & web automation
│   ├── content/               # Content scripts
│   │   └── content.js         # Context extraction from web pages
│   ├── sidepanel/             # React UI components
│   │   ├── App.tsx            # Main sidepanel component
│   │   ├── main.tsx           # React entry point
│   │   └── index.html         # Sidepanel HTML
│   └── utils/                 # Utility modules
│       └── openrouter-client.js # OpenRouter API client
├── public/
│   └── icons/                 # Extension icons
├── dist/                      # Build output
└── package.json               # Dependencies & scripts
```

## Technology Stack

### Frontend

- **React 18**: Modern UI framework with hooks
- **TypeScript**: Type safety and developer experience
- **Tailwind CSS**: Utility-first styling framework
- **Vite**: Fast build tool and dev server

### Backend/Extension

- **Chrome Extension APIs**: Manifest V3, Sidepanel, Tabs API
- **Service Workers**: Background processing
- **Web Workers**: Heavy computation off main thread

### AI Integration

- **OpenRouter API**: Unified access to multiple AI models
- **Function Calling**: AI-driven web automation
- **Streaming Support**: Real-time response streaming

## Development

### Prerequisites

- Node.js 18+
- Chrome browser

### Installation

1. Clone the repository

```bash
git clone <repository-url>
cd sidepanel-ai
```

2. Install dependencies

```bash
npm install
```

3. Build the extension

```bash
npm run build
```

4. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

### Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Run linting
npm run lint

# Run type checking
npm run type-check

# Run tests
npm run test
```

## Architecture

### Core Components

1. **Background Service Worker** (`src/background/background.js`)

   - Manages tab context collection
   - Handles web automation requests
   - Coordinates communication between components

2. **Content Scripts** (`src/content/content.js`)

   - Extract context from web pages
   - Monitor user interactions
   - Provide real-time context updates

3. **Sidepanel UI** (`src/sidepanel/`)

   - React-based chat interface
   - Model selection and settings
   - Context visualization

4. **OpenRouter Client** (`src/utils/openrouter-client.js`)
   - API integration with OpenRouter
   - Model selection logic
   - Function calling support

### Data Flow

1. **Context Collection**: Content scripts extract relevant data from active tabs
2. **Context Processing**: Background service processes and sanitizes tab data
3. **Query Analysis**: User input analyzed to determine optimal OpenRouter model and automation needs
4. **Model Selection**: Intelligent selection of appropriate model based on task requirements
5. **Function Calling**: AI determines if web automation functions are needed
6. **Automation Execution**: Web Automation Service executes browser interactions if required
7. **API Communication**: Secure communication with OpenRouter API
8. **Response Processing**: AI responses and automation results formatted and displayed in sidepanel

## Security Considerations

- **Local Processing**: All context processing happens locally
- **User Consent**: Explicit permission for tab access
- **Data Sanitization**: Remove sensitive information before AI processing
- **API Security**: Secure storage of API keys using Chrome storage
- **Content Security**: XSS prevention and CSP headers
- **Automation Security**: Domain restrictions and rate limiting

## Implementation Phases

### ✅ Phase 1: Core Infrastructure (Completed)

- Manifest V3 project structure with automation permissions
- Basic sidepanel UI with React/TypeScript/Tailwind
- Tab context extraction system
- Background service worker framework
- Web automation service foundation

### ✅ Phase 2: OpenRouter Integration (Completed)

- OpenRouter API client with function calling and streaming support
- Model selection logic and auto-select via OpenRouter models list
- OpenRouter API key management using `chrome.storage.local`
- Web automation function definitions (open_url, click_element, type_text, get_page_content, wait_for_element)

### 🔄 Phase 3: Context Processing (In progress)

- Enhanced content extraction algorithms
- Context summarization and relevance scoring (implemented minimal version)
- Context security filters

### 🔄 Phase 3.5: Web Automation (In progress)

- Web automation service with Chrome APIs
- Element interaction handlers (click, type, wait) — basic handlers implemented
- Safety measures and domain restrictions — injectable URL checks in place

### 🔄 Phase 4: UI/UX Polish (In progress)

- Chat interface wiring with model selector, streaming toggle, and context summary
- Settings modal for API key and preferences
- Automation toggle in header

### 📋 Phase 5: Testing & Deployment

- Comprehensive testing and performance optimization
- Security audit and Chrome Web Store preparation

## Contributing

## Chrome Web Store Release Checklist

- Update version numbers in `manifest.json` and `package.json`.
- Replace `manifest.json:oauth2.client_id` with your production Google OAuth client ID (or remove the Sheets tooling before submission).
- Ensure listing assets exist: 16/32/48/128 px PNG icons plus at least one 1280x800 screenshot.
- Publish or update the public privacy policy URL in the Chrome Web Store listing.
- Run `npm run lint` and `npm run build`; confirm the extension loads correctly from the `dist` folder.
- Smoke test key features (sidepanel chat, automation, context menus, voice input, Google Sheets tools if enabled).
- Run `npm run package` to build and zip the contents of `dist` for upload (or zip the directory manually).
- Document reviewer credentials (OpenRouter key, demo account) in the listing notes so reviewers can verify functionality.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run `npm run lint` and `npm run type-check`
6. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions, please create an issue on the GitHub repository.
# openrouter-chrome
