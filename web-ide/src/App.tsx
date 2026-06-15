import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { useStore } from 'zustand';
import { useAuthStore } from './stores/authStore';
import { AIChatPanel } from './components/AIChatPanel';
import { FileExplorer } from './components/FileExplorer';

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

function LoginModal({ onClose, onLogin, onGitHubLogin }: {
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onGitHubLogin: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onLogin(email, password);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: '#252526',
        padding: '32px',
        borderRadius: '8px',
        border: '1px solid #3c3c3c',
        minWidth: '400px',
        maxWidth: '500px',
      }}>
        <h2 style={{ color: '#fff', marginBottom: '24px' }}>Sign in to Ribix IDE</h2>
        
        <button
          onClick={onGitHubLogin}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: '#24292e',
            color: '#fff',
            border: '1px solid #3c3c3c',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            marginBottom: '16px',
          }}
        >
          Sign in with GitHub
        </button>
        
        <div style={{ color: '#888', textAlign: 'center', margin: '16px 0' }}>or</div>
        
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: '#d4d4d4', marginBottom: '8px' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#3c3c3c',
                border: '1px solid #3c3c3c',
                color: '#fff',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            />
          </div>
          
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', color: '#d4d4d4', marginBottom: '8px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#3c3c3c',
                border: '1px solid #3c3c3c',
                color: '#fff',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            />
          </div>
          
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '8px 16px',
                backgroundColor: '#3c3c3c',
                color: '#fff',
                border: '1px solid #3c3c3c',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                flex: 1,
                padding: '8px 16px',
                backgroundColor: '#0e639c',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: pointer,
                fontSize: '14px',
              }}
            >
              Sign In
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function App() {
  const { files, activeFile, openFiles, setFile, setActiveFile, closeFile } = useEditorStore();
  const { isAuthenticated, user, login, logout, loginWithGitHub } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);

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

    // Check for existing auth
    const existingToken = localStorage.getItem('ribix_token');
    const existingUser = localStorage.getItem('ribix_user');
    if (existingToken && existingUser) {
      useAuthStore.getState().setToken(existingToken);
      useAuthStore.setState({
        user: JSON.parse(existingUser),
        isAuthenticated: true,
      });
    }
  }, []);

  const handleLogin = async (email: string, password: string) => {
    try {
      await login(email, password);
      setShowLoginModal(false);
    } catch (error) {
      console.error('Login failed:', error);
      alert('Login failed. Please try again.');
    }
  };

  const handleGitHubLogin = async () => {
    try {
      await loginWithGitHub();
    } catch (error) {
      console.error('GitHub login failed:', error);
      alert('GitHub login failed. Please try again.');
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading) {
    return null;
  }

  const activeFileData = activeFile ? files.get(activeFile) : null;

  return (
    <>
      <div className="header">
        <div className="logo">🚀 Ribix IDE Web</div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={() => setShowAIChat(!showAIChat)}>
            🤖 AI Chat
          </button>
          {isAuthenticated ? (
            <>
              <span style={{ marginRight: '12px', fontSize: '13px' }}>
                {user?.email}
              </span>
              <button className="btn btn-secondary" onClick={handleLogout}>
                Sign Out
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={() => setShowLoginModal(true)}>
                Sign In
              </button>
              <button className="btn" onClick={() => setShowLoginModal(true)}>
                Sign In with GitHub
              </button>
            </>
          )}
        </div>
      </div>
      <div className="main-content">
        <div className="sidebar">
          <FileExplorer
            onFileSelect={(path, content, language) => {
              setFile(path, content, language);
              setActiveFile(path);
            }}
            currentFile={activeFile}
          />
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
      {showLoginModal && (
        <LoginModal
          onClose={() => setShowLoginModal(false)}
          onLogin={handleLogin}
          onGitHubLogin={handleGitHubLogin}
        />
      )}
      {showAIChat && <AIChatPanel onClose={() => setShowAIChat(false)} />}
    </>
  );
}

export default App;