// Openrouter Panel Background Service Worker

class TabContextManager {
  constructor() {
    this.contexts = new Map();
    this.activeTabId = null;
  }

  async updateTabContext(tabId, context) {
    this.contexts.set(tabId, {
      ...context,
      lastUpdated: Date.now(),
      tabId: tabId,
    });
  }

  getTabContext(tabId) {
    return this.contexts.get(tabId);
  }

  getAllContexts() {
    return Array.from(this.contexts.values());
  }

  removeTabContext(tabId) {
    this.contexts.delete(tabId);
  }
}

class WebAutomationService {
  constructor() {
    this.pendingActions = new Map();
    this.settings = {
      allowAllAutomation: false,
      domainWhitelist: [],
      rateLimitPer30s: 20,
    };
    this.rateCounter = new Map(); // key: tabId, value: { count, windowStart }
    this._initSettingsWatcher();
  }

  // Only allow injection on standard web pages
  static isInjectableUrl(url) {
    if (!url || typeof url !== "string") return false;
    // Block Chrome internal, extension, devtools, data, about, file (optional)
    const blockedSchemes = [
      "chrome://",
      "edge://",
      "brave://",
      "vivaldi://",
      "opera://",
      "about:",
      "devtools://",
      "chrome-extension://",
      "data:",
      "file://",
    ];
    if (blockedSchemes.some((p) => url.startsWith(p))) return false;
    // Allow http/https by default
    return url.startsWith("http://") || url.startsWith("https://");
  }

  async _loadSettings() {
    try {
      const stored = await chrome.storage.local.get([
        "automation_allow_all",
        "automation_whitelist",
        "automation_rate_limit",
      ]);
      this.settings.allowAllAutomation = !!stored.automation_allow_all;
      const wl = stored.automation_whitelist;
      this.settings.domainWhitelist = Array.isArray(wl)
        ? wl
        : typeof wl === "string"
        ? wl
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const rl = Number(stored.automation_rate_limit);
      this.settings.rateLimitPer30s = Number.isFinite(rl) && rl > 0 ? rl : 20;
    } catch (e) {
      // ignore
    }
  }

