import React from 'react';
import { useCollaborationStore } from '../stores/collaborationStore';

interface CollaborationIndicatorProps {
  fileId: string;
}

export function CollaborationIndicator({ fileId }: CollaborationIndicatorProps) {
  const { isConnected, isReconnecting, reconnectAttempt, users, joinSession, leaveSession } = useCollaborationStore();

  React.useEffect(() => {
    joinSession(fileId);
    return () => leaveSession(fileId);
  }, [fileId]);

  // #154: Show a reconnect notification banner when the WebSocket drops.
  if (isReconnecting && !isConnected) {
    return (
      <div
        style={{
          position: 'fixed',
          top: '48px',
          right: '16px',
          backgroundColor: '#3c1e1e',
          border: '1px solid #f14c4c',
          borderRadius: '8px',
          padding: '12px 16px',
          zIndex: 50,
          minWidth: '280px',
          color: '#d4d4d4',
          fontSize: '13px',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: '4px', color: '#f14c4c' }}>
          ⚠️ Connection Lost
        </div>
        <div style={{ fontSize: '12px' }}>
          Reconnecting to collaboration server{reconnectAttempt > 1 ? ` (attempt ${reconnectAttempt})` : ''}…
        </div>
        <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
          Your changes are preserved locally and will sync when reconnected.
        </div>
      </div>
    );
  }

  if (!isConnected || users.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '48px',
        right: '16px',
        backgroundColor: '#252526',
        border: '1px solid #3c3c3c',
        borderRadius: '8px',
        padding: '12px',
        zIndex: 50,
        minWidth: '200px',
      }}
    >
      <div style={{ color: '#fff', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
        👥 Collaborators ({users.length + 1})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {users.map((user) => (
          <div
            key={user.user.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px',
              borderRadius: '4px',
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: user.user.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: '10px',
                fontWeight: 600,
              }}
            >
              {user.user.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#d4d4d4', fontSize: '12px' }}>
                {user.user.name}
              </div>
              <div style={{ color: '#888', fontSize: '10px' }}>
                {user.file ? `Editing ${user.file}` : 'Viewing'}
              </div>
            </div>
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#4ec9b0',
                animation: 'pulse 2s infinite',
              }}
            />
          </div>
        ))}
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

interface RemoteCursorProps {
  position: number;
  color: string;
  name: string;
  selection?: { from: number; to: number };
}

export function RemoteCursor({ position, color, name }: RemoteCursorProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${position}px`,
        top: '0',
        width: '2px',
        height: '20px',
        backgroundColor: color,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '-20px',
          left: '0',
          backgroundColor: color,
          color: '#fff',
          padding: '2px 6px',
          borderRadius: '3px',
          fontSize: '10px',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </div>
    </div>
  );
}