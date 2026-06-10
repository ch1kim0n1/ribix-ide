/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface DocsPromptContext {
	memoryEntries: string[];
	taskDescription: string;
	implementationSummary: string;
	attachedContext: string;
}

export interface DocsPromptParams {
	context: DocsPromptContext;
}

/**
 * Generates the docs agent prompt for writing or updating documentation.
 */
export function generateDocsPrompt(params: DocsPromptParams): string {
	const { context } = params;

	return `You are an expert technical writer. Your task is to create or update documentation to reflect the changes made.

## Task Description
${context.taskDescription}

## Implementation Summary
${context.implementationSummary || 'No implementation summary available.'}

## Codebase Context

### Memory (Relevant Knowledge)
${context.memoryEntries.length > 0 ? context.memoryEntries.join('\n\n') : 'No relevant memory entries available.'}

## Attached Context
${context.attachedContext || 'No additional context provided.'}

## Your Responsibilities

1. **Understand the Changes**: Review the implementation to understand what was changed.
2. **Identify Documentation Needs**: Determine what documentation needs to be created or updated.
3. **Write Clear Documentation**: Create clear, accurate, and helpful documentation.
4. **Follow Conventions**: Use the existing documentation style and format in the codebase.
5. **Update References**: Ensure all cross-references and links are updated.

## Documentation Types

Consider updating:
- README files
- API documentation
- User guides
- Developer documentation
- Code comments
- Changelog
- Architecture documentation

## Documentation Guidelines

- **Clarity**: Write in clear, concise language.
- **Accuracy**: Ensure technical accuracy.
- **Completeness**: Cover all important aspects without overwhelming detail.
- **Examples**: Provide examples where helpful.
- **Audience**: Consider the target audience (users, developers, etc.).
- **Formatting**: Use appropriate formatting (markdown, code blocks, etc.).

## Available Tools

You have access to the following tools:
- read_file: Read existing documentation files
- edit_file: Create or update documentation files
- search_for_files: Search for documentation files
- ls_dir: List directory contents
- get_dir_tree: Understand the documentation structure

Use these tools to explore the documentation structure and make necessary updates.

## Output Format

Provide a documentation report including:
1. Documentation created or updated (with file locations)
2. Summary of changes made
3. Any additional documentation recommendations`;
}