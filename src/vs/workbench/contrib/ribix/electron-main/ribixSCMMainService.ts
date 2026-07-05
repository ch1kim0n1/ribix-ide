/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { promisify } from 'util'
import { execFile as _execFile } from 'child_process'
import { IRibixSCMService } from '../common/ribixSCMTypes.js'

interface NumStat {
	file: string
	added: number
	removed: number
}

const execFile = promisify(_execFile)

//8000 and 10 were chosen after some experimentation on small-to-moderately sized changes
const MAX_DIFF_LENGTH = 8000
const MAX_DIFF_FILES = 10

/**
 * Run a git subcommand with an explicit argument array.
 *
 * SECURITY: never interpolate user-controlled values (branch names, tag
 * names, stash refs, file paths) into a shell string. Always pass them as
 * separate array elements to execFile, which does not spawn a shell and
 * therefore cannot be subject to command injection.
 */
const git = async (args: string[], cwd: string): Promise<string> => {
	const { stdout, stderr } = await execFile('git', args, { cwd })
	if (stderr) {
		throw new Error(stderr)
	}
	return stdout.trim()
}

const getNumStat = async (path: string, useStagedChanges: boolean): Promise<NumStat[]> => {
	const args = ['diff', '--numstat']
	if (useStagedChanges) { args.push('--staged') }
	const output = await git(args, path)
	return output
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => {
			const [added, removed, file] = line.split('\t')
			return {
				file,
				added: parseInt(added, 10) || 0,
				removed: parseInt(removed, 10) || 0,
			}
		})
}

const getSampledDiff = async (file: string, path: string, useStagedChanges: boolean): Promise<string> => {
	const args = ['diff', '--unified=0', '--no-color']
	if (useStagedChanges) { args.push('--staged') }
	args.push('--', file)
	const diff = await git(args, path)
	return diff.slice(0, MAX_DIFF_LENGTH)
}

const hasStagedChanges = async (path: string): Promise<boolean> => {
	const output = await git(['diff', '--staged', '--name-only'], path)
	return output.length > 0
}

export class RibixSCMService implements IRibixSCMService {
	readonly _serviceBrand: undefined

	async gitStat(path: string): Promise<string> {
		const useStagedChanges = await hasStagedChanges(path)
		const args = ['diff', '--stat']
		if (useStagedChanges) { args.push('--staged') }
		return git(args, path)
	}

	async gitSampledDiffs(path: string): Promise<string> {
		const useStagedChanges = await hasStagedChanges(path)
		const numStatList = await getNumStat(path, useStagedChanges)
		const topFiles = numStatList
			.sort((a, b) => (b.added + b.removed) - (a.added + a.removed))
			.slice(0, MAX_DIFF_FILES)
		const diffs = await Promise.all(topFiles.map(async ({ file }) => ({ file, diff: await getSampledDiff(file, path, useStagedChanges) })))
		return diffs.map(({ file, diff }) => `==== ${file} ====\n${diff}`).join('\n\n')
	}

	gitBranch(path: string): Promise<string> {
		return git(['branch', '--show-current'], path)
	}

	gitLog(path: string): Promise<string> {
		return git(['log', '--pretty=format:%h|%s|%ad', '--date=short', '--no-merges', '-n', '5'], path)
	}

	async gitCreateBranch(path: string, branchName: string): Promise<void> {
		await git(['checkout', '-b', branchName], path)
	}

	async gitCreateTag(path: string, tagName: string, message: string): Promise<void> {
		await git(['tag', '-a', tagName, '-m', message], path)
	}

	async gitRemoteUrl(path: string): Promise<string> {
		return git(['remote', 'get-url', 'origin'], path)
	}

	async gitStashPush(path: string, label: string): Promise<void> {
		await git(['stash', 'push', '-m', label], path)
	}

	async gitStashList(path: string): Promise<string> {
		return git(['stash', 'list'], path)
	}

	async gitStashPop(path: string, stashRef: string): Promise<void> {
		await git(['stash', 'pop', stashRef], path)
	}
}
