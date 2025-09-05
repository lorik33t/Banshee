import React, { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSession } from '../state/session';

export function TerminalView2() {
  // Session-only state - no persistence
  const [entries, setEntries] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [sessionHistory, setSessionHistory] = useState<string[]>([]); // Only this session
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Initialize workingDir from session immediately to avoid race conditions
  const initialProjectDir = useSession.getState().projectDir;
  const [workingDir, setWorkingDir] = useState(initialProjectDir || '');
  
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const projectDir = useSession((s) => s.projectDir);
  const showTerminal = useSession((s) => s.showTerminal);
  const terminalIdRef = useRef('');
  
  // Initialize and keep working directory in sync with active project
  useEffect(() => {
    if (projectDir && projectDir !== workingDir) {
      setWorkingDir(projectDir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectDir]);

  // Also re-sync when terminal is shown to avoid stale paths when it mounted before projectDir was set
  useEffect(() => {
    if (showTerminal && projectDir && workingDir !== projectDir) {
      setWorkingDir(projectDir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTerminal]);
  
  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, currentInput]);
  
  // Focus terminal on click
  const handleTerminalClick = useCallback((e: React.MouseEvent) => {
    // Get click position for cursor placement
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    
    // Estimate character position based on click
    const charWidth = 8; // Approximate character width in monospace
    const promptLength = getPrompt().length;
    const clickPosition = Math.max(0, Math.floor((clickX - (promptLength * charWidth)) / charWidth));
    const newPosition = Math.min(clickPosition, currentInput.length);
    
    setCursorPosition(newPosition);
    hiddenInputRef.current?.focus();
  }, [currentInput]);
  
  // Auto-focus on mount
  useEffect(() => {
    hiddenInputRef.current?.focus();
  }, []);

  // Create terminal session and listen for output
  useEffect(() => {
    const id = crypto.randomUUID();
    terminalIdRef.current = id;
    invoke('create_terminal', { id });
    const unlistenPromise = listen<string>(`terminal:output:${id}`, event => {
      setEntries(prev => [...prev, event.payload]);
    });
    return () => {
      unlistenPromise.then((f) => f());
      invoke('close_terminal', { id });
    };
  }, []);
  
  
  // Handle keyboard input with proper text editing
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't prevent default for Cmd/Ctrl+T (terminal toggle)
    if ((e.metaKey || e.ctrlKey) && e.key === 't') {
      return;
    }
    
    e.preventDefault();

    if (e.key === 'Enter') {
      if (currentInput.trim()) {
        if (currentInput.trim() === 'clear') {
          setEntries([]);
        } else {
          if (terminalIdRef.current) {
            invoke('write_to_terminal', { id: terminalIdRef.current, data: currentInput + '\n' });
          }
          setSessionHistory(prev => {
            const newHistory = [currentInput, ...prev.filter(cmd => cmd !== currentInput)];
            return newHistory.slice(0, 50);
          });
        }
      }
      setCurrentInput('');
      setCursorPosition(0);
      setHistoryIndex(-1);
    } else if (e.key === 'Backspace') {
      if (cursorPosition > 0) {
        const newInput = currentInput.slice(0, cursorPosition - 1) + currentInput.slice(cursorPosition);
        setCurrentInput(newInput);
        setCursorPosition(cursorPosition - 1);
      }
    } else if (e.key === 'Delete') {
      if (cursorPosition < currentInput.length) {
        const newInput = currentInput.slice(0, cursorPosition) + currentInput.slice(cursorPosition + 1);
        setCurrentInput(newInput);
        // Cursor position stays the same
      }
    } else if (e.key === 'ArrowLeft') {
      setCursorPosition(Math.max(0, cursorPosition - 1));
    } else if (e.key === 'ArrowRight') {
      setCursorPosition(Math.min(currentInput.length, cursorPosition + 1));
    } else if (e.key === 'Home' || (e.ctrlKey && e.key === 'a')) {
      setCursorPosition(0);
    } else if (e.key === 'End' || (e.ctrlKey && e.key === 'e')) {
      setCursorPosition(currentInput.length);
    } else if (e.key === 'ArrowUp') {
      // Navigate session history only
      if (sessionHistory.length > 0 && historyIndex < sessionHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        const command = sessionHistory[newIndex];
        setCurrentInput(command);
        setCursorPosition(command.length);
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        const command = sessionHistory[newIndex];
        setCurrentInput(command);
        setCursorPosition(command.length);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCurrentInput('');
        setCursorPosition(0);
      }
    } else if (e.ctrlKey && e.key === 'c') {
      // Ctrl+C - send interrupt signal
      if (terminalIdRef.current) {
        invoke('write_to_terminal', { id: terminalIdRef.current, data: '\u0003' });
      }
      setCurrentInput('');
      setCursorPosition(0);
      setHistoryIndex(-1);
    } else if (e.ctrlKey && e.key === 'd') {
      // Ctrl+D - send EOF
      if (terminalIdRef.current) {
        invoke('write_to_terminal', { id: terminalIdRef.current, data: '\u0004' });
      }
    } else if (e.ctrlKey && e.key === 'l') {
      // Ctrl+L - clear terminal
      setEntries([]);
    } else if (e.ctrlKey && e.key === 'u') {
      // Ctrl+U - clear line
      setCurrentInput('');
      setCursorPosition(0);
    } else if (e.ctrlKey && e.key === 'k') {
      // Ctrl+K - clear from cursor to end
      setCurrentInput(currentInput.slice(0, cursorPosition));
    } else if (e.ctrlKey && e.key === 'w') {
      // Ctrl+W - delete previous word
      const beforeCursor = currentInput.slice(0, cursorPosition);
      const afterCursor = currentInput.slice(cursorPosition);
      const words = beforeCursor.split(' ');
      words.pop(); // Remove last word
      const newBefore = words.join(' ') + (words.length > 0 ? ' ' : '');
      setCurrentInput(newBefore + afterCursor);
      setCursorPosition(newBefore.length);
    } else if (e.key === 'Tab') {
      // Tab - add spaces for now (could implement completion later)
      const newInput = currentInput.slice(0, cursorPosition) + '  ' + currentInput.slice(cursorPosition);
      setCurrentInput(newInput);
      setCursorPosition(cursorPosition + 2);
    } else if (e.key.length === 1 && !e.metaKey) {
      // Insert character at cursor position
      const newInput = currentInput.slice(0, cursorPosition) + e.key + currentInput.slice(cursorPosition);
      setCurrentInput(newInput);
      setCursorPosition(cursorPosition + 1);
    }
  };
  
  // Get terminal prompt
  const getPrompt = () => {
    const dir = workingDir.split('/').pop() || workingDir;
    return `${dir} $ `;
  };
  
  
  // Render input with cursor
  const renderInputWithCursor = () => {
    const beforeCursor = currentInput.slice(0, cursorPosition);
    const afterCursor = currentInput.slice(cursorPosition);
    
    return (
      <span className="terminal-input-text">
        {beforeCursor}
        <span className="terminal-cursor" />
        {afterCursor}
      </span>
    );
  };
  
  return (
    <div 
      className="terminal-view2" 
      onClick={handleTerminalClick}
    >
      <div className="terminal2-header">
        <div className="terminal2-left">
          <div className="terminal2-traffic" aria-hidden="true">
            <span className="dot red" />
            <span className="dot yellow" />
            <span className="dot green" />
          </div>
          <span className="terminal2-title">Terminal</span>
          <span className="terminal2-path">{workingDir}</span>
          <span className="terminal2-session-info">• Session-only history</span>
        </div>
        <div className="terminal2-controls">
          <button
            onClick={() => setEntries([])}
          >
            Clear
          </button>
        </div>
      </div>
      
      <div className="terminal2-body" ref={scrollRef}>
        {entries.map((entry, idx) => (
          <pre key={idx} className="terminal-output">
            {entry}
          </pre>
        ))}

        {/* Current input line */}
        <div className="terminal-entry current-input">
          <div className="terminal-command-line">
            <span className="terminal-prompt">{getPrompt()}</span>
            {renderInputWithCursor()}
          </div>
        </div>
      </div>
      
      {/* Hidden input for capturing keyboard events */}
      <input
        ref={hiddenInputRef}
        type="text"
        className="terminal2-hidden-input"
        onKeyDown={handleKeyDown}
        value=""
        onChange={() => {}}
        autoFocus
      />
    </div>
  );
}