  _initSettingsWatcher() {
    this._loadSettings();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (
        changes.automation_allow_all ||
        changes.automation_whitelist ||
        changes.automation_rate_limit
      ) {
        this._loadSettings();
      }
    });
  }

  _getDomain(url) {
    try {
      const u = new URL(url);
      return u.hostname;
    } catch {
      return "";
    }
  }

  async _enforcePolicies(tabId, actionName, urlHint) {
    // Domain allowlist
    if (!this.settings.allowAllAutomation) {
      try {
        const tab = await chrome.tabs.get(tabId);
        const domain = this._getDomain(urlHint || tab.url || "");
        if (
          domain &&
          this.settings.domainWhitelist.length > 0 &&
          !this.settings.domainWhitelist.some(
            (d) => domain === d || domain.endsWith("." + d)
          )
        ) {
          return {
            success: false,
            error: `Domain not allowed: ${domain}`,
            action: actionName,
          };
        }
      } catch (e) {
        // if cannot resolve tab, fail closed
        return {
          success: false,
          error: "Unable to verify domain policy",
          action: actionName,
        };
      }
    }

    // Rate limiting per tab per 30s window
    const now = Date.now();
    const windowMs = 30_000;
    const entry = this.rateCounter.get(tabId) || { count: 0, windowStart: now };
    if (now - entry.windowStart > windowMs) {
      entry.count = 0;
      entry.windowStart = now;
    }
    entry.count += 1;
    this.rateCounter.set(tabId, entry);
    if (entry.count > this.settings.rateLimitPer30s) {
      return {
        success: false,
        error: "Rate limit exceeded",
        action: actionName,
      };
    }

    return { success: true };
  }

  async openUrl(url, newTab = false) {
    try {
      // Note: opening URL does not have a tab yet; skip rate-limit here
      if (newTab) {
        return await chrome.tabs.create({ url });
      } else {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const policy = await this._enforcePolicies(
          activeTab.id,
          "open_url",
          url
        );
        if (!policy.success) return policy;
        return await chrome.tabs.update(activeTab.id, { url });
      }
    } catch (error) {
      console.error("Failed to open URL:", error);
      return { success: false, error: String(error), action: "open_url" };
    }
  }

  async clickElement(selector, tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!WebAutomationService.isInjectableUrl(tab.url || "")) {
        return {
          success: false,
          error: "Restricted page. Cannot click elements.",
          action: "click_element",
        };
      }
      const policy = await this._enforcePolicies(tabId, "click_element");
      if (!policy.success) return policy;
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => {
          const element = document.querySelector(sel);
          if (element) {
            element.click();
            return { success: true, data: true };
          }
          return { success: false, error: "Element not found" };
        },
        args: [selector],
      });
      return {
        action: "click_element",
        params: { selector, tabId },
        ...result[0].result,
      };
    } catch (error) {
      console.error("Failed to click element:", error);
      return { success: false, error: String(error), action: "click_element" };
    }
  }

  async typeText(selector, text, tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!WebAutomationService.isInjectableUrl(tab.url || "")) {
        return {
          success: false,
          error: "Restricted page. Cannot type into elements.",
          action: "type_text",
        };
      }
      const policy = await this._enforcePolicies(tabId, "type_text");
      if (!policy.success) return policy;
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel, txt) => {
          const element = document.querySelector(sel);
          if (
            element &&
            (element.tagName === "INPUT" ||
              element.tagName === "TEXTAREA" ||
              element.contentEditable === "true")
          ) {
            element.value = txt;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            return { success: true, data: true };
          }
          return {
            success: false,
            error: "Element not found or not inputable",
          };
        },
        args: [selector, text],
      });
      return {
        action: "type_text",
        params: { selector, tabId },
        ...result[0].result,
      };
    } catch (error) {
      console.error("Failed to type text:", error);
      return { success: false, error: String(error), action: "type_text" };
    }
  }

  async waitForElement(selector, tabId, timeout = 10000) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!WebAutomationService.isInjectableUrl(tab.url || "")) {
        return {
          success: false,
          error: "Restricted page. Cannot wait for elements.",
          action: "wait_for_element",
        };
      }
      const policy = await this._enforcePolicies(tabId, "wait_for_element");
      if (!policy.success) return policy;

      const start = Date.now();
      while (Date.now() - start < timeout) {
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel) => !!document.querySelector(sel),
          args: [selector],
        });
        const exists = result[0]?.result === true;
        if (exists)
          return {
            success: true,
            action: "wait_for_element",
            params: { selector, tabId },
            data: true,
          };
        // Small delay to avoid busy-waiting
        await new Promise((r) => setTimeout(r, 200));
      }
      return {
        success: false,
        error: "Timeout waiting for element",
        action: "wait_for_element",
        params: { selector, tabId },
      };
    } catch (error) {
      console.error("Failed to wait for element:", error);
      return {
        success: false,
        error: String(error),
        action: "wait_for_element",
      };
    }
  }

  _sanitizeForms(forms) {
    return forms.map((f) => {
      const isSensitive =
        (f.type || "").toLowerCase() === "password" ||
        /token|password|secret/i.test(f.name || "");
      return {
        ...f,
        value: isSensitive
          ? "[REDACTED]"
          : typeof f.value === "string" && f.value.length > 0
          ? "[REDACTED]"
          : "",
      };
    });
  }

  _redactText(text) {
    if (!text) return text;
    let out = text;
    // emails
    out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]");
    // long numbers (potential account/card)
    out = out.replace(/\b\d{6,}\b/g, "[NUMBER]");
    return out;
  }

  async getPageContent(tabId, includeForms = true) {
    try {
      // Validate target URL before attempting injection
      const tab = await chrome.tabs.get(tabId);
      if (!WebAutomationService.isInjectableUrl(tab.url || "")) {
        throw new Error(
          "Target page is not script-injectable (restricted URL)"
        );
      }
      const policy = await this._enforcePolicies(tabId, "get_page_content");
      if (!policy.success) return policy;
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (forms) => {
          const content = {
            title: document.title,
            url: location.href,
            text: document.body.innerText,
            headings: Array.from(
              document.querySelectorAll("h1, h2, h3, h4, h5, h6")
            ).map((h) => ({
              level: parseInt(h.tagName.charAt(1)),
              text: h.textContent.trim(),
            })),
          };

          if (forms) {
            content.forms = Array.from(
              document.querySelectorAll("input, textarea, select")
            ).map((el) => ({
              type: el.type || el.tagName.toLowerCase(),
              name: el.name,
              id: el.id,
              placeholder: el.placeholder,
              value: el.value,
            }));
          }

          return content;
        },
        args: [includeForms],
      });
      const raw = result[0].result;
      const sanitized = {
        ...raw,
        text: this._redactText(raw.text || ""),
        forms: raw.forms ? this._sanitizeForms(raw.forms) : undefined,
      };
      return {
        success: true,
        action: "get_page_content",
        params: { tabId, includeForms },
        data: sanitized,
      };
    } catch (error) {
      console.error("Failed to get page content:", error);
      return {
        success: false,
        error: String(error),
        action: "get_page_content",
      };
    }
  }

  async extractGoogleShoppingOffers(
    tabId,
    { includeUsed = false, maxResults = 5 } = {}
  ) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!WebAutomationService.isInjectableUrl(tab.url || "")) {
        return {
          success: false,
          error: "Restricted page. Cannot extract offers.",
          action: "fetch_prices",
        };
      }
      const policy = await this._enforcePolicies(tabId, "fetch_prices");
      if (!policy.success) return policy;

      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (wantUsed, limit) => {
          function parsePrice(text) {
            try {
              const m = text.match(/[\$€£]\s?([\d,.]+)/);
              if (!m) return { raw: null, value: null, currency: null };
              const raw = m[0];
              const num = m[1].replace(/,/g, "");
              const value = Number(num);
              const currency = raw.trim().charAt(0);
              return { raw, value: isFinite(value) ? value : null, currency };
            } catch {
              return { raw: null, value: null, currency: null };
            }
          }

          function firstTextMatch(el, rx) {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
              const t = (node.textContent || "").trim();
              if (!t) continue;
              if (rx.test(t)) return t;
            }
            return "";
          }

          const containers = Array.from(
            document.querySelectorAll(
              "div.sh-dgr__grid-result, div.sh-dgr__list-result, div.sh-pr__product-results li, div.sh-dlr__list-result"
            )
          );

          const items = containers.map((el) => {
            const titleEl =
              el.querySelector("h3, a[aria-label], a[data-docid]") ||
              el.querySelector("a[href]");
            const title = (
              titleEl?.getAttribute("aria-label") ||
              titleEl?.textContent ||
              ""
            ).trim();
            const priceText = firstTextMatch(el, /[\$€£]\s?[\d,.]+/);
            const price = parsePrice(priceText);
            const merchant = (
              el.querySelector(".aULzUe, .IuHnof, .E5ocAb, .teQAzf")
                ?.textContent || ""
            ).trim();
            let href = (titleEl && titleEl.getAttribute("href")) || "";
            try {
              if (href) href = new URL(href, location.origin).toString();
            } catch {}
            const ratingEl = el.querySelector('[aria-label*="stars"], .Rsc7Yb');
            const ratingText =
              ratingEl?.getAttribute("aria-label") ||
              ratingEl?.textContent ||
              "";
            const isUsed = /used|refurb/i.test(el.textContent || "");
            return {
              title,
              priceText,
              priceValue: price.value,
              currency: price.currency,
              merchant,
              link: href,
              ratingText: ratingText.trim(),
              isUsed,
            };
          });

          const filtered = items
            .filter((x) => x.title && x.priceValue != null)
            .filter((x) => (wantUsed ? true : !x.isUsed));

          filtered.sort(
            (a, b) => (a.priceValue || Infinity) - (b.priceValue || Infinity)
          );

          return {
            success: true,
            data: filtered.slice(0, Math.max(1, Number(limit) || 5)),
          };
        },
        args: [includeUsed === true, maxResults || 5],
      });
      const res = result?.[0]?.result || { success: false };
      return { action: "fetch_prices", ...res };
    } catch (error) {
      console.error("Failed to extract Google Shopping offers:", error);
      return { success: false, error: String(error), action: "fetch_prices" };
    }
  }

  async extractStoreOffers(tabId, source, { maxResults = 3 } = {}) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!WebAutomationService.isInjectableUrl(tab.url || "")) {
        return {
          success: false,
          error: "Restricted page. Cannot extract offers.",
          action: "fetch_prices",
        };
      }
      const policy = await this._enforcePolicies(tabId, "fetch_prices");
      if (!policy.success) return policy;

      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (src, limit) => {
          function parseCurrency(text) {
            try {
              const m = text.match(/([$€£])\s*([\d,.]+)/);
              if (!m) return { raw: null, value: null, currency: null };
              const raw = m[0];
              const value = Number(m[2].replace(/,/g, ""));
              return {
                raw,
                value: isFinite(value) ? value : null,
                currency: m[1],
              };
            } catch {
              return { raw: null, value: null, currency: null };
            }
          }

          function qsa(sel) {
            return Array.from(document.querySelectorAll(sel));
          }

          let items = [];
          const srcLower = (src || "").toLowerCase();
          if (srcLower === "amazon") {
            const cards = qsa(
              "div.s-result-item[data-component-type='s-search-result']"
            );
            items = cards.map((el) => {
              const titleEl = el.querySelector("h2 a, h2 span a");
              const priceEl = el.querySelector(
                "span.a-price > span.a-offscreen"
              );
              const title = (titleEl?.textContent || "").trim();
              const priceText = (priceEl?.textContent || "").trim();
              const price = parseCurrency(priceText);
              let href = titleEl?.getAttribute("href") || "";
              try {
                if (href) href = new URL(href, location.origin).toString();
              } catch {}
              return {
                title,
                priceText,
                priceValue: price.value,
                currency: price.currency,
                merchant: "Amazon",
                link: href,
              };
            });
          } else if (srcLower === "bestbuy") {
            const cards = qsa("li.sku-item, div.sku-item");
            items = cards.map((el) => {
              const titleEl = el.querySelector("h4.sku-title a, h4 a");
              const priceEl = el.querySelector(
                "div.priceView-hero-price span[aria-hidden='true'], div.priceView-customer-price span"
              );
              const title = (titleEl?.textContent || "").trim();
              const priceText = (priceEl?.textContent || "").trim();
              const price = parseCurrency(priceText);
              let href = titleEl?.getAttribute("href") || "";
              try {
                if (href) href = new URL(href, location.origin).toString();
              } catch {}
              return {
                title,
                priceText,
                priceValue: price.value,
                currency: price.currency,
                merchant: "Best Buy",
                link: href,
              };
            });
          } else if (srcLower === "walmart") {
            const cards = qsa(
              "div.mb3.ph3.pa0-xl.bb.b--near-white, div[data-automation-id='search-results-grid'] a[href*='/ip/']"
            );
            items = cards.map((el) => {
              const titleEl = el.querySelector(
                "a:where([href*='/ip/']) span, a[href*='/ip/']"
              );
              const priceEl = el.querySelector(
                "span[data-automation-id='price'], span.w_iUH7, div[data-automation-id='product-price'] span"
              );
              const title = (titleEl?.textContent || "").trim();
              const priceText = (priceEl?.textContent || "").trim();
              const price = parseCurrency(priceText);
              let href = titleEl?.closest("a")?.getAttribute("href") || "";
              try {
                if (href) href = new URL(href, location.origin).toString();
              } catch {}
              return {
                title,
                priceText,
                priceValue: price.value,
                currency: price.currency,
                merchant: "Walmart",
                link: href,
              };
            });
          } else if (srcLower === "newegg") {
            const cards = qsa("div.item-cell, div.product-tile");
            items = cards.map((el) => {
              const titleEl = el.querySelector("a.item-title, a[title]");
              const priceEl = el.querySelector(
                "li.price-current, strong[class*='price'], div.price-current"
              );
              const title = (titleEl?.textContent || "").trim();
              const priceText = (priceEl?.textContent || "").trim();
              const price = parseCurrency(priceText);
              let href = titleEl?.getAttribute("href") || "";
              try {
                if (href) href = new URL(href, location.origin).toString();
              } catch {}
              return {
                title,
                priceText,
                priceValue: price.value,
                currency: price.currency,
                merchant: "Newegg",
                link: href,
              };
            });
          } else if (srcLower === "bh") {
            const cards = qsa("li[data-selenium='grid-item'], div.result-item");
            items = cards.map((el) => {
              const titleEl = el.querySelector(
                "a[data-selenium='mini-product-title'], h2 a"
              );
              const priceEl = el.querySelector(
                "span[data-selenium='price-small'], .price_1DPoToKrLP8uWvruGqgta"
              );
              const title = (titleEl?.textContent || "").trim();
              const priceText = (priceEl?.textContent || "").trim();
              const price = parseCurrency(priceText);
              let href = titleEl?.getAttribute("href") || "";
              try {
                if (href) href = new URL(href, location.origin).toString();
              } catch {}
              return {
                title,
                priceText,
                priceValue: price.value,
                currency: price.currency,
                merchant: "B&H",
                link: href,
              };
            });
          } else if (srcLower === "target") {
            const cards = qsa(
              "li.h-padding-h-tight, div[data-test='productGridContainer'] a[data-test='product-title']"
            );
            items = cards.map((el) => {
              const titleEl = el.querySelector(
                "a[data-test='product-title'], a"
              );
              const priceEl = el.querySelector(
                "span[data-test='current-price'], span[data-test='product-price']"
              );
              const title = (titleEl?.textContent || "").trim();
              const priceText = (priceEl?.textContent || "").trim();
              const price = parseCurrency(priceText);
              let href = titleEl?.getAttribute("href") || "";
              try {
                if (href) href = new URL(href, location.origin).toString();
              } catch {}
              return {
                title,
                priceText,
                priceValue: price.value,
                currency: price.currency,
                merchant: "Target",
                link: href,
              };
            });
          }

          const filtered = items.filter((x) => x.title && x.priceValue != null);
          filtered.sort(
            (a, b) => (a.priceValue || Infinity) - (b.priceValue || Infinity)
          );
          return {
            success: true,
            data: filtered.slice(0, Math.max(1, Number(limit) || 3)),
          };
        },
        args: [source, maxResults || 3],
      });
      return {
        action: "fetch_prices",
        ...(result?.[0]?.result || { success: false }),
      };
    } catch (error) {
      console.error("Failed to extract store offers:", error);
      return { success: false, error: String(error), action: "fetch_prices" };
    }
  }

  async waitForAnySelector(selectors, tabId, timeout = 10000) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!WebAutomationService.isInjectableUrl(tab.url || "")) {
        return {
          success: false,
          error: "Restricted page. Cannot wait for selectors.",
          action: "wait_for_any_selector",
        };
      }
      const policy = await this._enforcePolicies(
        tabId,
        "wait_for_any_selector"
      );
      if (!policy.success) return policy;

      const start = Date.now();
      while (Date.now() - start < timeout) {
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sels) => sels.some((s) => !!document.querySelector(s)),
          args: [selectors],
        });
        const exists = result[0]?.result === true;
        if (exists)
          return {
            success: true,
            action: "wait_for_any_selector",
            data: true,
          };
        await new Promise((r) => setTimeout(r, 250));
      }
      return {
        success: false,
        error: "Timeout waiting for any selector",
        action: "wait_for_any_selector",
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
        action: "wait_for_any_selector",
      };
    }
  }

  async waitForOffersReady(
    tabId,
    { includeUsed = false, minCount = 1, timeout = 15000 } = {}
  ) {
    try {
      const start = Date.now();
      let lastCount = 0;
      while (Date.now() - start < timeout) {
        const res = await this.extractGoogleShoppingOffers(tabId, {
          includeUsed,
          maxResults: Math.max(minCount * 3, 12),
        });
        if (res?.success && Array.isArray(res.data)) {
          lastCount = res.data.length;
          if (lastCount >= minCount) {
            return { success: true, count: lastCount };
          }
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      return {
        success: false,
        error: `Timeout waiting for offers (${lastCount} found)`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

// --- Google Sheets integration ---
class GoogleSheetsService {
  constructor() {}

  async getAuthToken(interactive = true) {
    try {
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (t) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(t);
        });
      });
      return token;
    } catch (e) {
      throw e;
    }
  }

  extractSpreadsheetInfoFromUrl(url) {
    try {
      const u = new URL(url);
      if (!u.hostname.endsWith("docs.google.com")) return {};
      const parts = u.pathname.split("/");
      const idx = parts.indexOf("d");
      const spreadsheetId =
        idx >= 0 && parts[idx + 1] ? parts[idx + 1] : undefined;
      const hash = u.hash || "";
      const gidMatch = hash.match(/[#&?]gid=(\d+)/);
      const gid = gidMatch ? gidMatch[1] : undefined;
      return { spreadsheetId, gid };
    } catch {
      return {};
    }
  }

  async resolveSpreadsheetId(explicitId) {
    if (explicitId && typeof explicitId === "string" && explicitId.trim()) {
      return explicitId.trim();
    }
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const info = this.extractSpreadsheetInfoFromUrl(activeTab?.url || "");
      return info.spreadsheetId;
    } catch {
      return undefined;
    }
  }

  async apiFetch(path, { method = "GET", body } = {}) {
    const token = await this.getAuthToken(true);
    const res = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Sheets API ${method} ${path} failed: ${res.status} ${text}`
      );
    }
    return await res.json();
  }

  async readRange(spreadsheetId, rangeA1) {
    const encRange = encodeURIComponent(rangeA1);
    return await this.apiFetch(
      `spreadsheets/${spreadsheetId}/values/${encRange}`
    );
  }

  async writeRange(spreadsheetId, rangeA1, values, valueInputOption = "RAW") {
    const encRange = encodeURIComponent(rangeA1);
    return await this.apiFetch(
      `spreadsheets/${spreadsheetId}/values/${encRange}?valueInputOption=${valueInputOption}`,
      {
        method: "PUT",
        body: { range: rangeA1, majorDimension: "ROWS", values: values || [] },
      }
    );
  }

  async appendRows(spreadsheetId, rangeA1, values, valueInputOption = "RAW") {
    const encRange = encodeURIComponent(rangeA1);
    return await this.apiFetch(
      `spreadsheets/${spreadsheetId}/values/${encRange}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: { values: values || [], majorDimension: "ROWS" },
      }
    );
  }
}

