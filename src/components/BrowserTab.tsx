import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, RefreshCw, Square, ExternalLink } from "lucide-react";
import { EmbeddedBrowser } from "./EmbeddedBrowser";
import { normalizeBrowserUrl, useBrowserState } from "../state/browser";

const DEFAULT_URL = "http://localhost:5173";

export function BrowserTab() {
  const [input, setInput] = useState(DEFAULT_URL);
  const [embeddedUrl, setEmbeddedUrl] = useState(DEFAULT_URL);
  const [reloadKey, setReloadKey] = useState(0);
  const {
    isAvailable,
    isStarting,
    isStopping,
    activeContext,
    error,
    start,
    stop,
    navigate,
  } = useBrowserState();

  useEffect(() => {
    if (activeContext?.url) {
      setInput(activeContext.url);
      setEmbeddedUrl(activeContext.url);
    }
  }, [activeContext?.url]);

  const canInteract = useMemo(
    () => !isStarting && !isStopping,
    [isStarting, isStopping],
  );

  const handleGo = useCallback(() => {
    const target = normalizeBrowserUrl(input);
    setEmbeddedUrl(target);
  }, [input]);

  const handleReload = useCallback(() => {
    setReloadKey((prev) => prev + 1);
    if (isAvailable) {
      navigate(embeddedUrl).catch(() => {});
    }
  }, [embeddedUrl, isAvailable, navigate]);

  const handleOpenExternal = useCallback(() => {
    const target = normalizeBrowserUrl(input || embeddedUrl);
    start(target).catch(() => {});
  }, [embeddedUrl, input, start]);

  const handleCloseExternal = useCallback(() => {
    stop().catch(() => {});
  }, [stop]);

  const handleInputKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleGo();
      }
    },
    [handleGo],
  );

  const handleEmbeddedUrlChange = useCallback((next: string) => {
    setEmbeddedUrl(next);
    setInput(next);
  }, []);

  useEffect(() => {
    if (!isAvailable) return;
    navigate(embeddedUrl).catch(() => {});
  }, [embeddedUrl, isAvailable, navigate]);

  return (
    <div className="browser-tab">
      <div className="browser-toolbar">
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleInputKey}
          className="browser-address"
          placeholder="https://your-app.local/"
          spellCheck={false}
        />
        <div className="browser-toolbar-buttons">
          <button
            className="browser-toolbar-btn"
            onClick={handleGo}
            title="Navigate embedded preview"
          >
            <ArrowRight size={16} />
          </button>
          <button
            className="browser-toolbar-btn"
            disabled={!canInteract}
            onClick={handleReload}
            title="Reload embedded preview"
          >
            <RefreshCw size={16} />
          </button>
          {isAvailable ? (
            <button
              className="browser-toolbar-btn stop"
              disabled={!canInteract}
              onClick={handleCloseExternal}
              title="Close external browser window"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              className="browser-toolbar-btn start"
              disabled={!canInteract}
              onClick={handleOpenExternal}
              title="Open external browser window"
            >
              <ExternalLink size={16} />
            </button>
          )}
        </div>
      </div>

      {error && <div className="browser-error">{error}</div>}

      <div className="browser-stage">
        <EmbeddedBrowser
          url={embeddedUrl}
          reloadKey={reloadKey}
          onUrlChange={handleEmbeddedUrlChange}
        />
      </div>

      {isAvailable && (
        <div className="browser-external-hint">
          <ExternalLink size={14} />
          <span>
            External Chromium window is running. Use it alongside the embedded
            editor if needed.
          </span>
        </div>
      )}
    </div>
  );
}
