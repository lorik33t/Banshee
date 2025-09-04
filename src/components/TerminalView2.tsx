import React, { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSession } from '../state/session';

interface CommandEntry {
  command: string;
  output: string;
  exit_code: number;
  timestamp: number;
}

export function TerminalView2() {
  // Session-only state - no persistence
  const [entries, setEntries] = useState<CommandEntry[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [sessionHistory, setSessionHistory] = useState<string[]>([]); // Only this session
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Initialize workingDir from session immediately to avoid race conditions
  const initialProjectDir = useSession.getState().projectDir;
  const [workingDir, setWorkingDir] = useState(initialProjectDir || '');
  const [isExecuting, setIsExecuting] = useState(false);
  
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const projectDir = useSession((s) => s.projectDir);
  const showTerminal = useSession((s) => s.showTerminal);
  
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
  
  // Execute command
  const executeCommand = async (command: string) => {
    if (!command.trim()) return;
    
    // Handle built-in commands
    if (command.trim() === 'clear') {
      setEntries([]);
      return;
    }
    
    setIsExecuting(true);
    const timestamp = Date.now();
    
    try {
      // If workingDir isn't ready, try to initialize from projectDir or show a helpful message
      if (!workingDir) {
        if (projectDir) {
          setWorkingDir(projectDir);
          setEntries(prev => [...prev, {
            command,
            output: `Initializing terminal in project: ${projectDir}`,
            exit_code: 0,
            timestamp
          }]);
          setIsExecuting(false);
          setHistoryIndex(-1);
          return;
        } else {
          setEntries(prev => [...prev, {
            command,
            output: 'No project open. Use Open Folder to select a project before running terminal commands.',
            exit_code: 1,
            timestamp
          }]);
          setIsExecuting(false);
          setHistoryIndex(-1);
          return;
        }
      }
      // Execute command with current working directory
      const result = await invoke<{ output: string; exit_code: number; cwd: string }>('run_command', {
        command: command.trim(),
        cwd: workingDir
      });
      
      // Update working directory if command succeeded and changed it
      if (result.cwd && result.cwd !== workingDir) {
        setWorkingDir(result.cwd);
      }
      
      // Add entry
      setEntries(prev => [...prev, {
        command,
        output: result.output,
        exit_code: result.exit_code,
        timestamp
      }]);
      
      // Add to SESSION-ONLY history (not persistent)
      setSessionHistory(prev => {
        const newHistory = [command, ...prev.filter(cmd => cmd !== command)];
        return newHistory.slice(0, 50); // Keep last 50 commands in this session only
      });
      
    } catch (error) {
      setEntries(prev => [...prev, {
        command,
        output: `Error: ${error}`,
        exit_code: 1,
        timestamp
      }]);
    }
    
    setIsExecuting(false);
    setHistoryIndex(-1);
  };
  
  // Handle keyboard input with proper text editing
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't prevent default for Cmd/Ctrl+T (terminal toggle)
    if ((e.metaKey || e.ctrlKey) && e.key === 't') {
      return;
    }
    
    e.preventDefault();
    
    if (e.key === 'Enter') {
      if (currentInput.trim()) {
        executeCommand(currentInput);
      }
      setCurrentInput('');
      setCursorPosition(0);
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
      // Ctrl+C - clear current input
      setCurrentInput('');
      setCursorPosition(0);
      setHistoryIndex(-1);
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
  
  // Format output for display
  const formatOutput = (output: string, command: string) => {
    if (!output) return '';
    
    // Clean up output
    const cleaned = output
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
    
    // Smart formatting for common commands
    const cmd = command.trim().split(' ')[0];
    
    // Format directory listings in columns
    if (cmd === 'ls' || cmd === 'll' || cmd === 'dir') {
      const items = cleaned.split('\n').filter(line => line.trim());
      
      // If it's a detailed listing (ls -l), keep line format
      if (items.some(item => item.match(/^[drwx-]{10}/) || item.includes('total '))) {
        return cleaned;
      }
      
      // For simple ls, format in columns to use horizontal space
      if (items.length > 1) {
        // Estimate available characters based on scroll container width
        const containerWidthPx = scrollRef.current?.clientWidth ?? 800;
        const charWidthPx = 8; // approx monospace char width
        const terminalWidth = Math.max(40, Math.floor(containerWidthPx / charWidthPx));

        const maxItemLength = Math.max(...items.map(item => item.length));
        const columnWidth = Math.max(maxItemLength + 2, 12); // minimal spacing between columns
        const columnsCount = Math.max(1, Math.floor(terminalWidth / columnWidth));

        let formatted = '';
        for (let i = 0; i < items.length; i += columnsCount) {
          const row = items.slice(i, i + columnsCount);
          const paddedRow = row.map(item => item.padEnd(columnWidth)).join('');
          formatted += paddedRow.trimEnd() + '\n';
        }
        return formatted.trim();
      }
    }
    
    return cleaned;
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
            disabled={isExecuting}
          >
            Clear
          </button>
        </div>
      </div>
      
      <div className="terminal2-body" ref={scrollRef}>
        {/* Command entries */}
        {entries.map((entry, idx) => (
          <div key={idx} className="terminal-entry">
            <div className="terminal-command-line">
              <span className="terminal-prompt">{getPrompt()}</span>
              <span className="terminal-command">{entry.command}</span>
            </div>
            {entry.output && (
              <pre className={`terminal-output ${entry.exit_code !== 0 ? 'error' : ''}`}>
                {formatOutput(entry.output, entry.command)}
              </pre>
            )}
          </div>
        ))}
        
        {/* Current input line */}
        <div className="terminal-entry current-input">
          <div className="terminal-command-line">
            <span className="terminal-prompt">{getPrompt()}</span>
            {renderInputWithCursor()}
            {isExecuting && <span className="terminal-executing">executing...</span>}
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