import type { SessionEvent } from '../state/session'

// Track partial message content for streaming - OK to be module-level
const partialMessages = new Map<string, string>()

// Track current model being used
let currentModel: string | undefined = undefined

// Track current streaming message id from Claude CLI stream-json
let currentStreamMessageId: string | undefined = undefined

// Track processed message IDs to prevent duplicates (by ID only)
const processedMessageIds = new Set<string>()

function isDuplicateMessage(id: string, _text: string): boolean {
  // Only dedup by unique message ID across events. Content-based dedup is disabled
  // to avoid dropping legitimate short greetings across turns.
  if (processedMessageIds.has(id)) return true
  processedMessageIds.add(id)
  return false
}

// Clear deduplication caches (call this when conversation is cleared)
export function clearDeduplicationCache() {
  processedMessageIds.clear()
  partialMessages.clear()
  currentModel = undefined
  console.log('[claudeParser] Cleared deduplication caches')
}

// Parse Claude Code's stream-json format
// Returns an array of events since Claude can send multiple items in one message
export function parseClaudeEvents(jsonStr: string): SessionEvent[] {
  const events: SessionEvent[] = []
  
  // Create fresh Set for tools for each parse call to avoid cross-contamination
  const processedTools = new Set<string>()
  
  try {
    const data = JSON.parse(jsonStr)
    const ts = Date.now()
    const id = data.id || String(ts)
    const eventType = data.type || data.event
    
    // Removed expensive console logging - only in development
    if (import.meta.env.DEV) {
      console.log('[claudeParser] Processing event:', {
        eventType,
        id,
        hasContent: !!data.content,
        contentLength: typeof data.content === 'string' ? data.content.length : undefined
      })
    }


    // Handle different event types from Claude Code
    switch (eventType) {
      case 'telemetry:tokens':
        events.push({
          type: 'telemetry:tokens',
          tokensIn: Number(data.tokensIn || data.input_tokens || 0),
          tokensOut: Number(data.tokensOut || data.output_tokens || 0),
          cachedTokens: Number(data.cachedTokens || data.cached_content_token_count || 0),
          thoughtsTokens: Number(data.thoughtsTokens || data.thoughts_token_count || 0),
          toolTokens: Number(data.toolTokens || data.tool_token_count || 0),
          latencyMs: Number(data.latencyMs || data.duration_ms || 0),
          ts
        } as any)
        return events
      case 'checkpoint:create':
        // Forward checkpoint proposals from handlers
        events.push({
          type: 'checkpoint:create',
          trigger: data.trigger,
          fileSnapshots: data.fileSnapshots,
          ts
        } as any)
        return events
      case 'message_start':
        // Claude CLI stream-json: marks the start of a new assistant message
        {
          const msgId = (data.message && data.message.id) ? (data.message.id as string) : id
          currentStreamMessageId = msgId
          // initialize accumulator
          partialMessages.set(msgId, '')
        }
        return events

      case 'text':
        // Some providers stream plain text chunks. Thread by current message id when available.
        events.push({
          id: currentStreamMessageId || id,
          type: 'assistant:delta',
          chunk: data.content || data.text || '',
          ts
        } as any)
        return events
      
      case 'content_block_delta':
        // Handle Claude's streaming delta events
        if (data.delta && data.delta.text) {
          // Accumulate into the current stream message so we can emit a final complete
          if (currentStreamMessageId) {
            const prev = partialMessages.get(currentStreamMessageId) || ''
            const next = prev + data.delta.text
            partialMessages.set(currentStreamMessageId, next)
          }
          events.push({
            // Always use the current stream message id so all deltas thread to one message
            id: currentStreamMessageId || id,
            type: 'assistant:delta',
            chunk: data.delta.text,
            ts
          } as any)
        }
        return events
      case 'message_stop':
        // Claude CLI stream-json: end of the assistant message
        if (currentStreamMessageId) {
          const fullText = partialMessages.get(currentStreamMessageId) || ''
          if (fullText) {
            // Dedup check using the message id
            if (!isDuplicateMessage(currentStreamMessageId, fullText)) {
              events.push({
                id: currentStreamMessageId,
                type: 'assistant:complete',
                text: fullText,
                ts
              } as any)
            }
          }
          // cleanup
          partialMessages.delete(currentStreamMessageId)
          currentStreamMessageId = undefined
        }
        return events
      case 'message':
        const messageText = data.content || data.text || ''
        // Check for duplicates by ID and content
        if (isDuplicateMessage(id, messageText)) {
          return events
        }
        
        events.push({
          id,
          type: 'message',
          role: data.role || 'assistant',
          text: messageText,
          model: currentModel,
          ts
        })
        return events
      
      case 'assistant':
        // Claude Code's actual assistant message format
        if (data.message && data.message.content) {
          const content = data.message.content
          const messageId = data.message.id
          // Track active stream message id so later 'result' can align IDs
          if (messageId) {
            currentStreamMessageId = messageId
          }
          
          // Check if content contains tool_use, thinking, or text
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === 'thinking' && item.text) {
                // Handle thinking content
                events.push({
                  id: messageId || id,
                  type: 'thinking',
                  text: item.text,
                  done: true,
                  ts
                })
              } else if (item.type === 'tool_use') {
                // Check if we've already processed this tool
                if (!processedTools.has(item.id)) {
                  processedTools.add(item.id)
                  // Add tool start event
                  const toolName = mapToolName(item.name)
                  events.push({
                    id: item.id || id,
                    type: 'tool:start',
                    tool: toolName,
                    args: item.input || {},
                    ts
                  })
                }
              } else if (item.type === 'text' && item.text) {
                // Check if this is a partial update or complete message
                const existingText = partialMessages.get(messageId) || ''
                // Only treat as complete if stop_reason is explicitly present and not null.
                // Handlers like Gemini/Qwen don't set stop_reason; those should stream deltas.
                const hasStopReason = typeof (data.message as any).stop_reason !== 'undefined' && (data.message as any).stop_reason !== null
                const isComplete = hasStopReason
                
                if (item.text.startsWith(existingText) && item.text.length > existingText.length) {
                  // This is a streaming update - emit delta
                  const delta = item.text.substring(existingText.length)
                  partialMessages.set(messageId, item.text)
                  events.push({
                    id: messageId || id,
                    type: 'assistant:delta',
                    chunk: delta,
                    ts
                  } as any)
                } else if (isComplete) {
                  // This is a complete message - emit the full message
                  partialMessages.set(messageId, item.text)
                  
                  // Check for duplicates by ID and content
                  if (!isDuplicateMessage(messageId || id, item.text)) {
                    // Emit the message
                              // Use complete event for artificial streaming
          events.push({
            id: messageId || id,
            type: 'assistant:complete',
            text: item.text,
            ts
          } as any)
                  }
                  
                  // Clean up completed messages
                  partialMessages.delete(messageId)
                  if (currentStreamMessageId === messageId) currentStreamMessageId = undefined
                } else {
                  // This is a new streaming message - just emit delta
                  const delta = item.text.substring(existingText.length)
                  partialMessages.set(messageId, item.text)
                  if (delta) {
                    events.push({
                      id: messageId || id,
                      type: 'assistant:delta',
                      chunk: delta,
                      ts
                    } as any)
                  }
                }
              }
            }
          } else if (typeof content === 'string') {
            // Check for duplicates by ID and content
            if (!isDuplicateMessage(messageId || id, content)) {
                      // Use complete event for artificial streaming
        events.push({
          id: messageId || id,
          type: 'assistant:complete',
          text: content,
          ts
        } as any)
            }
          }
        }
        return events

      case 'session':
        // Session ID from backend for conversation continuity
        events.push({
          type: 'session',
          sessionId: data.sessionId,
          ts
        } as any)
        return events
        
      case 'system':
        // System messages like init
        return events

      case 'result':
        // Handle Claude CLI JSON format response
        // Create the assistant message from the result
        if (data.result) {
          // IMPORTANT: Do NOT use session_id as the message id here.
          // session_id stays constant across turns, which would cause all subsequent
          // results to be treated as duplicates and ignored.
          // Prefer a provided unique id if present, otherwise fall back to our generated id.
          const messageId = currentStreamMessageId || data.id || id
          // Check for duplicates by ID and content
          if (!isDuplicateMessage(messageId, data.result)) {
            // Emit a complete assistant message for the full result
            events.push({
              id: messageId,
              type: 'assistant:complete',
              text: data.result,
              ts
            } as any)
          }
          // Clean up any accumulated partials and reset stream id if applicable
          if (partialMessages.has(messageId)) partialMessages.delete(messageId)
          if (currentStreamMessageId === messageId) currentStreamMessageId = undefined
        }
        
        // Also update cost/token usage
        if (data.usage) {
          const cost = calculateCost(data.usage.input_tokens || 0, data.usage.output_tokens || 0)
          if (cost > 0) {
            events.push({
              type: 'cost:update',
              usd: cost,
              tokensIn: data.usage.input_tokens || 0,
              tokensOut: data.usage.output_tokens || 0,
              ts
            })
          }
        }
        return events

      case 'tool_use':
      case 'tool_start':
      case 'tool_call':
      case 'tool/started':
      case 'tool:start':
        events.push({
          id,
          type: 'tool:start',
          tool: mapToolName(data.name || data.tool || data.tool_name),
          args: data.input || data.args || data.parameters || {},
          ts
        })
        return events

      case 'tool_result':
      case 'tool_output':
      case 'tool_end':
      case 'tool/finished':
      case 'tool/delta':
      case 'tool/output':
      case 'tool:output':
        // Map tool_use_id to the correct tool id
        const toolId = data.tool_use_id || data.tool_id || data.id || id
        events.push({
          id: toolId,
          type: 'tool:output',
          chunk: data.content || data.output || data.delta || data.text || data.chunk || '',
          done: data.done !== false && eventType !== 'tool/delta' && eventType !== 'tool/output',
          ts
        })
        return events

      case 'error':
        events.push({
          id,
          type: 'message',
          role: 'assistant',
          text: `⚠️ ${data.error?.message || data.message || 'Unknown error'}`,
          ts
        })
        return events

      case 'usage':
      case 'subagent:delegated':
      case 'subagent:started':
        // Track when a subagent starts
        if (data.subagentType) {
          currentModel = data.subagentType
          // Inform UI of model change
          events.push({
            type: 'model:update',
            model: currentModel,
            ts
          } as any)
        }
        return events
      
      case 'subagent:completed':
        // Reset to default Claude when subagent completes  
        currentModel = undefined
        events.push({
          type: 'model:update',
          model: undefined,
          ts
        } as any)
        return events

      case 'cost':
        events.push({
          type: 'cost:update',
          usd: data.cost || calculateCost(data.input_tokens || data.inputTokens, data.output_tokens || data.outputTokens),
          tokensIn: data.input_tokens || data.inputTokens || 0,
          tokensOut: data.output_tokens || data.outputTokens || 0,
          ts
        })
        return events
      case 'cost:update':
        // Normalize any cost/update payload into our cost event shape
        events.push({
          type: 'cost:update',
          usd: Number(data.usd || 0),
          tokensIn: Number(data.tokensIn || data.input_tokens || data.inputTokens || 0),
          tokensOut: Number(data.tokensOut || data.output_tokens || data.outputTokens || 0),
          ts
        } as any)
        return events

      // Claude Code specific events
      case 'assistant_message':
        const assistantText = data.content || ''
        // Check for duplicates by ID and content
        if (!isDuplicateMessage(id, assistantText)) {
          // Use complete event for artificial streaming
          events.push({
            id,
            type: 'assistant:complete',
            text: assistantText,
            ts
          })
        }
        return events

      // Handle user messages with tool results
      case 'user':
      case 'user_message':
        if (data.message && data.message.content) {
          const content = data.message.content
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === 'tool_result') {
                // Add tool output event with the tool_use_id as the id
                events.push({
                  id: item.tool_use_id || id,
                  type: 'tool:output',
                  chunk: item.content || '',
                  done: true,
                  ts
                })
              }
            }
          }
        }
        // The UI already injects the user message locally when sending.
        // Dropping regular user messages avoids echoing the user text twice.
        return events

      default:
        // Heuristics: treat unknown tool-shaped events as tool starts/outputs
        if (data.tool || data.tool_name || data.name) {
          const toolName = mapToolName((data.tool && (data.tool.name || data.tool)) || data.tool_name || data.name)
          const args = data.input || data.args || data.parameters || data.tool?.input || {}
          // If has args but no explicit 'output', consider it a start
          if (Object.keys(args).length > 0 && !data.output && !data.delta) {
            events.push({ id, type: 'tool:start', tool: toolName, args, ts } as any)
            return events
          }
          // Otherwise treat as output
          const chunk = data.output || data.delta || data.stdout || data.stderr || data.content || ''
          if (chunk) {
            events.push({ id, type: 'tool:output', chunk, done: !!data.done, ts } as any)
            return events
          }
        }
        // Return raw for anything else
        events.push({ type: 'raw', payload: data, ts } as any)
        return events
    }
  } catch (err) {
    return []
  }
}

