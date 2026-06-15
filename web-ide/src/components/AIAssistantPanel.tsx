import React, { useState } from 'react';
import { useAdvancedAIStore } from '../stores/advancedAIStore';

interface AIAssistantPanelProps {
  onClose: () => void;
  currentCode?: string;
  currentLanguage?: string;
}

export function AIAssistantPanel({ onClose, currentCode = '', currentLanguage = 'typescript' }: AIAssistantPanelProps) {
  const { isProcessing, currentTask, results, error, generateCode, refactorCode, debugCode, reviewCode, generateDocumentation, explainCode, generateTests, optimizeCode } = useAdvancedAIStore();
  const [activeTab, setActiveTab] = useState<'generate' | 'refactor' | 'debug' | 'review' | 'docs'>('generate');
  const [prompt, setPrompt] = useState('');
  const [refactorType, setRefactorType] = useState<'extract-function' | 'rename-variable' | 'optimize' | 'simplify' | 'add-types'>('optimize');

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    await generateCode({
      prompt: prompt,
      context: {
        code: currentCode,
        language: currentLanguage,
      },
    });
  };

  const handleRefactor = async () => {
    if (!currentCode) return;
    await refactorCode({
      code: currentCode,
      language: currentLanguage,
      refactoringType,
    });
  };

  const handleDebug = async () => {
    if (!currentCode) return;
    await debugCode({
      code: currentCode,
      language: currentLanguage,
    });
  };

  const handleReview = async () => {
    if (!currentCode) return;
    await reviewCode({
      code: currentCode,
      language: currentLanguage,
      reviewType: 'comprehensive',
    });
  };

  const handleDocs = async () => {
    if (!currentCode) return;
    await generateDocumentation(currentCode, currentLanguage);
  };

  const handleExplain = async () => {
    if (!currentCode) return;
    await explainCode(currentCode, currentLanguage);
  };

  const handleTests = async () => {
    if (!currentCode) return;
    await generateTests(currentCode, currentLanguage);
  };

  const handleOptimize = async () => {
    if (!currentCode) return;
    await optimizeCode(currentCode, currentLanguage);
  };

  return (
    <div style={{
      position: 'fixed',
      right: 0,
      top: 48,
      bottom: 24,
      width: '450px',
      backgroundColor: '#252526',
      borderLeft: '1px solid #3c3c3c',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 100,
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #3c3c3c',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px' }}>
          🧠 AI Assistant
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '4px 8px',
          }}
        >
          ×
        </button>
      </div>

      <div style={{
        display: 'flex',
        borderBottom: '1px solid #3c3c3c',
      }}>
        {['generate', 'refactor', 'debug', 'review', 'docs'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            style={{
              flex: 1,
              padding: '10px',
              background: activeTab === tab ? '#0e639c' : 'transparent',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: '12px',
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {activeTab === 'generate' && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: '#d4d4d4', marginBottom: '8px', fontSize: '13px' }}>
                Describe what you want to create:
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., Create a function that validates email addresses..."
                style={{
                  width: '100%',
                  minHeight: '80px',
                  backgroundColor: '#3c3c3c',
                  border: '1px solid #3c3c3c',
                  borderRadius: '4px',
                  color: '#fff',
                  padding: '8px 12px',
                  fontSize: '13px',
                  resize: 'vertical',
                }}
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || isProcessing}
              style={{
                width: '100%',
                padding: '8px 16px',
                backgroundColor: prompt.trim() && !isProcessing ? '#0e639c' : '#3c3c3c',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: prompt.trim() && !isProcessing ? 'pointer' : 'not-allowed',
                fontSize: '13px',
              }}
            >
              {isProcessing ? 'Generating...' : 'Generate Code'}
            </button>
          </div>
        )}

        {activeTab === 'refactor' && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: '#d4d4d4', marginBottom: '8px', fontSize: '13px' }}>
                Refactoring Type:
              </label>
              <select
                value={refactorType}
                onChange={(e) => setRefactorType(e.target.value as any)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#3c3c3c',
                  border: '1px solid #3c3c3c',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '13px',
                }}
              >
                <option value="extract-function">Extract Function</option>
                <option value="rename-variable">Rename Variable</option>
                <option value="optimize">Optimize Performance</option>
                <option value="simplify">Simplify Code</option>
                <option value="add-types">Add Type Annotations</option>
              </select>
            </div>
            <button
              onClick={handleRefactor}
              disabled={!currentCode || isProcessing}
              style={{
                width: '100%',
                padding: '8px 16px',
                backgroundColor: currentCode && !isProcessing ? '#0e639c' : '#3c3c3c',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: currentCode && !isProcessing ? 'pointer' : 'not-allowed',
                fontSize: '13px',
              }}
            >
              {isProcessing ? 'Refactoring...' : 'Refactor Code'}
            </button>
          </div>
        )}

        {activeTab === 'debug' && (
          <div>
            <button
              onClick={handleDebug}
              disabled={!currentCode || isProcessing}
              style={{
                width: '100%',
                padding: '8px 16px',
                backgroundColor: currentCode && !isProcessing ? '#0e639c' : '#3c3c3c',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: currentCode && !isProcessing ? 'pointer' : 'not-allowed',
                fontSize: '13px',
              }}
            >
              {isProcessing ? 'Analyzing...' : 'Debug Code'}
            </button>
          </div>
        )}

        {activeTab === 'review' && (
          <div>
            <button
              onClick={handleReview}
              disabled={!currentCode || isProcessing}
              style={{
                width: '100%',
                padding: '8px 16px',
                backgroundColor: currentCode && !isProcessing ? '#0e639c' : '#3c3c3c',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: currentCode && !isProcessing ? 'pointer' : 'not-allowed',
                fontSize: '13px',
              }}
            >
              {isProcessing ? 'Reviewing...' : 'Review Code'}
            </button>
          </div>
        )}

        {activeTab === 'docs' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={handleExplain}
                disabled={!currentCode || isProcessing}
                style={{
                  padding: '8px 16px',
                  backgroundColor: currentCode && !isProcessing ? '#0e639c' : '#3c3c3c',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: currentCode && !isProcessing ? 'pointer' : 'not-allowed',
                  fontSize: '13px',
                }}
              >
                Explain Code
              </button>
              <button
                onClick={handleDocs}
                disabled={!currentCode || isProcessing}
                style={{
                  padding: '8px 16px',
                  backgroundColor: currentCode && !isProcessing ? '#0e639c' : '#3c3c3c',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: currentCode && !isProcessing ? 'pointer' : 'not-allowed',
                  fontSize: '13px',
                }}
              >
                Generate Documentation
              </button>
              <button
                onClick={handleTests}
                disabled={!currentCode || isProcessing}
                style={{
                  padding: '8px 16px',
                  backgroundColor: currentCode && !isProcessing ? '#0e639c' : '#3c3c3c',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: currentCode && !isProcessing ? 'pointer' : 'not-allowed',
                  fontSize: '13px',
                }}
              >
                Generate Tests
              </button>
              <button
                onClick={handleOptimize}
                disabled={!currentCode || isProcessing}
                style={{
                  padding: '8px 16px',
                  backgroundColor: currentCode && !isProcessing ? '#0e639c' : '#3c3c3c',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: currentCode && !isProcessing ? 'pointer' : 'not-allowed',
                  fontSize: '13px',
                }}
              >
                Optimize Performance
              </button>
            </div>
          </div>
        )}

        {isProcessing && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            backgroundColor: '#3c3c3c',
            borderRadius: '4px',
            textAlign: 'center',
            color: '#888',
            fontSize: '13px',
          }}>
            <div style={{ marginBottom: '8px' }}>{currentTask}</div>
            <div style={{
              width: '100%',
              height: '4px',
              backgroundColor: '#2d2d2d',
              borderRadius: '2px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: '100%',
                height: '100%',
                backgroundColor: '#0e639c',
                animation: 'progress 1.5s infinite',
              }} />
            </div>
          </div>
        )}

        {error && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            backgroundColor: '#3c3c3c',
            border: '1px solid #f14c4c',
            borderRadius: '4px',
            color: '#f14c4c',
            fontSize: '13px',
          }}>
            {error}
          </div>
        )}

        {results && !isProcessing && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            backgroundColor: '#2d2d2d',
            borderRadius: '4px',
            border: '1px solid #3c3c3c',
          }}>
            <pre style={{
              color: '#d4d4d4',
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
            }}>
              {typeof results === 'string' ? results : JSON.stringify(results, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}