// --- TODO/checklist service ---
class TodoService {
  constructor() {}

  async _loadAll() {
    try {
      const { todos_store } = await chrome.storage.local.get(["todos_store"]);
      return todos_store && typeof todos_store === "object" ? todos_store : {};
    } catch {
      return {};
    }
  }

  async _saveAll(store) {
    await chrome.storage.local.set({ todos_store: store });
  }

  _ensureSession(store, session) {
    const key = session && String(session).trim() ? session.trim() : "default";
    if (!store[key]) store[key] = [];
    return key;
  }

  _genId() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    ).toUpperCase();
  }

  async create({ title, notes, priority, dueAt, session }) {
    const store = await this._loadAll();
    const sess = this._ensureSession(store, session);
    const now = Date.now();
    const item = {
      id: this._genId(),
      title: String(title || "").trim(),
      notes: typeof notes === "string" ? notes : "",
      done: false,
      priority: ["low", "medium", "high"].includes(priority)
        ? priority
        : "medium",
      dueAt: Number.isFinite(dueAt) ? Number(dueAt) : undefined,
      createdAt: now,
      updatedAt: now,
      session: sess,
    };
    store[sess].push(item);
    await this._saveAll(store);
    return item;
  }

  async list({ session }) {
    const store = await this._loadAll();
    const sess = this._ensureSession(store, session);
    return store[sess];
  }

  async update({ id, session, ...updates }) {
    const store = await this._loadAll();
    const sess = this._ensureSession(store, session);
    const idx = store[sess].findIndex((t) => t.id === id);
    if (idx < 0) return null;
    const prev = store[sess][idx];
    const next = {
      ...prev,
      ...(typeof updates.title === "string" ? { title: updates.title } : {}),
      ...(typeof updates.notes === "string" ? { notes: updates.notes } : {}),
      ...(updates.priority &&
      ["low", "medium", "high"].includes(updates.priority)
        ? { priority: updates.priority }
        : {}),
      ...(Number.isFinite(updates.dueAt)
        ? { dueAt: Number(updates.dueAt) }
        : {}),
      updatedAt: Date.now(),
    };
    store[sess][idx] = next;
    await this._saveAll(store);
    return next;
  }

  async setStatus({ id, done, session }) {
    const store = await this._loadAll();
    const sess = this._ensureSession(store, session);
    const idx = store[sess].findIndex((t) => t.id === id);
    if (idx < 0) return null;
    store[sess][idx] = {
      ...store[sess][idx],
      done: !!done,
      updatedAt: Date.now(),
    };
    await this._saveAll(store);
    return store[sess][idx];
  }

  async remove({ id, session }) {
    const store = await this._loadAll();
    const sess = this._ensureSession(store, session);
    const before = store[sess].length;
    store[sess] = store[sess].filter((t) => t.id !== id);
    const removed = before !== store[sess].length;
    await this._saveAll(store);
    return removed;
  }

  async clear({ session, onlyDone = true }) {
    const store = await this._loadAll();
    const sess = this._ensureSession(store, session);
    if (onlyDone) store[sess] = store[sess].filter((t) => !t.done);
    else store[sess] = [];
    await this._saveAll(store);
    return true;
  }

  async summary({ session }) {
    const store = await this._loadAll();
    const sess = this._ensureSession(store, session);
    const items = store[sess];
    const total = items.length;
    const done = items.filter((t) => t.done).length;
    const pending = total - done;
    const byPriority = items.reduce((acc, t) => {
      const p = t.priority || "medium";
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    }, {});
    const next = items.find((t) => !t.done) || null;
    return { total, done, pending, byPriority, next };
  }
}

