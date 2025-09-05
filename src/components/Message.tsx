import { marked } from 'marked'
import type { MessageEvent } from '../state/session'

function basicSanitize(text: string) {
  return text
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+=["'][^"']*["']/gi, '')
}

export function Message({ message }: { message: MessageEvent }) {
  const html = marked(basicSanitize(message.text))
  return (
    <div className={`message ${message.role}`}>
      <div
        className="message-text markdown-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
