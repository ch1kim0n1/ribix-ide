import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { useStore } from 'zustand';

interface File {
  name: string;
  content: string;
  language: string;
}

interface EditorState {
  files: Map<string, File>;
  activeFile: string | null;
  openFiles: string[];
  setFile: (name: string, content: string, language: string) => void;
  setActiveFile: (name: string) => void;
  closeFile: (name: string) => void;
}

const useEditorStore = create<EditorState>((set) => ({
  files: new Map(),
  activeFile: null,
  openFiles: [],
  setFile: (name, content, language) =>
    set((state) => {
      const files = new Map(state.files);
      files.set(name, { name, content, language });
      const openFiles = state.openFiles.includes(name) ? state.openFiles : [...state.openFiles, name];
      return { files, openFiles, activeFile: state.activeFile || name };
    }),
  setActiveFile: (name) => set({ activeFile: name }),
  closeFile: (name) =>
    set((state) => {
      const openFiles = state.openFiles.filter((f) => f !== name);
      const activeFile = state.activeFile === name ? (openFiles[0] || null) : state.activeFile;
      return { openFiles, activeFile };
    }),
}));

function App() {
  const { files, activeFile, openFiles, setFile, setActiveFile, closeFile } = useEditorStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initialize with sample files
    setTimeout(() => {
      setFile(
        'hello.ts',
        `// Welcome to Ribix IDE Web!
// This is a web-based version of the agent-first development environment.

function greet(name: string): string {
  return \`Hello, \${name}! Welcome to Ribix IDE.\`;
}

console.log(greet('Developer'));
`,
        'typescript'
      );
      setFile(
        'readme.md',
        `# Ribix IDE Web

This is the web-based version of Ribix IDE.

## Features
- Monaco Editor for VS Code-like editing
- Multi-file support
- Syntax highlighting
- Coming soon:
  - AI agent integration
  - Real-time collaboration
  - Cloud workspaces
  - Multi-provider AI support
`,
        'markdown'
      );
      setLoading(false);
    }, 1000);
  }, []);

  if (loading) {
    return null;
  }

  const activeFileData = activeFile ? files.get(activeFile) : null;

  return (
    <div className="header">
      <div className="logo">🚀 Ribix IDE Web</div>
      <div className="header-actions">
        <button className="btn btn-secondary">Settings</button>
        <button className="btn">Sign In</button>
      </div>
      <div className="main-content">
        <div className="sidebar">
          <div className="sidebar-header">Explorer</div>
          <div className="sidebar-item active">
            <span>📁</span>
            <span>workspace</span>
          </div>
          {Array.from(files.keys()).map((fileName) => (
            <div
              key={fileName}
              className={`sidebar-item ${activeFile === fileName ? 'active' : ''}`}
              onClick={() => setActiveFile(fileName)}
            >
              <span>📄</span>
              <span>{fileName}</span>
            </div>
          ))}
        </div>
        <div className="editor-container">
          <div className="tabs">
            {openFiles.map((fileName) => (
              <div
                key={fileName}
                className={`tab ${activeFile === fileName ? 'active' : ''}`}
                onClick={() => setActiveFile(fileName)}
              >
                <span>{fileName}</span>
                <span className="tab-close" onClick={(e) => { e.stopPropagation(); closeFile(fileName); }}>
                  ×
                </span>
              </div>
            ))}
          </div>
          <div id="monaco-editor">
            {activeFileData ? (
              <Editor
                height="100%"
                language={activeFileData.language}
                value={activeFileData.content}
                onChange={(value) => setFile(activeFile, value || '', activeFileData.language)}
                theme="vs-dark"
                options={{
                  minimap: { enabled: true },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            ) : (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                height: '100%',
                color: '#888' 
              }}>
                Open a file to start editing
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="status-bar">
        <span>Ready</span>
        <span>TypeScript • UTF-8</span>
      </div>
    </div>
  );
}

export default App;