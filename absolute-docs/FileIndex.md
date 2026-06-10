# Ribix IDE — File Index & Architecture Documentation

**Phase 0 Audit — 2026-06-09**

---

## Service Architecture

### Browser-Only Services (4)

| Service | File | Purpose |
|---|---|---|
| `IChatThreadService` | `browser/chatThreadService.ts` | Thread/message state machine, tool call lifecycle, checkpoint-based versioning |
| `IEditCodeService` | `browser/editCodeService.ts` | DiffZone lifecycle, Fast/Slow Apply, VoidFileSnapshot creation |
| `IToolsService` | `browser/toolsService.ts` | Built-in tool execution (read, write, terminal, search) |
| `ITerminalToolService` | `browser/terminalToolService.ts` | Terminal command execution for agents |

### Common Services (5)

| Service | File | Purpose |
|---|---|---|
| `IVoidSettingsService` | `common/voidSettingsService.ts` | Provider/model config, FeatureName routing, ChatMode union |
| `ILLMMessageService` | `common/sendLLMMessageService.ts` | LLM API routing (browser → electron-main channel) |
| `IVoidModelService` | `common/voidModelService.ts` | File read/write via URI, no load/save ceremony |
| `IMCPService` | `common/mcpService.ts` | MCP tool integration, server registry |
| `IMetricsService` | `common/metricsService.ts` | Telemetry and metrics collection |

### Electron-Main Channels (2)

| Service | File | Purpose |
|---|---|---|
| `LLMMessageChannel` | `electron-main/sendLLMMessageChannel.ts` | Main process LLM streaming (needs Node.js) |
| `MCPChannel` | `electron-main/mcpChannel.ts` | MCP server lifecycle management (needs Node.js) |

---

## Key Type System

### ChatMode Union
```typescript
type ChatMode = 'agent' | 'gather' | 'normal'
```

### FeatureName Enum
```typescript
type FeatureName = 'Chat' | 'Ctrl+K' | 'Autocomplete' | 'Apply' | 'SCM'
```

### ModelSelection Type
```typescript
type ModelSelection = {
  providerName: ProviderName
  modelName: string
}
```

### ToolApprovalType
```typescript
type ToolApprovalType = 'edits' | 'terminal' | 'MCP tools'
```

---

## Storage Pattern

Both services use `IStorageService` with:

- **VOID_SETTINGS_STORAGE_KEY** → `StorageScope.APPLICATION`, `StorageTarget.USER` (encrypted)
- **THREAD_STORAGE_KEY** → `StorageScope.APPLICATION`, `StorageTarget.USER`
- Version suffix pattern: `StorageII` (version 2, supports migration from v1)

**Usage pattern from `chatThreadService.ts`:**
```typescript
this.storageService.store(THREAD_STORAGE_KEY, JSON.stringify(state), StorageScope.APPLICATION, StorageTarget.USER)
const stored = this.storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION)
```

---

## React Mounting Pattern

All React components follow identical pattern from `sidebarPane.ts`:

```typescript
this.instantiationService.invokeFunction(accessor => {
  const disposeFn = mountComponent(parent, accessor)?.dispose
  this._register(toDisposable(() => disposeFn?.()))
})
```

Components using this pattern:
- `mountSidebar()` — Chat panel
- `mountVoidSettings()` — Settings pane
- `mountVoidOnboarding()` — Onboarding flow
- `mountCtrlK()` — Cmd+K quick edit

---

## Tool System

### 15 Built-in Tools

**Read Tools (7):**
- `read_file` — Read file contents with line range and pagination
- `ls_dir` — List directory contents with pagination
- `get_dir_tree` — Get directory tree structure
- `search_pathnames_only` — Search file/directory names
- `search_for_files` — Search file contents
- `search_in_file` — Search within a specific file
- `read_lint_errors` — Read lint errors from markers

**Write Tools (4):**
- `rewrite_file` — Replace entire file content
- `edit_file` — Edit specific ranges in file
- `create_file_or_folder` — Create new file or folder
- `delete_file_or_folder` — Delete file or folder

**Terminal Tools (4):**
- `run_command` — Run one-off terminal command
- `run_persistent_command` — Run command in persistent terminal
- `open_persistent_terminal` — Open new persistent terminal
- `kill_persistent_terminal` — Kill persistent terminal

