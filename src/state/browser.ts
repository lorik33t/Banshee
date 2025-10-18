import { create } from 'zustand'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

export type BrowserContext = {
  window: WebviewWindow
  url: string
}

type BrowserState = {
  isAvailable: boolean
  isStarting: boolean
  isStopping: boolean
  activeContext?: BrowserContext
  error?: string
  start: (url?: string) => Promise<void>
  stop: () => Promise<void>
  navigate: (url: string) => Promise<void>
}

const WINDOW_LABEL = 'banshee-browser'

export const normalizeBrowserUrl = (value?: string): string => {
  const trimmed = value?.trim()
  if (!trimmed) return 'about:blank'
  if (/^(https?:|about:|chrome:|file:)/i.test(trimmed)) return trimmed
  return `http://${trimmed}`
}

const resolveWindow = (context: BrowserContext | WebviewWindow): WebviewWindow =>
  context instanceof WebviewWindow ? context : context.window

export const useBrowserState = create<BrowserState>((set, get) => ({
  isAvailable: false,
  isStarting: false,
  isStopping: false,
  activeContext: undefined,
  error: undefined,

  start: async (url) => {
    if (get().isStarting) return
    set({ isStarting: true, error: undefined })

    try {
      const target = normalizeBrowserUrl(url)
      await tauriInvoke('webview_create', { url: target })

      const existing = WebviewWindow.getByLabel(WINDOW_LABEL)
      if (existing) await existing.close()

      const window = new WebviewWindow(WINDOW_LABEL, {
        url: target,
        title: 'Banshee Browser',
        width: 1280,
        height: 720,
      })

      set({
        isAvailable: true,
        activeContext: { window, url: target },
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ isStarting: false })
    }
  },

  stop: async () => {
    if (get().isStopping) return
    set({ isStopping: true, error: undefined })

    try {
      await tauriInvoke('stop_browser_session')
      const ctx = get().activeContext ?? WebviewWindow.getByLabel(WINDOW_LABEL)
      if (ctx) {
        try {
          await resolveWindow(ctx).close()
        } catch {}
      }
      set({ isAvailable: false, activeContext: undefined })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ isStopping: false })
    }
  },

  navigate: async (url) => {
    const ctx = get().activeContext ?? WebviewWindow.getByLabel(WINDOW_LABEL)
    if (!ctx) return
    const target = normalizeBrowserUrl(url)

    try {
      await tauriInvoke('webview_navigate', { url: target })
      const window = resolveWindow(ctx)
      await window.eval(`window.location.replace(${JSON.stringify(target)})`)
      set({ activeContext: { window, url: target } })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },
}))
