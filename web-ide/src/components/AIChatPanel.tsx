import React, { useState, useRef, useEffect } from 'react';
import { useAIChatStore } from '../stores/aiChatStore';

interface AIChatPanelProps {
  onClose: () => void;
}

export function AIChatPanel({ onClose }: AIChatPanelProps) {
  const { messages, isLoading, currentProvider, sendMessage, addMessage } = useAIChatStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');

    try {
      await sendMessage(userMessage);
    } catch (error) {
      addMessage({
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: Date.now(),
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{
      position: 'fixed',
      right: 0,
      top: 48,
      bottom: 24,
      width: '400px',
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
        <div>
          <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px' }}>
            🤖 Ribix AI
          </div>
          <div style={{ color: '#888', fontSize: '11px' }}>
            {currentProvider.provider} • {currentProvider.model}
          </div>
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
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: '#888',
            marginTop: '40px',
            fontSize: '13px',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🤖</div>
            <div>Ask Ribix AI for help with:</div>
            <div style={{ marginTop: '8px', color: '#666' }}>
              • Code explanations<br/>
              • Bug fixes<br/>
              • Refactoring<br/>
              • Documentation
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              alignItems: message.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div style={{
              backgroundColor: message.role === 'user' ? '#0e639c' : '#3c3c3c',
              color: '#fff',
              padding: '8px 12px',
              borderRadius: '8px',
              maxWidth: '80%',
              fontSize: '13px',
              lineHeight: '1.5',
              whiteSpace: 'pre-wrap',
            }}>
              {message.content}
            </div>
            <div style={{ color: '#666', fontSize: '11px' }}>
              {new Date(message.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}

        {isLoading && (
          <div style={{
            display: 'flex',
            gap: '4px',
            padding: '8px 12px',
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              backgroundColor: '#888',
              borderRadius: '50%',
              animation: 'bounce 1s infinite',
            }} />
            <div style={{
              width: '8px',
              height: '8px',
              backgroundColor: '#888',
              borderRadius: '50%',
              animation: 'bounce 1s infinite 0.2s',
            }} />
            <div style={{
              width: '8px',
              height: '8px',
              backgroundColor: '#888',
              borderRadius: '50%',
              animation: 'bounce 1s infinite 0.4s',
            }} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div style={{
        padding: '12px',
        borderTop: '1px solid #3c3c3c',
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask Ribix AI... (Enter to send, Shift+Enter for new line)"
          disabled={isLoading}
          style={{
            width: '100%',
            minHeight: '60px',
            maxHeight: '120px',
            backgroundColor: '#3c3c3c',
            border: '1px solid #3c3c3c',
            borderRadius: '4px',
            color: '#fff',
            padding: '8px 12px',
            fontSize: '13px',
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '8px',
        }}>
          <div style={{ color: '#666', fontSize: '11px' }}>
            {input.length} characters
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            style={{
              padding: '6px 16px',
              backgroundColor: input.trim() && !isLoading ? '#0e639c' : '#3c3c3c',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: input.trim() && !isLoading ? 'pointer' : 'not-allowed',
              fontSize: '13px',
            }}
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}