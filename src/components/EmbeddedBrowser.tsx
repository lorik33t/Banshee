import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../state/session";

type EmbeddedBrowserProps = {
  url: string;
  reloadKey: number;
  onUrlChange?: (url: string) => void;
};

type SelectedElement = {
  selector: string;
  tagName: string;
  textContent: string;
  innerHTML: string;
  outerHTML: string;
  attributes: Record<string, string>;
  summary: string;
};

const MAX_HTML_SNIPPET = 1500;
const MAX_TEXT_SNIPPET = 400;

const escapeCss = (value: string): string => {
  if (
    typeof window !== "undefined" &&
    typeof window.CSS?.escape === "function"
  ) {
    return window.CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
};

export function EmbeddedBrowser({
  url,
  reloadKey,
  onUrlChange,
}: EmbeddedBrowserProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const docRef = useRef<Document | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const inspectModeRef = useRef(false);

  const [inspectMode, setInspectMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [domAccessError, setDomAccessError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [textValue, setTextValue] = useState("");
  const [htmlValue, setHtmlValue] = useState("");
  const [classValue, setClassValue] = useState("");
  const [styleValue, setStyleValue] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const setBrowserSelection = useSession((s) => s.setBrowserSelection);
  const clearBrowserSelection = useSession((s) => s.clearBrowserSelection);
  const browserSelectionActive = useSession((s) => Boolean(s.browserSelection));

  const clearHighlight = useCallback(() => {
    const overlay = highlightRef.current;
    if (overlay) {
      overlay.style.display = "none";
    }
  }, []);

  const updateHighlight = useCallback(
    (element: Element | null) => {
      const doc = docRef.current;
      if (!doc) {
        return;
      }

      if (!element) {
        clearHighlight();
        return;
      }

      let overlay = highlightRef.current;
      if (!overlay) {
        overlay = doc.createElement("div");
        overlay.style.position = "absolute";
        overlay.style.pointerEvents = "none";
        overlay.style.border = "2px solid var(--accent)";
        overlay.style.background = "rgba(8, 145, 178, 0.15)";
        overlay.style.boxShadow = "0 0 0 9999px rgba(8, 145, 178, 0.08)";
        overlay.style.borderRadius = "6px";
        overlay.style.zIndex = "2147483646";
        overlay.className = "embedded-browser-highlight";
        doc.body.appendChild(overlay);
        highlightRef.current = overlay;
      }

      const rect = element.getBoundingClientRect();
      const scrollX = doc.defaultView?.scrollX ?? 0;
      const scrollY = doc.defaultView?.scrollY ?? 0;

      overlay.style.display = "block";
      overlay.style.left = `${rect.left + scrollX}px`;
      overlay.style.top = `${rect.top + scrollY}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    },
    [clearHighlight],
  );

  const buildSelector = useCallback((element: Element): string => {
    if (element.id) {
      return `#${escapeCss(element.id)}`;
    }

    const doc = docRef.current;
    const parts: string[] = [];
    let current: Element | null = element;

    while (
      current &&
      current.nodeType === Node.ELEMENT_NODE &&
      current !== doc?.documentElement
    ) {
      if (current.id) {
        parts.unshift(`#${escapeCss(current.id)}`);
        break;
      }

      let selector = current.tagName.toLowerCase();
      const classNames = Array.from(current.classList);
      if (classNames.length > 0 && classNames.length <= 3) {
        selector += `.${classNames.map(escapeCss).join(".")}`;
      }

      const parent: Element | null = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children) as Element[];
        const matchingSiblings = siblings.filter(
          (child) => child.tagName === current!.tagName,
        );
        if (matchingSiblings.length > 1) {
          const index =
            matchingSiblings.findIndex((child) => child === current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      parts.unshift(selector);
      current = parent;
    }

    return parts.join(" > ");
  }, []);

  const snapshotElement = useCallback(
    (element: Element): SelectedElement => {
      const attributes: Record<string, string> = {};
      Array.from(element.attributes).forEach((attr) => {
        attributes[attr.name] = attr.value;
      });

      const tagName = element.tagName.toLowerCase();
      const classSegment = attributes.class
        ? `.${attributes.class.split(/\s+/).filter(Boolean).join(".")}`
        : "";
      const summary = `${tagName}${attributes.id ? `#${attributes.id}` : ""}${classSegment}`;
      const isHTMLElement = element instanceof HTMLElement;
      const innerHTML = isHTMLElement ? element.innerHTML : "";
      const outerHTML = isHTMLElement
        ? (element.outerHTML ?? innerHTML)
        : new XMLSerializer().serializeToString(element);

      return {
        selector: buildSelector(element),
        tagName,
        textContent: element.textContent ?? "",
        innerHTML,
        outerHTML,
        attributes,
        summary,
      };
    },
    [buildSelector],
  );

  const resolveSelectedElement = useCallback((): HTMLElement | null => {
    const doc = docRef.current;
    if (!doc || !selected) return null;
    try {
      return doc.querySelector<HTMLElement>(selected.selector);
    } catch {
      return null;
    }
  }, [selected]);

  const handleSelectElement = useCallback(
    (element: Element) => {
      setSelected(snapshotElement(element));
      updateHighlight(element);
      setStatusMessage(null);
    },
    [snapshotElement, updateHighlight],
  );

  const cleanupInspector = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (highlightRef.current && highlightRef.current.parentElement) {
      highlightRef.current.parentElement.removeChild(highlightRef.current);
    }
    highlightRef.current = null;
    docRef.current = null;
  }, []);

  const attachInspector = useCallback(() => {
    cleanupInspector();
    const iframe = iframeRef.current;
    if (!iframe) return;

    try {
      const doc =
        iframe.contentDocument ?? iframe.contentWindow?.document ?? null;
      if (!doc) {
        throw new Error("document unavailable");
      }
      // Touching body to assert same-origin access
      void doc.body?.children.length;
      setDomAccessError(null);
      docRef.current = doc;
    } catch {
      setDomAccessError(
        "Embedded page is on a different origin. Inspect and edit are disabled.",
      );
      setInspectMode(false);
      setSelected(null);
      docRef.current = null;
      cleanupInspector();
      return;
    }

    const doc = docRef.current;
    if (!doc) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!inspectModeRef.current) return;
      const target = event.target as Element | null;
      if (target) {
        updateHighlight(target);
      }
    };

    const handleMouseLeave = () => {
      if (!inspectModeRef.current) return;
      clearHighlight();
    };

    const handleClick = (event: MouseEvent) => {
      if (!inspectModeRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.target as Element | null;
      if (target) {
        handleSelectElement(target);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!inspectModeRef.current) return;
      if (event.key === "Escape" || event.key === "Esc") {
        event.stopPropagation();
        setInspectMode(false);
        clearHighlight();
      }
    };

    doc.addEventListener("mousemove", handleMouseMove, true);
    doc.addEventListener("mouseleave", handleMouseLeave, true);
    doc.addEventListener("click", handleClick, true);
    doc.addEventListener("keydown", handleKeyDown, true);

    cleanupRef.current = () => {
      doc.removeEventListener("mousemove", handleMouseMove, true);
      doc.removeEventListener("mouseleave", handleMouseLeave, true);
      doc.removeEventListener("click", handleClick, true);
      doc.removeEventListener("keydown", handleKeyDown, true);
      clearHighlight();
    };
  }, [cleanupInspector, clearHighlight, handleSelectElement, updateHighlight]);

  useEffect(() => {
    inspectModeRef.current = inspectMode;
    if (!inspectMode) {
      clearHighlight();
    }
  }, [inspectMode, clearHighlight]);

  useEffect(() => {
    const element = resolveSelectedElement();
    if (!selected) {
      setTextValue("");
      setHtmlValue("");
      setClassValue("");
      setStyleValue("");
      return;
    }
    if (!element) {
      setStatusMessage("Selected element is no longer in the document.");
      setSelected(null);
      return;
    }
    setTextValue(element.textContent ?? "");
    setHtmlValue(element.innerHTML);
    setClassValue(element.getAttribute("class") ?? "");
    setStyleValue(element.getAttribute("style") ?? "");
  }, [selected, resolveSelectedElement]);

  useEffect(() => {
    const element = resolveSelectedElement();
    if (selected && element) {
      updateHighlight(element);
    }
  }, [selected, resolveSelectedElement, updateHighlight]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      setIsLoading(false);
      attachInspector();
      setSelected(null);
      setStatusMessage(null);
      try {
        const nextUrl = iframe.contentWindow?.location.href;
        if (nextUrl && onUrlChange) {
          onUrlChange(nextUrl);
        }
      } catch {
        // Ignore cross-origin access, it will be caught in attachInspector
      }
    };

    iframe.addEventListener("load", handleLoad);
    return () => {
      iframe.removeEventListener("load", handleLoad);
      cleanupInspector();
    };
  }, [attachInspector, cleanupInspector, onUrlChange]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setIsLoading(true);
    try {
      if (iframe.src !== url) {
        iframe.src = url;
      } else {
        iframe.contentWindow?.location.replace(url);
      }
    } catch {
      iframe.src = url;
    }
  }, [url]);

  useEffect(() => {
    if (reloadKey === 0) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    setIsLoading(true);
    try {
      iframe.contentWindow?.location.reload();
    } catch {
      iframe.src = url;
    }
  }, [reloadKey, url]);

  useEffect(() => {
    if (!selected) {
      clearBrowserSelection();
      return;
    }

    const iframe = iframeRef.current;
    const href = iframe?.contentWindow?.location.href;
    const condensedText = selected.textContent
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT_SNIPPET);
    const trimmedHtml = selected.outerHTML.trim();
    const htmlSnippet =
      trimmedHtml.length > MAX_HTML_SNIPPET
        ? `${trimmedHtml.slice(0, MAX_HTML_SNIPPET)}…`
        : trimmedHtml;

    setBrowserSelection({
      selector: selected.selector,
      summary: selected.summary,
      textContent: condensedText ? condensedText : undefined,
      outerHTML: htmlSnippet ? htmlSnippet : undefined,
      url: href ?? undefined,
      includeInNextMessage: true,
      capturedAt: Date.now(),
    });
  }, [selected, setBrowserSelection, clearBrowserSelection]);

  useEffect(() => {
    if (!browserSelectionActive && selected) {
      setSelected(null);
      setStatusMessage(null);
      clearHighlight();
    }
  }, [browserSelectionActive, selected, clearHighlight]);

  const elementSummary = useMemo(() => selected?.summary ?? "", [selected]);

  const applyTextContent = useCallback(() => {
    const element = resolveSelectedElement();
    if (!element) {
      setStatusMessage("Cannot update text; element not found.");
      setSelected(null);
      return;
    }
    element.textContent = textValue;
    handleSelectElement(element);
    setStatusMessage("Updated text content.");
  }, [handleSelectElement, resolveSelectedElement, textValue]);

  const applyInnerHtml = useCallback(() => {
    const element = resolveSelectedElement();
    if (!element) {
      setStatusMessage("Cannot update markup; element not found.");
      setSelected(null);
      return;
    }
    element.innerHTML = htmlValue;
    handleSelectElement(element);
    setStatusMessage("Updated inner HTML.");
  }, [handleSelectElement, htmlValue, resolveSelectedElement]);

  const applyClassName = useCallback(() => {
    const element = resolveSelectedElement();
    if (!element) {
      setStatusMessage("Cannot update classes; element not found.");
      setSelected(null);
      return;
    }
    element.className = classValue;
    handleSelectElement(element);
    setStatusMessage("Updated class attribute.");
  }, [classValue, handleSelectElement, resolveSelectedElement]);

  const applyInlineStyle = useCallback(() => {
    const element = resolveSelectedElement();
    if (!element) {
      setStatusMessage("Cannot update style; element not found.");
      setSelected(null);
      return;
    }
    if (styleValue.trim().length === 0) {
      element.removeAttribute("style");
    } else {
      element.setAttribute("style", styleValue);
    }
    handleSelectElement(element);
    setStatusMessage("Updated inline styles.");
  }, [handleSelectElement, resolveSelectedElement, styleValue]);

  const scrollSelectionIntoView = useCallback(() => {
    const element = resolveSelectedElement();
    if (!element) {
      setStatusMessage("Cannot scroll; element not found.");
      setSelected(null);
      return;
    }
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    updateHighlight(element);
  }, [resolveSelectedElement, updateHighlight]);

  const removeSelection = useCallback(() => {
    const element = resolveSelectedElement();
    if (!element) {
      setStatusMessage("Nothing to remove; element already gone.");
      setSelected(null);
      return;
    }
    element.remove();
    setSelected(null);
    setStatusMessage("Element removed from the page.");
  }, [resolveSelectedElement]);

  return (
    <div className="embedded-browser">
      <div className="embedded-browser-controls">
        <div className="embedded-browser-mode">
          <button
            type="button"
            className={`btn btn--ghost ${!inspectMode ? "active" : ""}`}
            onClick={() => setInspectMode(false)}
          >
            Browse
          </button>
          <button
            type="button"
            className={`btn btn--ghost ${inspectMode ? "active" : ""}`}
            onClick={() => setInspectMode(true)}
            disabled={Boolean(domAccessError)}
          >
            Inspect & Edit
          </button>
        </div>
        <div className="embedded-browser-status">
          {isLoading && (
            <span className="embedded-browser-status-loading">Loading…</span>
          )}
          {domAccessError && (
            <span className="embedded-browser-status-warning">
              {domAccessError}
            </span>
          )}
          {!domAccessError && statusMessage && (
            <span className="embedded-browser-status-note">
              {statusMessage}
            </span>
          )}
        </div>
      </div>

      <div className="embedded-browser-stage">
        <div className="embedded-browser-frame">
          <iframe
            ref={iframeRef}
            className="embedded-browser-iframe"
            title="Embedded preview"
          />
        </div>
        <aside className="embedded-browser-inspector">
          {domAccessError ? (
            <div className="embedded-browser-empty">
              <p>{domAccessError}</p>
              <p>
                Launch your app on the same origin to unlock inline editing.
              </p>
            </div>
          ) : selected ? (
            <div className="embedded-browser-editor">
              <header className="embedded-browser-editor-header">
                <div className="embedded-browser-selector">
                  <span className="embedded-browser-selector-label">
                    Selected
                  </span>
                  <strong title={selected.selector}>
                    {elementSummary || selected.selector}
                  </strong>
                </div>
                <div className="embedded-browser-editor-actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={scrollSelectionIntoView}
                  >
                    Scroll into view
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={removeSelection}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setSelected(null)}
                  >
                    Clear
                  </button>
                </div>
              </header>

              <div className="embedded-browser-field">
                <label htmlFor="embedded-text">Text content</label>
                <textarea
                  id="embedded-text"
                  value={textValue}
                  onChange={(event) => setTextValue(event.target.value)}
                  rows={3}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn btn--accent"
                  onClick={applyTextContent}
                >
                  Update text
                </button>
              </div>

              <div className="embedded-browser-field">
                <label htmlFor="embedded-html">Inner HTML</label>
                <textarea
                  id="embedded-html"
                  value={htmlValue}
                  onChange={(event) => setHtmlValue(event.target.value)}
                  rows={6}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={applyInnerHtml}
                >
                  Update markup
                </button>
              </div>

              <div className="embedded-browser-field">
                <label htmlFor="embedded-classes">Class names</label>
                <input
                  id="embedded-classes"
                  type="text"
                  value={classValue}
                  onChange={(event) => setClassValue(event.target.value)}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={applyClassName}
                >
                  Apply classes
                </button>
              </div>

              <div className="embedded-browser-field">
                <label htmlFor="embedded-style">Inline style</label>
                <textarea
                  id="embedded-style"
                  value={styleValue}
                  onChange={(event) => setStyleValue(event.target.value)}
                  rows={4}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={applyInlineStyle}
                >
                  Apply styles
                </button>
              </div>
            </div>
          ) : (
            <div className="embedded-browser-empty">
              <p>
                Toggle Inspect mode, hover any element to highlight it, then
                click to edit.
              </p>
              <p>
                Changes update the running page instantly so you can iterate
                before committing.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
