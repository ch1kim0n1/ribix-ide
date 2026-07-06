import { useState } from 'react';
import { useWorkspaceStore } from '../stores/workspaceStore';

/**
 * #154: Empty state UI shown when no staging URL is configured.
 * Displays a helpful message and an inline input to set the staging URL
 * so the user can run QA/Playwright tests without a confusing error.
 */
export function StagingUrlEmptyState() {
  const { stagingUrl, setStagingUrl } = useWorkspaceStore();
  const [inputUrl, setInputUrl] = useState('');
  const [showInput, setShowInput] = useState(false);

  if (stagingUrl) {
    return null;
  }

  const handleSave = () => {
    const trimmed = inputUrl.trim();
    if (trimmed) {
      setStagingUrl(trimmed);
      setShowInput(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '32px',
        textAlign: 'center',
        color: '#888',
      }}
    >
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
      <h3 style={{ color: '#d4d4d4', fontSize: '16px', marginBottom: '8px' }}>
        No Staging URL Configured
      </h3>
      <p style={{ fontSize: '13px', maxWidth: '400px', marginBottom: '16px' }}>
        A staging URL is required to run QA tests and Playwright checks.
        Configure one below to get started.
      </p>
      {showInput ? (
        <div style={{ display: 'flex', gap: '8px', width: '100%', maxWidth: '400px' }}>
          <input
            type="url"
            placeholder="https://staging.example.com"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              backgroundColor: '#3c3c3c',
              border: '1px solid #3c3c3c',
              color: '#fff',
              borderRadius: '4px',
              fontSize: '14px',
            }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setShowInput(false);
            }}
          />
          <button
            onClick={handleSave}
            style={{
              padding: '8px 16px',
              backgroundColor: '#0e639c',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Save
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowInput(true)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#0e639c',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Configure Staging URL
        </button>
      )}
    </div>
  );
}
