import './index.css'
import { ChatView } from './components/ChatView'
import { Composer } from './components/Composer'

export default function App() {
  return (
    <div className="app">
      <ChatView />
      <Composer />
    </div>
  )
}