// --- Context processing helpers ---
function summarizeText(text, maxChars = 1200) {
  if (!text) return "";
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxChars) return trimmed;
  // Prefer to cut at sentence boundary if possible
  const slice = trimmed.slice(0, maxChars);
  const lastPeriod = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?")
  );
  const cutoff = lastPeriod > maxChars * 0.6 ? lastPeriod + 1 : maxChars;
  return slice.slice(0, cutoff).trim() + " …";
}

function scoreContext(context) {
  if (!context) return 0;
  const recencyMs =
    Date.now() - (context.lastUpdated || context.timestamp || Date.now());
  const recencyScore = Math.max(0, 1 - recencyMs / (5 * 60 * 1000)); // 0..1 over 5 minutes
  const selectionCount = Array.isArray(context.selections)
    ? context.selections.length
    : 0;
  const selectionScore = Math.min(1, selectionCount / 5);
  const lengthScore = Math.min(
    1,
    ((context.text || context.content || "").length || 0) / 5000
  );
  return Number(
    (0.5 * recencyScore + 0.3 * selectionScore + 0.2 * lengthScore).toFixed(3)
  );
}

function buildContextSummary(context) {
  if (!context) return null;
  const text = context.text || context.content || "";
  const headings = Array.isArray(context.headings) ? context.headings : [];
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  return {
    title: context.title || (context.metadata && context.metadata.title) || "",
    url: context.url || (context.metadata && context.metadata.url) || "",
    words,
    sections: headings.length,
    keyHeadings: headings.slice(0, 5),
    excerpt: summarizeText(text, 800),
    score: scoreContext(context),
  };
}

