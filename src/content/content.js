// Openrouter Panel Content Script
// This script runs on all web pages to extract context and enable interactions

function isRuntimeAvailable() {
  try {
    // Accessing chrome.runtime.id can throw when context is invalidated
    return (
      typeof chrome !== "undefined" && !!(chrome.runtime && chrome.runtime.id)
    );
  } catch (_err) {
    return false;
  }
}

function safeSendMessage(message) {
  if (!isRuntimeAvailable()) return;
  try {
    chrome.runtime.sendMessage(message);
  } catch (_err) {
    // Silently ignore to avoid noisy "Extension context invalidated" errors during reloads
  }
}

class TabContextExtractor {
  constructor() {
    this.observer = null;
    this.selections = [];
    this.init();
  }

  init() {
    // Listen for messages from background script
    if (isRuntimeAvailable()) {
      try {
        chrome.runtime.onMessage.addListener(
          (request, sender, sendResponse) => {
            try {
              switch (request.action) {
                case "extract_context":
                  sendResponse(this.extractFullContext());
                  break;
                case "get_selection":
                  sendResponse(this.getCurrentSelection());
                  break;
                default:
                  sendResponse({ error: "Unknown action" });
              }
            } catch (error) {
              console.warn("Openrouter Panel: Error handling message:", error);
              sendResponse({ error: "Internal error" });
            }
            return true;
          }
        );
      } catch (_err) {
        // If the runtime is invalidated mid-execution, skip installing listeners
        // and continue without messaging to avoid throwing.
      }
    }

    // Monitor text selections
    document.addEventListener("selectionchange", () => {
      const selection = this.getCurrentSelection();
      if (selection.text) {
        this.selections.push({
          text: selection.text,
          timestamp: Date.now(),
          url: window.location.href,
        });
        // Keep only last 10 selections
        if (this.selections.length > 10) {
          this.selections.shift();
        }
      }
    });

    // Monitor DOM changes for dynamic content
    this.observer = new MutationObserver((mutations) => {
      // Notify background script of significant DOM changes
      const hasSignificantChanges = mutations.some((mutation) => {
        return (
          mutation.type === "childList" &&
          (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)
        );
      });

      if (hasSignificantChanges) {
        safeSendMessage({
          action: "context_updated",
          tabId: null, // Will be set by sender
          timestamp: Date.now(),
        });
      }
    });

    const attachObserver = () => {
      if (!document.body) return;
      try {
        this.observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: false,
        });
      } catch (_err) {
        // Ignore if observing fails due to transient states
      }
    };

    if (document.body) {
      attachObserver();
    } else {
      window.addEventListener("DOMContentLoaded", attachObserver, {
        once: true,
      });
    }
  }

  extractPageContent() {
    // Remove scripts, styles, and navigation elements
    const clone = document.body.cloneNode(true);

    // Remove unwanted elements
    const selectorsToRemove = [
      "script",
      "style",
      "nav",
      "header",
      "footer",
      ".advertisement",
      ".ads",
      ".sidebar",
      ".menu",
      '[class*="nav"]',
      '[class*="menu"]',
      '[class*="sidebar"]',
    ];

    selectorsToRemove.forEach((selector) => {
      const elements = clone.querySelectorAll(selector);
      elements.forEach((el) => el.remove());
    });

    // Extract main content using heuristics
    let mainContent = "";

    // Try to find main content areas
    const contentSelectors = [
      "main",
      "article",
      '[role="main"]',
      ".content",
      ".post",
      ".entry",
      "#content",
      "#main",
      "#post",
    ];

    for (const selector of contentSelectors) {
      const element = clone.querySelector(selector);
      if (element && element.textContent.trim().length > 100) {
        mainContent = element.textContent.trim();
        break;
      }
    }

    // Fallback to body content if no main content found
    if (!mainContent) {
      mainContent = clone.textContent.trim();
    }

    return mainContent;
  }

  extractMetadata() {
    const meta = {
      title: document.title,
      url: window.location.href,
      description: "",
      keywords: "",
      canonicalUrl: "",
      openGraph: {},
      twitterCard: {},
    };

    // Extract meta tags
    const metaTags = document.querySelectorAll("meta");
    metaTags.forEach((tag) => {
      const name = tag.getAttribute("name") || tag.getAttribute("property");
      const content = tag.getAttribute("content");

      if (name && content) {
        switch (name.toLowerCase()) {
          case "description":
            meta.description = content;
            break;
          case "keywords":
            meta.keywords = content;
            break;
          case "og:title":
          case "og:description":
          case "og:image":
          case "og:url":
          case "og:type":
            meta.openGraph[name.replace("og:", "")] = content;
            break;
          case "twitter:title":
          case "twitter:description":
          case "twitter:image":
          case "twitter:card":
            meta.twitterCard[name.replace("twitter:", "")] = content;
            break;
        }
      }
    });

    // Extract canonical URL
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      meta.canonicalUrl = canonical.href;
    }

    return meta;
  }

  getCurrentSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { text: "", range: null };
    }

    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();

    return {
      text,
      range: {
        startContainer: this.getXPath(range.startContainer),
        startOffset: range.startOffset,
        endContainer: this.getXPath(range.endContainer),
        endOffset: range.endOffset,
      },
    };
  }

  getXPath(element) {
    if (element.nodeType === Node.TEXT_NODE) {
      return (
        this.getXPath(element.parentNode) +
        "/text()[" +
        this.getIndex(element) +
        "]"
      );
    }

    if (element.id) {
      return '//*[@id="' + element.id + '"]';
    }

    const path = [];
    while (element.nodeType === Node.ELEMENT_NODE) {
      let selector = element.nodeName.toLowerCase();
      if (element.className) {
        selector += "." + element.className.split(" ").join(".");
      }

      const siblings = element.parentNode ? element.parentNode.children : [];
      if (siblings.length > 1) {
        const index = Array.from(siblings).indexOf(element) + 1;
        selector += ":nth-child(" + index + ")";
      }

      path.unshift(selector);
      element = element.parentNode;
    }

    return path.join(" > ");
  }

  getIndex(element) {
    let index = 1;
    let sibling = element.previousSibling;
    while (sibling) {
      if (sibling.nodeType === Node.TEXT_NODE && sibling.textContent.trim()) {
        index++;
      }
      sibling = sibling.previousSibling;
    }
    return index;
  }

  monitorUserInteractions() {
    // Track clicks and focus events
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (target) {
        safeSendMessage({
          action: "user_interaction",
          type: "click",
          element: this.getXPath(target),
          timestamp: Date.now(),
        });
      }
    });

    // Track form interactions
    document.addEventListener("focus", (event) => {
      const target = event.target;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        safeSendMessage({
          action: "user_interaction",
          type: "focus",
          element: this.getXPath(target),
          fieldType: target.type,
          timestamp: Date.now(),
        });
      }
    });
  }

  extractFullContext() {
    return {
      content: this.extractPageContent(),
      metadata: this.extractMetadata(),
      selections: this.selections.slice(-5), // Last 5 selections
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title,
    };
  }
}

// Initialize context extractor
const contextExtractor = new TabContextExtractor();

// Send initial context to background script
safeSendMessage({
  action: "context_ready",
  context: contextExtractor.extractFullContext(),
});

// Monitor user interactions
contextExtractor.monitorUserInteractions();