// Backwards compatibility wrapper
export function parseClaudeEvent(jsonStr: string): SessionEvent | null {
  const events = parseClaudeEvents(jsonStr)
  return events.length > 0 ? events[0] : null
}

function mapToolName(name: string): any {
  if (!name) return 'mcp'
  
  // Normalize to lowercase for comparison
  const normalized = name.toLowerCase()
  
  // Special case: preserve 'task' as its own type for subagent detection
  if (normalized === 'task') {
    return 'task'
  }
  
  // Special case: preserve 'todowrite' for Todo list functionality
  if (normalized === 'todowrite') {
    return 'todowrite'
  }
  
  // Map common tool names to categories
  if (normalized.includes('bash') || normalized.includes('command')) {
    return 'bash'
  }
  if (normalized.includes('read') || normalized === 'ls' || normalized.includes('file_read')) {
    return 'read'
  }
  if (normalized.includes('write') || normalized.includes('edit') || normalized.includes('replace') || normalized === 'notebookedit') {
    return 'write'
  }
  if (normalized.includes('grep') || normalized.includes('search') || normalized === 'glob' || normalized.includes('file_search')) {
    return 'grep'
  }
  if (normalized.includes('web') || normalized.includes('fetch')) {
    return 'web'
  }
  
  // Default to mcp for unknown tools
  return 'mcp'
}

function calculateCost(inputTokens: number, outputTokens: number): number {
  // Claude 3.5 Sonnet pricing (approximate)
  const inputCostPer1K = 0.003
  const outputCostPer1K = 0.015
  return (inputTokens * inputCostPer1K + outputTokens * outputCostPer1K) / 1000
}
