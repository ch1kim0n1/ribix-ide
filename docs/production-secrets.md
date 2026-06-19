# Production Secrets and Environment Configuration Runbook

> **Issue #84** — Centralized inventory, validation, and rotation procedures for all
> secrets and environment values the Ribix IDE requires.

## 1. Secret / Environment Variable Inventory

### 1.1 AI Provider API Keys (user-supplied, stored in VS Code SecretStorage)

These are **not** environment variables — they are entered by the user in the Ribix
Settings panel and stored in the OS keychain via VS Code's `SecretStorage` API.

| Provider | Setting key | Required for | Rotation |
|---|---|---|---|
| Anthropic | `anthropic.apiKey` | Claude models | [Console](https://console.anthropic.com/) → API Keys → rotate |
| OpenAI | `openAI.apiKey` | GPT models | [Platform](https://platform.openai.com/api-keys) → rotate |
| DeepSeek | `deepseek.apiKey` | DeepSeek models | [Platform](https://platform.deepseek.com/) → rotate |
| OpenRouter | `openRouter.apiKey` | Multi-model routing | [Settings](https://openrouter.ai/keys) → rotate |
| Gemini | `gemini.apiKey` | Google Gemini | [AI Studio](https://aistudio.google.com/apikey) → rotate |
| Groq | `groq.apiKey` | Groq models | [Console](https://console.groq.com/keys) → rotate |
| xAI | `xAI.apiKey` | Grok models | [Console](https://console.x.ai/) → rotate |
| Mistral | `mistral.apiKey` | Mistral models | [Console](https://console.mistral.ai/api-keys) → rotate |
| OpenAI-Compatible | `openAICompatible.apiKey` | Custom endpoints | Provider-specific |
| AWS Bedrock | `awsBedrock.apiKey` | Bedrock models | AWS IAM → rotate access key |

### 1.2 AI Provider Endpoints (user-supplied, stored in VS Code settings)

| Provider | Setting key | Default | Notes |
|---|---|---|---|
| Ollama | `ollama.endpoint` | `http://127.0.0.1:11434` | Local inference |
| vLLM | `vLLM.endpoint` | `http://localhost:8000` | Local inference |
| LM Studio | `lmStudio.endpoint` | `http://localhost:1234` | Local inference |
| LiteLLM | `liteLLM.endpoint` | (empty) | Proxy endpoint |
| OpenAI-Compatible | `openAICompatible.endpoint` | (empty) | Custom OpenAI-compatible endpoint |
| AWS Bedrock | `awsBedrock.endpoint` | (empty) | Optional override |
| AWS Bedrock | `awsBedrock.region` | `us-east-1` | AWS region |
| Google Vertex | `googleVertex.region` | `us-west2` | GCP region |
| Google Vertex | `googleVertex.project` | (empty) | GCP project ID |
| Microsoft Azure | `microsoftAzure.project` | (empty) | Azure resource name |
| Microsoft Azure | `microsoftAzure.apiKey` | (empty) | Azure API key |
| Microsoft Azure | `microsoftAzure.azureApiVersion` | `2024-05-01-preview` | API version |

### 1.3 Ribix Backend (optional, for org features)

| Setting | Environment | Required for | Default |
|---|---|---|---|
| `ribixApiUrl` | `IWorkbenchEnvironmentService` | Web IDE marketplace proxy, auth | `/web-ide` |
| OAuth client ID | Hardcoded in `ribixAuthChannel.ts` | GitHub OAuth PKCE flow | (per-environment) |
| OAuth redirect URI | Derived from app URL | OAuth callback | `ribix://auth/callback` |

### 1.4 Environment Variables

| Variable | Scope | Required | Purpose |
|---|---|---|---|
| `RIBIX_DEBUG_TELEMETRY` | Electron main | No | Enable verbose telemetry logging |
| `VSCODE_SKIP_NODE_VERSION_CHECK` | Build | No | Bypass Node.js version check during install |
| `NODE_OPTIONS` | Build | No | `--max-old-space-size=8192` for compilation |

### 1.5 Web IDE Backend (ribix repo)

These are set on the backend server, not in the IDE:

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | Yes | Token signing for auth |
| `DATABASE_URL` | Yes | Prisma database connection |
| `ANTHROPIC_API_KEY` | Yes (if using) | Server-side AI calls |
| `OPENAI_API_KEY` | Yes (if using) | Server-side AI calls |
| `GITHUB_CLIENT_ID` | Yes (if OAuth) | GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | Yes (if OAuth) | GitHub OAuth |
| `PORT` | No | HTTP port (default 3000) |

## 2. Injection by Environment

### Local Development
- AI provider keys: entered in Settings UI → stored in OS keychain
- No environment variables required for local-only use
- Backend is optional; IDE works without it

### Staging
- AI provider keys: entered per-user in Settings UI
- Backend: environment variables injected via `.env` file or CI secrets
- `ribixApiUrl`: set to staging backend URL

### Production
- AI provider keys: entered per-user in Settings UI (never shared)
- Backend: environment variables injected via Kubernetes secrets or cloud secret manager
- `ribixApiUrl`: set to production backend URL
- TLS certificates: managed by reverse proxy (Nginx/Cloudflare)

## 3. Startup Validation

The IDE validates required configuration at startup and fails fast with actionable
errors. See `src/vs/workbench/contrib/ribix/browser/ribixConfigValidation.ts`.

Validation runs on:
- IDE launch (desktop and web)
- Settings change (re-validates affected providers)

### Validation rules
1. At least one AI provider must be configured (apiKey or endpoint)
2. Endpoints must be valid URLs (for local providers)
3. API keys must be non-empty strings (for cloud providers)
4. Backend URL must be reachable (for web IDE with org features)

## 4. Rotation Procedures

### API Key Rotation
1. Generate a new key at the provider's console
2. Open Ribix IDE → Settings → select the provider
3. Replace the old key with the new key
4. Verify by sending a test message
5. Revoke the old key at the provider's console

### Backend JWT Secret Rotation
1. Generate a new secret: `openssl rand -hex 32`
2. Update `JWT_SECRET` in the backend environment
3. Restart the backend (all active sessions will be invalidated)
4. Users will need to re-authenticate

### OAuth Credential Rotation
1. Generate new client ID/secret in GitHub OAuth settings
2. Update `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in backend env
3. Restart the backend

## 5. Incident Response

### Compromised API Key
1. **Immediately** revoke the key at the provider's console
2. Check provider billing for unauthorized usage
3. Generate a new key and update in Ribix IDE Settings
4. Document the incident with timeline and impact

### Compromised Backend Secret
1. Rotate `JWT_SECRET` (invalidates all sessions)
2. Rotate OAuth credentials if compromised
3. Check audit logs for unauthorized access
4. Notify affected users to re-authenticate

### Missing Secret at Startup
1. The IDE will display an actionable error message naming the missing configuration
2. Follow the injection procedure for the specific environment (Section 2)
3. Restart the IDE after fixing

## 6. Security Notes

- API keys are **never** logged, persisted to disk in plaintext, or sent to telemetry
- The `OPT_OUT_KEY` setting controls telemetry opt-out (stored in VS Code global storage)
- All AI provider calls go directly from the user's machine to the provider (desktop IDE)
- The web IDE routes through the Ribix backend proxy for marketplace queries only
- User code, prompts, and agent outputs are never sent to the Ribix backend unless
  the user explicitly enables cloud sync
