# Ribix IDE — Data Privacy and Retention Policy

> **Issue #86** — What we collect, how long we keep it, and how users can delete
> or export it. This policy covers the desktop IDE, web IDE, and Ribix backend.

## 1. Data Inventory

### 1.1 Data stored locally (desktop IDE)

| Data type | Storage location | Retention | Sensitive? |
|---|---|---|---|
| AI provider API keys | OS keychain (VS Code SecretStorage) | Until user removes | Yes — never written to disk in plaintext |
| Provider settings (endpoints, model choices) | VS Code global storage | Until user resets | No |
| Chat thread history | VS Code workspace storage | Until user clears | Yes — contains prompts and AI responses |
| Mission history | VS Code workspace storage | Until user clears | Yes — contains code diffs and agent outputs |
| Codebase memory (file ownership, patterns) | VS Code workspace storage | Until user clears | No — metadata only, no source code |
| Agent activity logs | VS Code workspace storage (in-memory + persisted) | 30 days or session end | Yes — may contain file paths and code snippets |
| `.ribixignore` rules | Workspace filesystem | Until user removes | No |
| Telemetry events | In-memory only (if not opted out) | Session only | No — anonymized usage metrics |

### 1.2 Data stored on the Ribix backend (web IDE + org features)

| Data type | Storage | Retention | Sensitive? |
|---|---|---|---|
| User account (email, password hash) | PostgreSQL | Until account deletion | Yes — password is bcrypt-hashed |
| Workspace metadata | PostgreSQL | Until workspace deletion | No |
| File contents (web IDE) | In-memory / S3 | Until workspace deletion | Yes — user source code |
| Agent prompts and responses | PostgreSQL | 90 days, then auto-delete | Yes |
| Audit logs | PostgreSQL | 1 year | No — action records only |
| OAuth tokens | PostgreSQL (encrypted) | Until user revokes | Yes — never logged |
| Telemetry events | Time-series store | 30 days, then aggregated | No — anonymized |

### 1.3 Data sent to third parties

| Recipient | Data sent | When | Opt-out |
|---|---|---|---|
| AI provider (Anthropic, OpenAI, etc.) | User prompts, code context | Every AI interaction | Disable the provider in Settings |
| GitHub (OAuth) | Client ID, redirect URI | Auth flow only | Disconnect in Settings |
| Ribix backend | Mission summaries, telemetry | When cloud sync is enabled | Disable cloud sync in Settings |

**Important**: AI provider API keys are sent **directly** from the user's machine to the
provider. They never pass through the Ribix backend. The backend only sees mission
summaries and telemetry when cloud sync is explicitly enabled.

## 2. Retention Periods

### 2.1 Default retention

| Data | Retention period | Rationale |
|---|---|---|
| Chat threads | Until user clears | User controls their history |
| Mission history | Until user clears | User controls their history |
| Agent activity logs | 30 days | Debugging window; older logs have no value |
| Backend agent prompts/responses | 90 days | Support and debugging; auto-deleted after |
| Audit logs | 1 year | Security and compliance requirement |
| Telemetry events | 30 days raw, then aggregated | Trend analysis only after aggregation |
| User accounts | Until deletion request | GDPR/CCPA right to erasure |

### 2.2 Data residency
- **Desktop IDE**: All data stays on the user's machine. No cloud residency.
- **Web IDE**: Data stored in the region closest to the user (default: `us-east-1`).
  EU users can request EU residency (`eu-west-1`).
- **Backups**: Daily snapshots retained for 7 days in the same region as the primary.

## 3. User Rights and Controls

### 3.1 Right to access (GDPR Art. 15, CCPA §1798.110)
Users can export all their data via:
- **Desktop IDE**: Settings → "Export all data" (produces a JSON archive)
- **Web IDE**: Account → "Download my data" (produces a JSON archive)

### 3.2 Right to erasure (GDPR Art. 17, CCPA §1798.105)
Users can delete all their data via:
- **Desktop IDE**: Settings → "Clear all Ribix data" (removes chat, missions, memory)
- **Web IDE**: Account → "Delete account" (removes account and all associated data)
- Deletion is irreversible and completes within 30 days (backend cleanup job)

### 3.3 Right to opt out (telemetry)
- **Telemetry opt-out**: Settings → "Opt out of telemetry" (stored as `OPT_OUT_KEY`)
- When opted out, no telemetry events are collected or sent
- Opt-out does not affect AI provider calls (those are necessary for the product to function)

### 3.4 Right to data portability (GDPR Art. 20)
- Export format is JSON, documented in `docs/data-export-format.md`
- Includes all chat threads, mission history, and settings

### 3.5 Consent for AI data sharing
- Users must explicitly enable each AI provider in Settings
- A consent dialog explains that prompts and code context are sent to the provider
- Users can disable a provider at any time; existing data is not retroactively deleted from
  the provider (users must contact the provider directly for that)

## 4. Data Deletion Flow

### 4.1 Desktop IDE
1. User clicks "Clear all Ribix data" in Settings
2. IDE clears: chat threads, mission history, codebase memory, agent logs
3. IDE does **not** clear: AI provider API keys (user must remove separately)
4. Confirmation dialog with list of what will be deleted
5. Deletion is immediate and irreversible

### 4.2 Web IDE / Backend
1. User clicks "Delete account" in Account settings
2. Backend marks account for deletion (soft delete)
3. Within 24h: user data removed from active database (hard delete)
4. Within 30 days: data removed from backups and audit logs anonymized
5. User receives email confirmation when deletion is complete
6. OAuth tokens are revoked immediately

## 5. Data Export Flow

### 5.1 Desktop IDE
1. User clicks "Export all data" in Settings
2. IDE collects: chat threads, mission history, settings (without API keys), memory entries
3. Produces a single JSON file: `ribix-data-export-YYYY-MM-DD.json`
4. API keys are **never** included in exports

### 5.2 Web IDE / Backend
1. User clicks "Download my data" in Account settings
2. Backend generates export job (async, may take up to 5 min for large accounts)
3. User receives download link via email when export is ready
4. Export includes: account info, workspaces, file contents, agent history, audit logs
5. Download link expires after 7 days

## 6. Security Measures

- API keys stored in OS keychain (never plaintext on disk)
- Passwords hashed with bcrypt (cost factor 12)
- OAuth tokens encrypted at rest (AES-256-GCM)
- TLS 1.2+ for all network communication
- No source code sent to Ribix backend unless cloud sync is explicitly enabled
- Agent prompts/responses on the backend are encrypted at rest
- Access to production data requires MFA and is audit-logged

## 7. Compliance

### 7.1 GDPR
- Right to access: supported (Section 3.1)
- Right to erasure: supported (Section 3.2)
- Right to data portability: supported (Section 3.4)
- Right to object to processing: supported via opt-out (Section 3.3)
- Data Processing Agreement (DPA): available on request

### 7.2 CCPA
- Right to know: supported (this document + export)
- Right to delete: supported (Section 3.2)
- Right to opt out of sale: Ribix does not sell user data
- Right to non-discrimination: opting out does not degrade core IDE functionality

### 7.3 SOC 2 (planned)
- Access controls: MFA + audit logging
- Encryption: at rest and in transit
- Incident response: documented in `docs/production-secrets.md` Section 5
- Change management: PR review required for all changes

## 8. Policy Updates

- This policy is versioned and changes are logged in git
- Users are notified of material changes via in-app notification and email
- 30-day notice period for changes that affect data retention or sharing
- Last updated: 2026-06-18
