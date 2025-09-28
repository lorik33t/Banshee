export function normalizeDialogSelection(selection: unknown): string | null {
  if (selection == null) {
    return null
  }

  if (Array.isArray(selection)) {
    for (const value of selection) {
      const normalized = normalizeDialogSelection(value)
      if (normalized) return normalized
    }
    return null
  }

  if (typeof selection === 'string') {
    const trimmed = selection.trim()
    if (!trimmed) {
      return null
    }

    const firstChar = trimmed[0]
    const lastChar = trimmed[trimmed.length - 1]
    const looksJsonContainer = (firstChar === '[' && lastChar === ']') || (firstChar === '{' && lastChar === '}')
    if (looksJsonContainer) {
      try {
        return normalizeDialogSelection(JSON.parse(trimmed))
      } catch {
        // Fall through to returning the raw string when JSON parsing fails
      }
    }

    return trimmed
  }

  if (typeof selection === 'object') {
    const candidate = (selection as { path?: unknown; paths?: unknown }).path
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }

    if ('paths' in (selection as object)) {
      return normalizeDialogSelection((selection as { paths?: unknown }).paths)
    }
  }

  return null
}
