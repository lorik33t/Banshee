import { create } from 'zustand'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

export type EditorFile = {
  path: string
  name: string
  content: string
  originalContent: string
  dirty: boolean
  isSaving: boolean
}

export type EditorState = {
  openFiles: EditorFile[]
  activePath?: string
  openFile: (path: string, opts?: { initialContent?: string; skipDiskRead?: boolean }) => Promise<void>
  setActiveFile: (path?: string) => void
  closeFile: (path: string) => void
  updateContent: (path: string, content: string) => void
  saveFile: (path: string) => Promise<void>
  saveAll: () => Promise<void>
  reset: () => void
}

function normalizePath(path: string): string {
  if (!path) return ''
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export const useEditor = create<EditorState>((set, get) => ({
  openFiles: [],
  activePath: undefined,

  openFile: async (rawPath, opts) => {
    const path = normalizePath(rawPath)
    if (!path) return

    const state = get()
    const existing = state.openFiles.find((file) => file.path === path)
    if (existing) {
      set({ activePath: path })
      if (opts?.initialContent !== undefined) {
        set((prev) => ({
          openFiles: prev.openFiles.map((f) =>
            f.path === path
              ? {
                  ...f,
                  content: opts.initialContent ?? '',
                  dirty: (opts.initialContent ?? '') !== f.originalContent,
                }
              : f
          ),
        }))
      }
      return
    }

    let content = opts?.initialContent ?? ''
    let original = content

    if (!opts?.skipDiskRead) {
      try {
        const diskContent = await readTextFile(path)
        content = opts?.initialContent ?? diskContent
        original = diskContent
      } catch (err) {
        console.warn('[Editor] Failed to read file', path, err)
      }
    }

    const file: EditorFile = {
      path,
      name: path.split('/').pop() || path,
      content,
      originalContent: original,
      dirty: content !== original,
      isSaving: false,
    }

    set((prev) => ({
      openFiles: [...prev.openFiles, file],
      activePath: path,
    }))
  },

  setActiveFile: (rawPath) => {
    if (rawPath === undefined || rawPath === null) {
      set({ activePath: undefined })
      return
    }
    const path = normalizePath(rawPath)
    set((prev) => ({ activePath: prev.openFiles.some((f) => f.path === path) ? path : prev.activePath }))
  },

  closeFile: (rawPath) => {
    const path = normalizePath(rawPath)
    set((prev) => {
      const files = prev.openFiles.filter((file) => file.path !== path)
      const fallback = files[files.length - 1]?.path
      const activePath = prev.activePath === path ? fallback : prev.activePath
      return { openFiles: files, activePath }
    })
  },

  updateContent: (rawPath, content) => {
    const path = normalizePath(rawPath)
    set((prev) => ({
      openFiles: prev.openFiles.map((file) =>
        file.path === path
          ? {
              ...file,
              content,
              dirty: content !== file.originalContent,
            }
          : file
      ),
    }))
  },

  saveFile: async (rawPath) => {
    const path = normalizePath(rawPath)
    const state = get()
    const file = state.openFiles.find((f) => f.path === path)
    if (!file) return

    set((prev) => ({
      openFiles: prev.openFiles.map((f) => (f.path === path ? { ...f, isSaving: true } : f)),
    }))

    try {
      await writeTextFile(path, file.content)
      set((prev) => ({
        openFiles: prev.openFiles.map((f) =>
          f.path === path
            ? {
                ...f,
                originalContent: f.content,
                dirty: false,
                isSaving: false,
              }
            : f
        ),
      }))
    } catch (err) {
      console.error('[Editor] Failed to save file', path, err)
      set((prev) => ({
        openFiles: prev.openFiles.map((f) => (f.path === path ? { ...f, isSaving: false } : f)),
      }))
      throw err
    }
  },

  saveAll: async () => {
    const state = get()
    for (const file of state.openFiles) {
      if (file.dirty) {
        await get().saveFile(file.path)
      }
    }
  },

  reset: () => set({ openFiles: [], activePath: undefined }),
}))