// Initialize services
const tabContextManager = new TabContextManager();
const webAutomationService = new WebAutomationService();
const googleSheetsService = new GoogleSheetsService();
const todoService = new TodoService();

// Tab event listeners
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    WebAutomationService.isInjectableUrl(tab.url)
  ) {
    try {
      const context = await webAutomationService.getPageContent(tabId);
      await tabContextManager.updateTabContext(tabId, context);
    } catch (error) {
      console.error("Failed to extract context for tab:", tabId, error);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabContextManager.removeTabContext(tabId);
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  tabContextManager.activeTabId = activeInfo.tabId;
});

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case "get_tab_contexts":
          sendResponse({ contexts: tabContextManager.getAllContexts() });
          break;

        case "get_active_context":
          const activeContext = tabContextManager.activeTabId
            ? tabContextManager.getTabContext(tabContextManager.activeTabId)
            : null;
          sendResponse({ context: activeContext });
          break;

        case "open_url":
          const tab = await webAutomationService.openUrl(
            request.url,
            request.newTab
          );
          sendResponse(
            tab?.success === false
              ? tab
              : {
                  success: true,
                  action: "open_url",
                  params: { url: request.url, newTab: request.newTab },
                  data: tab,
                }
          );
          break;

        case "click_element":
          const clickResult = await webAutomationService.clickElement(
            request.selector,
            request.tabId
          );
          sendResponse(clickResult);
          break;

        case "type_text":
          const typeResult = await webAutomationService.typeText(
            request.selector,
            request.text,
            request.tabId
          );
          sendResponse(typeResult);
          break;

        case "get_page_content":
          const content = await webAutomationService.getPageContent(
            request.tabId,
            request.includeForms
          );
          sendResponse(content);
          break;

        case "wait_for_element":
          const waitResult = await webAutomationService.waitForElement(
            request.selector,
            request.tabId,
            request.timeout
          );
          sendResponse(waitResult);
          break;

        case "get_active_context_summary":
          const active = tabContextManager.activeTabId
            ? tabContextManager.getTabContext(tabContextManager.activeTabId)
            : null;
          sendResponse({ summary: buildContextSummary(active) });
          break;

        case "get_context_summaries":
          const all = tabContextManager.getAllContexts();
          sendResponse({
            summaries: all.map(buildContextSummary).filter(Boolean),
          });
          break;

        case "fetch_prices": {
          try {
            // Resolve query from request or active tab context
            let query = (request.query || "").trim();
            if (!query) {
              const active = tabContextManager.activeTabId
                ? tabContextManager.getTabContext(tabContextManager.activeTabId)
                : null;
              query = (
                active?.data?.title ||
                active?.title ||
                active?.data?.url ||
                ""
              )
                .toString()
                .trim();
            }
            if (!query) {
              sendResponse({
                success: false,
                action: "fetch_prices",
                error: "Missing query and no active tab title",
              });
              break;
            }

            const sources = Array.isArray(request.sources)
              ? request.sources
              : [];
            const maxPerSource = Number(request.maxPerSource) || 3;

            if (sources.length === 0) {
              // Default to Google Shopping flow
              const searchUrl = `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(
                query
              )}`;
              const open = await webAutomationService.openUrl(
                searchUrl,
                request.newTab !== false
              );
              const targetTabId = open?.id
                ? open.id
                : tabContextManager.activeTabId ||
                  (
                    await chrome.tabs.query({
                      active: true,
                      currentWindow: true,
                    })
                  )[0]?.id;

              if (!targetTabId) {
                sendResponse({
                  success: false,
                  action: "fetch_prices",
                  error: "Unable to resolve target tab",
                });
                break;
              }

              await webAutomationService.waitForAnySelector(
                [
                  "div.sh-dgr__grid-result",
                  "div.sh-dlr__list-result",
                  "div.sh-pr__product-results li",
                  "div.sh-dgr__content",
                ],
                targetTabId,
                25000
              );

              await webAutomationService.waitForOffersReady(targetTabId, {
                includeUsed: request.includeUsed === true,
                minCount: 1,
                timeout: 25000,
              });

              const offers =
                await webAutomationService.extractGoogleShoppingOffers(
                  targetTabId,
                  {
                    includeUsed: request.includeUsed === true,
                    maxResults: Number(request.maxResults) || 5,
                  }
                );
              sendResponse({
                success: offers?.success !== false,
                action: "fetch_prices",
                params: { query, maxResults: Number(request.maxResults) || 5 },
                data: offers?.data || [],
                error: offers?.success === false ? offers?.error : undefined,
              });
            } else {
              // Multi-store flow: iterate sources and collect offers
              const allOffers = [];
              for (const src of sources) {
                let url = "";
                const q = encodeURIComponent(query);
                switch (String(src).toLowerCase()) {
                  case "amazon":
                    url = `https://www.amazon.com/s?k=${q}`;
                    break;
                  case "bestbuy":
                    url = `https://www.bestbuy.com/site/searchpage.jsp?st=${q}`;
                    break;
                  case "walmart":
                    url = `https://www.walmart.com/search?q=${q}`;
                    break;
                  case "newegg":
                    url = `https://www.newegg.com/p/pl?d=${q}`;
                    break;
                  case "bh":
                    url = `https://www.bhphotovideo.com/c/search?Ntt=${q}`;
                    break;
                  case "target":
                    url = `https://www.target.com/s?searchTerm=${q}`;
                    break;
                  default:
                    continue;
                }

                const open = await webAutomationService.openUrl(
                  url,
                  request.newTab !== false
                );
                const targetTabId = open?.id
                  ? open.id
                  : tabContextManager.activeTabId ||
                    (
                      await chrome.tabs.query({
                        active: true,
                        currentWindow: true,
                      })
                    )[0]?.id;
                if (!targetTabId) continue;

                // Small wait for page load
                await webAutomationService.waitForElement(
                  "body",
                  targetTabId,
                  15000
                );
                const res = await webAutomationService.extractStoreOffers(
                  targetTabId,
                  String(src).toLowerCase(),
                  { maxResults: maxPerSource }
                );
                if (res?.success && Array.isArray(res.data)) {
                  allOffers.push(
                    ...res.data.map((x) => ({
                      ...x,
                      source: String(src).toLowerCase(),
                    }))
                  );
                }
              }

              allOffers.sort(
                (a, b) =>
                  (a.priceValue || Infinity) - (b.priceValue || Infinity)
              );
              const limit = Number(request.maxResults) || allOffers.length || 5;
              sendResponse({
                success: true,
                action: "fetch_prices",
                params: { query, sources, maxPerSource },
                data: allOffers.slice(0, Math.max(1, limit)),
              });
            }
          } catch (e) {
            sendResponse({
              success: false,
              action: "fetch_prices",
              error: String(e),
            });
          }
          break;
        }

        case "upc_lookup": {
          try {
            const query = String(request.query || "").trim();
            if (!query) {
              sendResponse({
                success: false,
                action: "upc_lookup",
                error: "Missing query",
              });
              break;
            }

            const searchUrl = `https://www.upcitemdb.com/upc/${encodeURIComponent(
              query
            )}`;
            const open = await webAutomationService.openUrl(
              searchUrl,
              request.newTab !== false
            );
            const targetTabId = open?.id
              ? open.id
              : tabContextManager.activeTabId ||
                (
                  await chrome.tabs.query({
                    active: true,
                    currentWindow: true,
                  })
                )[0]?.id;
            if (!targetTabId) {
              sendResponse({
                success: false,
                action: "upc_lookup",
                error: "Unable to resolve target tab",
              });
              break;
            }

            // Direct results page; wait for a results container/table
            await webAutomationService.waitForAnySelector(
              [
                "#results, .results, .result-list, table, .table",
                ".panel.panel-default, .panel",
                "ul.list-group, .list-group",
              ],
              targetTabId,
              25000
            );

            // Scrape normalized results (UPC/EAN/ISBN, title, brand, image, link)
            const scraped = await chrome.scripting.executeScript({
              target: { tabId: targetTabId },
              func: () => {
                function extractDigits(text) {
                  return (text || "").replace(/[^0-9Xx]/g, "");
                }
                function isLikelyCode(digits) {
                  const len = digits.length;
                  return (
                    len === 8 ||
                    len === 12 ||
                    len === 13 ||
                    len === 14 ||
                    len === 10 ||
                    len === 9 ||
                    len === 11
                  );
                }
                const items = [];
                // Try structured result blocks
                const rows = Array.from(
                  document.querySelectorAll(
                    "#results .row, .result-list .row, .panel .row, tr, .list-group-item"
                  )
                );
                for (const el of rows) {
                  const titleEl = el.querySelector("h3, h4, a, .title") || el;
                  const title = (titleEl?.textContent || "").trim();
                  let codeText = "";
                  // Common spots for UPC/EAN text
                  const codeCand =
                    el.querySelector(".barcode, .upc, .ean, .isbn") ||
                    el.querySelector("small, .text-muted, .meta");
                  codeText = (codeCand?.textContent || "").trim();
                  if (!codeText) {
                    // Try any digits-heavy text in the block
                    const text = (el.textContent || "")
                      .replace(/\s+/g, " ")
                      .trim();
                    const m = text.match(/\b(\d[\dXx-]{7,})\b/);
                    codeText = m ? m[1] : "";
                  }
                  const digits = extractDigits(codeText);
                  if (!isLikelyCode(digits)) continue;
                  const linkEl =
                    el.querySelector(
                      "a[href*='/upc/'], a[href*='/ean/'], a[href*='/isbn/'], a[href*='/product']"
                    ) || titleEl.closest("a");
                  let href = linkEl?.getAttribute("href") || "";
                  try {
                    if (href) href = new URL(href, location.origin).toString();
                  } catch {}
                  const imgEl = el.querySelector("img");
                  const brandCand = el.querySelector(
                    ".brand, .manufacturer, .vendor"
                  );
                  const brand = (brandCand?.textContent || "").trim();
                  items.push({
                    title,
                    code: digits,
                    codeLength: digits.length,
                    link: href,
                    image: imgEl?.getAttribute("src") || "",
                    brand,
                  });
                }

                // Deduplicate by code
                const seen = new Set();
                const uniq = [];
                for (const it of items) {
                  if (it.code && !seen.has(it.code)) {
                    seen.add(it.code);
                    uniq.push(it);
                  }
                }
                return { success: true, data: uniq };
              },
              args: [],
            });

            const result = scraped?.[0]?.result || { success: false };
            const data = Array.isArray(result.data) ? result.data : [];
            // Normalize type
            const normalized = data.map((x) => {
              let type = "UNKNOWN";
              if (x.codeLength === 8) type = "EAN-8";
              else if (x.codeLength === 12) type = "UPC-A";
              else if (x.codeLength === 13) type = "EAN-13";
              else if (x.codeLength === 14) type = "GTIN-14";
              else if (x.codeLength === 10) type = "ISBN-10";
              else if (x.codeLength === 9 || x.codeLength === 11)
                type = "ISBN?";
              return { ...x, type };
            });

            const limit = Math.max(1, Number(request.maxResults) || 10);
            sendResponse({
              success: result.success !== false,
              action: "upc_lookup",
              params: { query, maxResults: limit },
              data: normalized.slice(0, limit),
              error: result.success === false ? result.error : undefined,
            });
          } catch (e) {
            sendResponse({
              success: false,
              action: "upc_lookup",
              error: String(e),
            });
          }
          break;
        }

        // --- Google Sheets actions ---
        case "sheets_get_token": {
          try {
            const token = await googleSheetsService.getAuthToken(true);
            sendResponse({ success: true, token: !!token });
          } catch (e) {
            sendResponse({ success: false, error: String(e) });
          }
          break;
        }
        case "sheets_read_range": {
          try {
            const spreadsheetId =
              await googleSheetsService.resolveSpreadsheetId(
                request.spreadsheetId
              );
            if (!spreadsheetId) {
              sendResponse({
                success: false,
                error:
                  "Missing spreadsheetId and unable to infer from active tab",
              });
              break;
            }
            const data = await googleSheetsService.readRange(
              spreadsheetId,
              request.range
            );
            sendResponse({
              success: true,
              action: "sheets_read_range",
              params: { spreadsheetId, range: request.range },
              data,
            });
          } catch (e) {
            sendResponse({
              success: false,
              action: "sheets_read_range",
              error: String(e),
            });
          }
          break;
        }
        case "sheets_write_range": {
          try {
            const spreadsheetId =
              await googleSheetsService.resolveSpreadsheetId(
                request.spreadsheetId
              );
            if (!spreadsheetId) {
              sendResponse({
                success: false,
                error:
                  "Missing spreadsheetId and unable to infer from active tab",
              });
              break;
            }
            const data = await googleSheetsService.writeRange(
              spreadsheetId,
              request.range,
              request.values,
              request.valueInputOption || "RAW"
            );
            sendResponse({
              success: true,
              action: "sheets_write_range",
              params: { spreadsheetId, range: request.range },
              data,
            });
          } catch (e) {
            sendResponse({
              success: false,
              action: "sheets_write_range",
              error: String(e),
            });
          }
          break;
        }
        case "sheets_append_rows": {
          try {
            const spreadsheetId =
              await googleSheetsService.resolveSpreadsheetId(
                request.spreadsheetId
              );
            if (!spreadsheetId) {
              sendResponse({
                success: false,
                error:
                  "Missing spreadsheetId and unable to infer from active tab",
              });
              break;
            }
            const data = await googleSheetsService.appendRows(
              spreadsheetId,
              request.range,
              request.values,
              request.valueInputOption || "RAW"
            );
            sendResponse({
              success: true,
              action: "sheets_append_rows",
              params: { spreadsheetId, range: request.range },
              data,
            });
          } catch (e) {
            sendResponse({
              success: false,
              action: "sheets_append_rows",
              error: String(e),
            });
          }
          break;
        }
        case "sheets_append_page_summary": {
          try {
            const spreadsheetId =
              await googleSheetsService.resolveSpreadsheetId(
                request.spreadsheetId
              );
            if (!spreadsheetId) {
              sendResponse({
                success: false,
                error:
                  "Missing spreadsheetId and unable to infer from active tab",
              });
              break;
            }
            const sheetName = request.sheetName || "Sheet1";
            const active = tabContextManager.activeTabId
              ? tabContextManager.getTabContext(tabContextManager.activeTabId)
              : null;
            const summary = buildContextSummary(active);
            if (!summary) {
              sendResponse({
                success: false,
                error: "Active tab context unavailable",
              });
              break;
            }
            const timestamp = new Date().toISOString();
            const values = [
              [
                summary.title || summary.url || "",
                summary.url || "",
                summary.excerpt || "",
                String(summary.words || 0),
                String(summary.score || 0),
                timestamp,
              ],
            ];
            const range = `${sheetName}!A:F`;
            const data = await googleSheetsService.appendRows(
              spreadsheetId,
              range,
              values,
              request.valueInputOption || "RAW"
            );
            sendResponse({
              success: true,
              action: "sheets_append_page_summary",
              params: { spreadsheetId, range },
              data,
            });
          } catch (e) {
            sendResponse({
              success: false,
              action: "sheets_append_page_summary",
              error: String(e),
            });
          }
          break;
        }
        // --- TODO actions ---
        case "todo_create": {
          try {
            const item = await todoService.create(request);
            sendResponse({
              success: true,
              action: "todo_create",
              params: { title: item.title, session: item.session },
              data: item,
            });
          } catch (e) {
            sendResponse({
              success: false,
              action: "todo_create",
              error: String(e),
            });
          }
          break;
        }
        case "todo_list": {
          try {
            const items = await todoService.list(request);
            sendResponse({ success: true, action: "todo_list", data: items });
          } catch (e) {
            sendResponse({
              success: false,
              action: "todo_list",
              error: String(e),
            });
          }
          break;
        }
        case "todo_update": {
          try {
            const item = await todoService.update(request);
            if (!item) {
              sendResponse({
                success: false,
                action: "todo_update",
                error: "Not found",
              });
              break;
            }
            sendResponse({ success: true, action: "todo_update", data: item });
          } catch (e) {
            sendResponse({
              success: false,
              action: "todo_update",
              error: String(e),
            });
          }
          break;
        }
        case "todo_set_status": {
          try {
            const item = await todoService.setStatus(request);
            if (!item) {
              sendResponse({
                success: false,
                action: "todo_set_status",
                error: "Not found",
              });
              break;
            }
            sendResponse({
              success: true,
              action: "todo_set_status",
              data: item,
            });
          } catch (e) {
            sendResponse({
              success: false,
              action: "todo_set_status",
              error: String(e),
            });
          }
          break;
        }
        case "todo_delete": {
          try {
            const removed = await todoService.remove(request);
            sendResponse({
              success: removed,
              action: "todo_delete",
              data: removed,
            });
          } catch (e) {
            sendResponse({
              success: false,
              action: "todo_delete",
              error: String(e),
            });
          }
          break;
        }
        case "todo_clear": {
          try {
            const cleared = await todoService.clear(request);
            sendResponse({
              success: cleared,
              action: "todo_clear",
              data: cleared,
            });
          } catch (e) {
            sendResponse({
              success: false,
              action: "todo_clear",
              error: String(e),
            });
          }
          break;
        }
        case "todo_summary": {
          try {
            const sum = await todoService.summary(request);
            sendResponse({ success: true, action: "todo_summary", data: sum });
          } catch (e) {
            sendResponse({
              success: false,
              action: "todo_summary",
              error: String(e),
            });
          }
          break;
        }

        default:
          sendResponse({ error: "Unknown action" });
      }
    } catch (error) {
      sendResponse({ error: error.message });
    }
  })();

  return true; // Keep message channel open for async response
});