### Approval Mapping

- `'edits'` → file operations (4 tools)
- `'terminal'` → command operations (4 tools)
- `'MCP tools'` → external tools

---

## Checkpoint Invariant

Every user message and LLM edit must be preceded by CheckpointEntry:

```
checkpoint → (user edits) → user message
checkpoint → (LLM edits) → LLM message
```

**VoidFileSnapshot captures:**
```typescript
{
  snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshotEntry>
  entireFileCode: string
}
```

---

## IPC Channel Pattern

Browser→Main communication uses standardized pattern:

1. Browser service stores hooks by requestId
2. Calls `channel.call(command, params)`
3. Main channel fires emitters
4. Browser hooks are called with streaming data

**Used for:**
- LLM streaming
- Model discovery (ollamaList, openAICompatibleList)
- MCP management

**Example from `sendLLMMessageService.ts`:**
```typescript
this.channel.call('sendLLMMessage', { requestId, ...params })
this._register(this.channel.listen('onText_sendLLMMessage')(e => {
  this.llmMessageHooks.onText[e.requestId]?.(e)
}))
```

---

## Diff Zone Lifecycle

**DiffZone structure:**
```typescript
{
  originalCode: string  // pre-edit code
  _diffOfId: Record<string, Diff>  // {diffid → Diff} map
  _streamState: {
    isStreaming: boolean
    streamRequestIdRef: { current: string | null }
    line: number
  }
}
```

**Diff types:** `'edit' | 'insertion' | 'deletion'` (1-indexed lines)

**Apply modes:**
- Fast Apply — Immediate text replacement
- Slow Apply — Character-by-character streaming preview

---

## Branding Strings (product.json)

### Critical strings to replace for Ribix IDE rebranding:

| Key | Current Value | Target Value |
|---|---|---|
| `nameShort` | "Void" | "Ribix IDE" |
| `nameLong` | "Void" | "Ribix IDE" |
| `applicationName` | "void" | "ribix-ide" |
| `dataFolderName` | ".void-editor" | ".ribix-ide" |
| `darwinBundleIdentifier` | "com.voideditor.code" | "dev.ribix.ide" |
| `win32MutexName` | "voideditor" | "ribix-ide" |
| URL Protocol | "void" | "ribix-ide" |

### URLs to update:
- voideditor.com → ribix.dev
- voideditor.dev → ribix.dev
- github.com/voideditor/void → github.com/ribix/ribix-ide

### Windows GUIDs to regenerate:
- 4 different IDs for x64/ARM64 user/system installations

---

## Service Registration Pattern

All services follow this pattern in `void.contribution.ts`:

```typescript
registerSingleton(IMyService, MyService, InstantiationType.Delayed)
```

**Service consumption:**
```typescript
constructor(@IMyService private readonly myService: IMyService) {}
```

---

## Architectural Patterns to Follow

1. **Service Registration:** Use `registerSingleton()` with `InstantiationType.Delayed`
2. **Dependency Injection:** Inject via constructor with `@IServiceName`
3. **Browser ↔ Main Channel:** Implement in `electron-main/`, expose via channel
4. **React Layer:** Lives in `browser/react/`, bundled separately via `node build.js`
5. **Event Emission:** Use `Emitter<T>` from `base/common/event.js`
6. **Storage:** Use `IStorageService` with `StorageScope.WORKSPACE` or `StorageScope.PROFILE`

---

## File Statistics

- **25 common services** (both browser + main)
- **31 browser services** (browser-only)
- **8 electron-main services** (main process only)
- **Total: 64 source files** in `src/vs/workbench/contrib/void/`

---

## TypeScript Configuration

**Strict mode:** Enabled in `src/tsconfig.base.json`
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitReturns": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true
  }
}
```

---

## Build Commands

```bash
npm run buildreact    # Build React layer
npm run watchreact    # Watch React layer for changes
npm run compile       # Full TypeScript compilation
npm run watch         # Watch client + extensions
```

---

## Next Steps

Phase 0 acceptance criteria:
- ✅ All audit notes captured in FileIndex.md
- ⏳ Build (`npm run buildreact`) exits 0
- ✅ TypeScript strict mode confirmed
- ⏳ No code changes committed in Phase 0