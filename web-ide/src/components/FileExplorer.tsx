import { useState } from 'react';
import { useFileSystemStore } from '../stores/fileSystemStore';

interface FileExplorerProps {
  onFileSelect: (path: string, content: string, language: string) => void;
  currentFile?: string;
}

export function FileExplorer({ onFileSelect, currentFile }: FileExplorerProps) {
  const { root, createFile, createDirectory, deleteFile, deleteDirectory, downloadWorkspace } = useFileSystemStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['/']));
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'directory'>('file');

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    if (!newItemName.trim()) return;

    const path = `/${newItemName.trim()}`;
    
    try {
      if (newItemType === 'file') {
        await createFile(path, '', 'plaintext');
      } else {
        await createDirectory(path);
      }
      setNewItemName('');
      setShowCreateMenu(false);
    } catch (error) {
      console.error('Failed to create item:', error);
      alert('Failed to create item');
    }
  };

  const handleDelete = async (item: any) => {
    if (!confirm(`Are you sure you want to delete ${item.name}?`)) return;

    try {
      if (item.type === 'file') {
        await deleteFile(item.path);
      } else {
        await deleteDirectory(item.path);
      }
    } catch (error) {
      console.error('Failed to delete item:', error);
      alert('Failed to delete item');
    }
  };

  const handleFileClick = (item: any) => {
    if (item.type === 'file' && item.content) {
      onFileSelect(item.path, item.content, item.language || 'plaintext');
    }
  };

  const renderItem = (item: any, depth: number = 0) => {
    const isExpanded = expanded.has(item.path);
    const isActive = currentFile === item.path;

    return (
      <div key={item.path}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 12px',
            paddingLeft: `${12 + depth * 16}px`,
            cursor: 'pointer',
            backgroundColor: isActive ? '#37373d' : 'transparent',
            fontSize: '13px',
          }}
          onClick={() => {
            if (item.type === 'directory') {
              toggleExpand(item.path);
            } else {
              handleFileClick(item);
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (item.name !== 'workspace') {
              handleDelete(item);
            }
          }}
        >
          <span style={{ marginRight: '6px', fontSize: '12px' }}>
            {item.type === 'directory' ? (isExpanded ? '📂' : '📁') : '📄'}
          </span>
          <span style={{ flex: 1 }}>{item.name}</span>
          {item.type === 'directory' && item.children && item.children.length > 0 && (
            <span style={{ color: '#666', fontSize: '11px' }}>
              {item.children.length}
            </span>
          )}
        </div>
        
        {isExpanded && item.children && (
          <div>
            {item.children.map((child: any) => renderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #3c3c3c',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#bbbbbb' }}>
          EXPLORER
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => downloadWorkspace().catch((e) => { console.error(e); alert('Failed to download workspace'); })}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '2px 6px',
            }}
            title="Download workspace as ZIP (escape hatch)"
          >
            ⬇
          </button>
          <button
            onClick={() => setShowCreateMenu(!showCreateMenu)}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '2px 6px',
            }}
            title="New file or directory"
          >
            +
          </button>
        </div>
      </div>

      {showCreateMenu && (
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid #3c3c3c',
            backgroundColor: '#2d2d2d',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button
              onClick={() => setNewItemType('file')}
              style={{
                flex: 1,
                padding: '4px 8px',
                backgroundColor: newItemType === 'file' ? '#0e639c' : '#3c3c3c',
                color: '#fff',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              File
            </button>
            <button
              onClick={() => setNewItemType('directory')}
              style={{
                flex: 1,
                padding: '4px 8px',
                backgroundColor: newItemType === 'directory' ? '#0e639c' : '#3c3c3c',
                color: '#fff',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Directory
            </button>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder={`Name...`}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') {
                  setShowCreateMenu(false);
                  setNewItemName('');
                }
              }}
              style={{
                flex: 1,
                padding: '4px 8px',
                backgroundColor: '#3c3c3c',
                border: '1px solid #3c3c3c',
                color: '#fff',
                borderRadius: '3px',
                fontSize: '12px',
              }}
            />
            <button
              onClick={handleCreate}
              style={{
                padding: '4px 12px',
                backgroundColor: '#0e639c',
                color: '#fff',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {renderItem(root)}
      </div>
    </div>
  );
}