// Action click handler - opens sidepanel
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.error("Failed to open sidepanel:", error);
  }
});

// Helpers for seeding prompts into the sidepanel
async function seedPromptAndOpenSidepanel(promptText, windowId) {
  try {
    if (typeof promptText === "string" && promptText.trim().length > 0) {
      await chrome.storage.local.set({
        seed_prompt: promptText.trim(),
        seed_meta: { createdAt: Date.now(), source: "entry_point" },
      });
    }
    if (windowId) {
      await chrome.sidePanel.open({ windowId });
    } else {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
    }
  } catch (error) {
    console.error("Failed to seed prompt and open sidepanel:", error);
  }
}

// Sidepanel management + context menu creation
chrome.runtime.onInstalled.addListener(() => {
  console.log("Openrouter Panel extension installed");
  try {
    chrome.contextMenus.create({
      id: "sidepanel_ai_ask_page",
      title: "Ask AI about this page",
      contexts: ["page", "frame"],
    });
    chrome.contextMenus.create({
      id: "sidepanel_ai_ask_selection",
      title: "Ask AI about selection",
      contexts: ["selection"],
    });
  } catch (e) {
    // Ignore if already exists
  }
});

// Context menu click handling
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (!tab) return;
    const windowId = tab.windowId;
    if (info.menuItemId === "sidepanel_ai_ask_page") {
      const prompt = "Summarize this page and answer likely questions.";
      await seedPromptAndOpenSidepanel(prompt, windowId);
    } else if (info.menuItemId === "sidepanel_ai_ask_selection") {
      const sel = (info.selectionText || "").trim();
      const prompt = sel
        ? `Explain the following selection, provide key takeaways, and answer questions.\n\n${sel}`
        : "Explain the current selection on this page.";
      await seedPromptAndOpenSidepanel(prompt, windowId);
    }
  } catch (error) {
    console.error("Context menu handler error:", error);
  }
});

// Keyboard command handling
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const windowId = activeTab?.windowId;
    switch (command) {
      case "open_sidepanel":
        await seedPromptAndOpenSidepanel("", windowId);
        break;
      case "summarize_page":
        await seedPromptAndOpenSidepanel("Summarize this page.", windowId);
        break;
      case "ask_selection": {
        let selectionText = "";
        try {
          if (activeTab?.id) {
            const res = await chrome.tabs.sendMessage(activeTab.id, {
              action: "get_selection",
            });
            selectionText = (res && res.text) || "";
          }
        } catch (_e) {
          // No content script on this page or restricted context
        }
        const prompt = selectionText
          ? `Explain the following selection, provide key takeaways, and answer questions.\n\n${selectionText}`
          : "Explain the current selection on this page.";
        await seedPromptAndOpenSidepanel(prompt, windowId);
        break;
      }
    }
  } catch (error) {
    console.error("Command handler error:", error);
  }
});
