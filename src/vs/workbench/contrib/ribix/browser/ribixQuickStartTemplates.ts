/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * ribixQuickStartTemplates.ts
 *
 * Quick-start workspace templates for first-run onboarding (Issue #31).
 *
 * When a new user completes the onboarding wizard, they can choose a quick-start
 * template to scaffold a new project with sensible defaults, a README, and a
 * Ribix mission file pre-configured. This eliminates the "blank workspace" problem
 * that causes drop-off for non-technical users.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TemplateCategory = 'web' | 'api' | 'cli' | 'library' | 'demo';

export interface QuickStartTemplate {
	/** Unique identifier for the template. */
	readonly id: string;
	/** Human-readable display name shown in the onboarding wizard. */
	readonly displayName: string;
	/** One-line description shown under the display name. */
	readonly description: string;
	/** Category icon name (mapped in the React component). */
	readonly category: TemplateCategory;
	/** Estimated time to first successful run, in minutes. */
	readonly estimatedMinutes: number;
	/** Files to create, keyed by relative path from the workspace root. */
	readonly files: ReadonlyArray<QuickStartFile>;
	/** Optional: a pre-configured Ribix mission prompt for the template. */
	readonly missionPrompt?: string;
}

export interface QuickStartFile {
	/** Relative path from workspace root (e.g. "src/index.ts"). */
	readonly path: string;
	/** File content. */
	readonly content: string;
	/** If true, the file is only created if it doesn't already exist. */
	readonly skipIfExists?: boolean;
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

export const QUICK_START_TEMPLATES: readonly QuickStartTemplate[] = [

	// -------------------------------------------------------------------------
	// React + TypeScript web app
	// -------------------------------------------------------------------------
	{
		id: 'react-ts',
		displayName: 'React + TypeScript',
		description: 'A React app with Vite, TypeScript, and Tailwind CSS. Includes a working counter component.',
		category: 'web',
		estimatedMinutes: 2,
		files: [
			{
				path: 'package.json',
				content: `{
  "name": "my-ribix-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.1"
  }
}
`,
			},
			{
				path: 'tsconfig.json',
				content: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`,
			},
			{
				path: 'vite.config.ts',
				content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
})
`,
			},
			{
				path: 'index.html',
				content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Ribix App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
			},
			{
				path: 'src/main.tsx',
				content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`,
			},
			{
				path: 'src/App.tsx',
				content: `import { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>My Ribix App</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
    </div>
  )
}
`,
			},
			{
				path: '.ribix/mission.md',
				content: `# Mission: Add a decrement button

Add a "Decrement" button next to the Increment button that decreases the count by 1.
The count should not go below 0.
`,
				skipIfExists: true,
			},
			{
				path: 'README.md',
				content: `# My Ribix App

A React + TypeScript app created with Ribix IDE Quick Start.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Open http://localhost:3000 in your browser.

## Ribix Mission

This template includes a pre-configured mission in \`.ribix/mission.md\`.
Open the Command Center and run the mission to see Ribix agents in action.
`,
				skipIfExists: true,
			},
		],
		missionPrompt: 'Add a Decrement button to the counter app. The count should not go below 0. Add a test for the new button.',
	},

	// -------------------------------------------------------------------------
	// Express API server
	// -------------------------------------------------------------------------
	{
		id: 'express-api',
		displayName: 'Express API',
		description: 'A REST API server with Express, TypeScript, and basic CRUD endpoints.',
		category: 'api',
		estimatedMinutes: 2,
		files: [
			{
				path: 'package.json',
				content: `{
  "name": "my-ribix-api",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.10",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3"
  }
}
`,
			},
			{
				path: 'tsconfig.json',
				content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
`,
			},
			{
				path: 'src/index.ts',
				content: `import express from 'express'

const app = express()
const PORT = 3001

app.use(express.json())

interface Item {
  id: number
  name: string
}

let items: Item[] = [
  { id: 1, name: 'First item' },
  { id: 2, name: 'Second item' },
]

let nextId = 3

// GET all items
app.get('/api/items', (req, res) => {
  res.json(items)
})

// GET single item
app.get('/api/items/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const item = items.find(i => i.id === id)
  if (!item) return res.status(404).json({ error: 'Item not found' })
  res.json(item)
})

// POST new item
app.post('/api/items', (req, res) => {
  const { name } = req.body
  if (!name) return res.status(400).json({ error: 'Name is required' })
  const item: Item = { id: nextId++, name }
  items.push(item)
  res.status(201).json(item)
})

// PUT update item
app.put('/api/items/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const { name } = req.body
  const item = items.find(i => i.id === id)
  if (!item) return res.status(404).json({ error: 'Item not found' })
  item.name = name
  res.json(item)
})

// DELETE item
app.delete('/api/items/:id', (req, res) => {
  const id = parseInt(req.params.id)
  items = items.filter(i => i.id !== id)
  res.status(204).send()
})

app.listen(PORT, () => {
  console.log(\`API server running at http://localhost:\${PORT}\`)
})
`,
			},
			{
				path: '.ribix/mission.md',
				content: `# Mission: Add input validation and error handling

The POST and PUT endpoints accept any string as a name. Add validation:
- Name must be between 1 and 100 characters
- Return a 400 error with a descriptive message if validation fails
- Add a test for the validation logic
`,
				skipIfExists: true,
			},
			{
				path: 'README.md',
				content: `# My Ribix API

An Express REST API created with Ribix IDE Quick Start.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

The API is available at http://localhost:3001.

## Endpoints

- GET /api/items — list all items
- GET /api/items/:id — get a single item
- POST /api/items — create a new item
- PUT /api/items/:id — update an item
- DELETE /api/items/:id — delete an item

## Ribix Mission

This template includes a pre-configured mission in \`.ribix/mission.md\`.
Open the Command Center and run the mission to see Ribix agents in action.
`,
				skipIfExists: true,
			},
		],
		missionPrompt: 'Add input validation to the POST and PUT endpoints. Name must be 1-100 characters. Return 400 with a descriptive error. Add tests.',
	},

	// -------------------------------------------------------------------------
	// Node.js CLI tool
	// -------------------------------------------------------------------------
	{
		id: 'node-cli',
		displayName: 'Node.js CLI',
		description: 'A command-line tool with TypeScript, argument parsing, and a help screen.',
		category: 'cli',
		estimatedMinutes: 1,
		files: [
			{
				path: 'package.json',
				content: `{
  "name": "my-ribix-cli",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "bin": {
    "mycli": "dist/index.js"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3"
  }
}
`,
			},
			{
				path: 'tsconfig.json',
				content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
`,
			},
			{
				path: 'src/index.ts',
				content: `#!/usr/bin/env node

const args = process.argv.slice(2)

function showHelp() {
  console.log(\`
Usage: mycli <command> [options]

Commands:
  greet <name>    Greet someone by name
  count <text>    Count words in text
  help            Show this help screen
\`)
}

function greet(name: string) {
  console.log(\`Hello, \${name}! Welcome to Ribix CLI.\`)
}

function countWords(text: string) {
  const words = text.trim().split(/\\s+/).filter(Boolean)
  console.log(\`Word count: \${words.length}\`)
}

const command = args[0]

switch (command) {
  case 'greet':
    if (!args[1]) {
      console.error('Error: name is required')
      process.exit(1)
    }
    greet(args[1])
    break
  case 'count':
    if (!args[1]) {
      console.error('Error: text is required')
      process.exit(1)
    }
    countWords(args.slice(1).join(' '))
    break
  case 'help':
  case undefined:
    showHelp()
    break
  default:
    console.error(\`Unknown command: \${command}\`)
    showHelp()
    process.exit(1)
}
`,
			},
			{
				path: '.ribix/mission.md',
				content: `# Mission: Add a "reverse" command

Add a new command "reverse <text>" that prints the text reversed.
Add a test for the reverse function.
`,
				skipIfExists: true,
			},
			{
				path: 'README.md',
				content: `# My Ribix CLI

A Node.js CLI tool created with Ribix IDE Quick Start.

## Getting Started

\`\`\`bash
npm install
npm run dev -- greet World
npm run dev -- count "hello world foo bar"
\`\`\`

## Ribix Mission

This template includes a pre-configured mission in \`.ribix/mission.md\`.
Open the Command Center and run the mission to see Ribix agents in action.
`,
				skipIfExists: true,
			},
		],
		missionPrompt: 'Add a "reverse" command that prints the text reversed. Add a test for the reverse function.',
	},

	// -------------------------------------------------------------------------
	// TypeScript library
	// -------------------------------------------------------------------------
	{
		id: 'ts-library',
		displayName: 'TypeScript Library',
		description: 'A publishable TypeScript library with build, test, and type declarations.',
		category: 'library',
		estimatedMinutes: 1,
		files: [
			{
				path: 'package.json',
				content: `{
  "name": "my-ribix-lib",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "node --test dist/**/*.test.js"
  },
  "devDependencies": {
    "typescript": "^5.5.3"
  }
}
`,
			},
			{
				path: 'tsconfig.json',
				content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "strict": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
`,
			},
			{
				path: 'src/index.ts',
				content: `/**
 * String utilities for common text operations.
 */

export function capitalize(str: string): string {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\\s-]/g, '')
    .replace(/[\\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
`,
			},
			{
				path: 'src/index.test.ts',
				content: `import { test } from 'node:test'
import assert from 'node:assert'
import { capitalize, truncate, slugify } from './index.js'

test('capitalize', () => {
  assert.strictEqual(capitalize('hello'), 'Hello')
  assert.strictEqual(capitalize(''), '')
  assert.strictEqual(capitalize('a'), 'A')
})

test('truncate', () => {
  assert.strictEqual(truncate('hello world', 11), 'hello world')
  assert.strictEqual(truncate('hello world', 8), 'hello...')
})

test('slugify', () => {
  assert.strictEqual(slugify('Hello World!'), 'hello-world')
  assert.strictEqual(slugify('  Foo Bar  '), 'foo-bar')
  assert.strictEqual(slugify('a-b-c'), 'a-b-c')
})
`,
			},
			{
				path: '.ribix/mission.md',
				content: `# Mission: Add a "camelCase" function

Add a new exported function "camelCase(str)" that converts kebab-case or
snake_case to camelCase. Add tests for the function.
`,
				skipIfExists: true,
			},
			{
				path: 'README.md',
				content: `# My Ribix Library

A TypeScript library created with Ribix IDE Quick Start.

## Getting Started

\`\`\`bash
npm install
npm run build
npm test
\`\`\`

## Ribix Mission

This template includes a pre-configured mission in \`.ribix/mission.md\`.
Open the Command Center and run the mission to see Ribix agents in action.
`,
				skipIfExists: true,
			},
		],
		missionPrompt: 'Add a camelCase function that converts kebab-case or snake_case to camelCase. Add tests.',
	},

	// -------------------------------------------------------------------------
	// Demo app (intentional bugs for QA agent)
	// -------------------------------------------------------------------------
	{
		id: 'demo-bug-hunt',
		displayName: 'Bug Hunt Demo',
		description: 'A demo app with intentional bugs. Perfect for seeing Ribix QA agents in action.',
		category: 'demo',
		estimatedMinutes: 1,
		files: [
			{
				path: 'package.json',
				content: `{
  "name": "ribix-bug-hunt-demo",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "node src/server.js",
    "start": "node src/server.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
`,
			},
			{
				path: 'src/server.js',
				content: `import express from 'express'

const app = express()
const PORT = 3001

app.use(express.json())

// In-memory "database"
const users = [
  { id: 1, name: 'Alice', email: 'alice@example.com', balance: 100 },
  { id: 2, name: 'Bob', email: 'bob@example.com', balance: 50 },
  { id: 3, name: 'Charlie', email: 'charlie@example.com', balance: 0 },
]

// BUG 1: No input validation on transfer amount
app.post('/api/transfer', (req, res) => {
  const { fromId, toId, amount } = req.body

  const fromUser = users.find(u => u.id === fromId)
  const toUser = users.find(u => u.id === toId)

  // BUG 2: No check if users exist before transfer
  fromUser.balance -= amount
  toUser.balance += amount

  // BUG 3: No check for negative balance (overdraft)
  res.json({ from: fromUser, to: toUser })
})

// BUG 4: SQL injection vulnerability (simulated)
app.get('/api/users/:name', (req, res) => {
  const name = req.params.name
  // In a real app this would be: SELECT * FROM users WHERE name = '${name}'
  const user = users.filter(u => u.name === name)
  res.json(user)
})

// BUG 5: Missing error handler for malformed JSON
// (express.json() will throw but no error middleware catches it)

// BUG 6: Race condition on concurrent transfers (no locking)
// BUG 7: No rate limiting on transfer endpoint

app.listen(PORT, () => {
  console.log(\`Bug hunt demo running at http://localhost:\${PORT}\`)
  console.log('Try: POST /api/transfer with { "fromId": 1, "toId": 2, "amount": 1000 }')
})
`,
			},
			{
				path: '.ribix/mission.md',
				content: `# Mission: Find and fix all bugs in the bug hunt demo

Analyze the Express server at src/server.js. There are at least 7 bugs:
1. No input validation on transfer amount
2. No null check on users before transfer
3. No overdraft protection (negative balance)
4. SQL injection vulnerability in user lookup
5. Missing error handler for malformed JSON
6. Race condition on concurrent transfers
7. No rate limiting on transfer endpoint

Find each bug, write a failing test for it, then fix it. Ask for approval before opening a PR.
`,
				skipIfExists: true,
			},
			{
				path: 'README.md',
				content: `# Ribix Bug Hunt Demo

A demo app with **intentional bugs** for showcasing Ribix IDE's QA agents.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

## Try it

1. Open Ribix IDE
2. Command Center: "Find and fix all bugs in the bug hunt demo"
3. Watch agents discover all 7 bugs, write failing tests, and generate fixes

## Bugs (don't peek!)

<details>
<summary>Click to reveal</summary>

1. No input validation on transfer amount
2. No null check on users before transfer
3. No overdraft protection (negative balance)
4. SQL injection vulnerability in user lookup
5. Missing error handler for malformed JSON
6. Race condition on concurrent transfers
7. No rate limiting on transfer endpoint

</details>
`,
				skipIfExists: true,
			},
		],
		missionPrompt: 'Find and fix all bugs in the bug hunt demo. Write failing tests for each bug, then fix them. Ask for approval before opening a PR.',
	},
];

// ---------------------------------------------------------------------------
// Template lookup helpers
// ---------------------------------------------------------------------------

/** Returns the template with the given id, or undefined if not found. */
export function getTemplateById(id: string): QuickStartTemplate | undefined {
	return QUICK_START_TEMPLATES.find(t => t.id === id);
}

/** Returns all templates in a given category. */
export function getTemplatesByCategory(category: TemplateCategory): readonly QuickStartTemplate[] {
	return QUICK_START_TEMPLATES.filter(t => t.category === category);
}

/** Returns all unique categories that have at least one template. */
export function getTemplateCategories(): TemplateCategory[] {
	const seen = new Set<TemplateCategory>();
	for (const t of QUICK_START_TEMPLATES) {
		seen.add(t.category);
	}
	return [...seen];
}

// ---------------------------------------------------------------------------
// File generation
// ---------------------------------------------------------------------------

/**
 * Result of scaffolding a template into a workspace.
 */
export interface ScaffoldResult {
	readonly templateId: string;
	readonly createdFiles: string[];
	readonly skippedFiles: string[];
	readonly errors: string[];
}

/**
 * Type for the file-exists check function. Allows injecting a mock in tests.
 */
export type FileExistsFn = (path: string) => boolean;

/**
 * Type for the file-write function. Allows injecting a mock in tests.
 */
export type FileWriteFn = (path: string, content: string) => void;

/**
 * Type for the directory-create function. Allows injecting a mock in tests.
 */
export type DirCreateFn = (path: string) => void;

/**
 * Options for scaffolding a template.
 */
export interface ScaffoldOptions {
	/** Workspace root path (absolute or relative). */
	readonly workspaceRoot: string;
	/** Check if a file exists. */
	readonly fileExists: FileExistsFn;
	/** Write a file. */
	readonly writeFile: FileWriteFn;
	/** Create a directory (recursively). */
	readonly createDir: DirCreateFn;
	/** Path separator (defaults to '/'). */
	readonly pathSeparator?: string;
}

/**
 * Scaffolds a template into a workspace by creating all the template's files.
 *
 * Files with `skipIfExists: true` are skipped if they already exist.
 * Parent directories are created automatically.
 *
 * @param template  The template to scaffold.
 * @param options   Scaffold options (workspace root, file I/O functions).
 * @returns A result describing what was created, skipped, and any errors.
 */
export function scaffoldTemplate(
	template: QuickStartTemplate,
	options: ScaffoldOptions,
): ScaffoldResult {
	const sep = options.pathSeparator ?? '/';
	const createdFiles: string[] = [];
	const skippedFiles: string[] = [];
	const errors: string[] = [];

	for (const file of template.files) {
		try {
			const fullPath = joinPath(options.workspaceRoot, file.path, sep);

			if (file.skipIfExists && options.fileExists(fullPath)) {
				skippedFiles.push(file.path);
				continue;
			}

			// Create parent directories
			const dirPath = dirname(fullPath, sep);
			if (dirPath) {
				options.createDir(dirPath);
			}

			options.writeFile(fullPath, file.content);
			createdFiles.push(file.path);
		} catch (e) {
			errors.push(`Failed to create ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	return {
		templateId: template.id,
		createdFiles,
		skippedFiles,
		errors,
	};
}

// ---------------------------------------------------------------------------
// Path helpers (pure logic, testable without filesystem)
// ---------------------------------------------------------------------------

/** Joins a base path with a relative path using the given separator. */
export function joinPath(base: string, relative: string, sep: string = '/'): string {
	// Normalize separators in the relative path
	const normalized = relative.replace(/[/\\]/g, sep);
	if (base.endsWith(sep) || base === '') {
		return base + normalized;
	}
	return base + sep + normalized;
}

/** Returns the directory portion of a path (everything before the last separator). */
export function dirname(path: string, sep: string = '/'): string {
	const idx = path.lastIndexOf(sep);
	if (idx <= 0) { return ''; }
	return path.substring(0, idx);
}
