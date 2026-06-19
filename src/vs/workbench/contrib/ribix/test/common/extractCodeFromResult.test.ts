/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	SurroundingsRemover,
	extractCodeFromRegular,
	extractCodeFromFIM,
	extractSearchReplaceBlocks,
	endsWithAnyPrefixOf,
} from '../../common/helpers/extractCodeFromResult.js';

// ---------------------------------------------------------------------------
// SurroundingsRemover — string trimming utility used by code extraction
// ---------------------------------------------------------------------------

suite('SurroundingsRemover — basic value', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('value() returns the full string initially', () => {
		const sr = new SurroundingsRemover('hello world');
		assert.strictEqual(sr.value(), 'hello world');
	});

	test('value() returns empty string for empty input', () => {
		const sr = new SurroundingsRemover('');
		assert.strictEqual(sr.value(), '');
	});
});

suite('SurroundingsRemover — removePrefix', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('removes a matching prefix', () => {
		const sr = new SurroundingsRemover('```python\ncode');
		assert.strictEqual(sr.removePrefix('```'), true);
		assert.strictEqual(sr.value(), 'python\ncode');
	});

	test('returns false when prefix does not match', () => {
		const sr = new SurroundingsRemover('hello');
		assert.strictEqual(sr.removePrefix('```'), false);
		assert.strictEqual(sr.value(), 'hello');
	});

	test('removePrefix of empty string returns true (vacuous)', () => {
		const sr = new SurroundingsRemover('hello');
		assert.strictEqual(sr.removePrefix(''), true);
		assert.strictEqual(sr.value(), 'hello');
	});

	test('removePrefix matching entire string leaves empty', () => {
		const sr = new SurroundingsRemover('```');
		assert.strictEqual(sr.removePrefix('```'), true);
		assert.strictEqual(sr.value(), '');
	});
});

suite('SurroundingsRemover — removeSuffix', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('removes a full matching suffix', () => {
		const sr = new SurroundingsRemover('code\n```');
		assert.strictEqual(sr.removeSuffix('```'), true);
		assert.strictEqual(sr.value(), 'code\n');
	});

	test('removes a partial suffix (prefix of the suffix string)', () => {
		// string ends with '<P' which is a prefix of '<PRE/>'
		const sr = new SurroundingsRemover('hi<P');
		assert.strictEqual(sr.removeSuffix('<PRE/>'), false);
		assert.strictEqual(sr.value(), 'hi');
	});

	test('returns false when no suffix matches', () => {
		const sr = new SurroundingsRemover('hello world');
		assert.strictEqual(sr.removeSuffix('```'), false);
		assert.strictEqual(sr.value(), 'hello world');
	});
});

suite('SurroundingsRemover — removeFromStartUntilFullMatch', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('removes up to and including the match string', () => {
		const sr = new SurroundingsRemover('lang\nrest');
		assert.strictEqual(sr.removeFromStartUntilFullMatch('\n', true), true);
		assert.strictEqual(sr.value(), 'rest');
	});

	test('removes up to but not including the match string', () => {
		const sr = new SurroundingsRemover('lang\nrest');
		assert.strictEqual(sr.removeFromStartUntilFullMatch('\n', false), true);
		assert.strictEqual(sr.value(), '\nrest');
	});

	test('returns false when match not found', () => {
		const sr = new SurroundingsRemover('hello');
		assert.strictEqual(sr.removeFromStartUntilFullMatch('\n', true), false);
		assert.strictEqual(sr.value(), 'hello');
	});
});

suite('SurroundingsRemover — removeCodeBlock', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('strips ```lang\\n...``` wrapper', () => {
		const sr = new SurroundingsRemover('```ts\nconst x = 1\n```');
		assert.strictEqual(sr.removeCodeBlock(), true);
		assert.strictEqual(sr.value(), 'const x = 1');
	});

	test('strips ```...``` wrapper without language', () => {
		const sr = new SurroundingsRemover('```\ncode here\n```');
		assert.strictEqual(sr.removeCodeBlock(), true);
		assert.strictEqual(sr.value(), 'code here');
	});

	test('returns false when no code block fence present', () => {
		const sr = new SurroundingsRemover('just text');
		assert.strictEqual(sr.removeCodeBlock(), false);
		assert.strictEqual(sr.value(), 'just text');
	});
});

suite('SurroundingsRemover — deltaInfo', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns delta and ignored suffix', () => {
		const sr = new SurroundingsRemover('aaaaaatextaaaaaa');
		// recentlyAddedTextLen = 4 means last 4 chars are "new"
		// but the string is 'aaaaaatextaaaaaa' (len=16), recentlyAddedIdx = 12
		// i=0, j=15 → actualDelta = substring(0, 16) = full string (since max(0,12)=12 < 16)
		// Actually: actualDelta = substring(max(0, 12), 16) = 'aaaa'
		// ignoredSuffix = substring(max(16, 12), Inf) = ''
		const [delta, ignored] = sr.deltaInfo(4);
		assert.strictEqual(delta, 'aaaa');
		assert.strictEqual(ignored, '');
	});
});

// ---------------------------------------------------------------------------
// extractCodeFromRegular
// ---------------------------------------------------------------------------

suite('extractCodeFromRegular', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('extracts code from a fenced code block', () => {
		const text = '```python\nprint("hello")\n```';
		const [code, delta, ignored] = extractCodeFromRegular({ text, recentlyAddedTextLen: 0 });
		assert.strictEqual(code, 'print("hello")');
	});

	test('returns original text when no code block present', () => {
		const text = 'just some text';
		const [code] = extractCodeFromRegular({ text, recentlyAddedTextLen: 0 });
		assert.strictEqual(code, 'just some text');
	});

	test('handles empty string', () => {
		const [code] = extractCodeFromRegular({ text: '', recentlyAddedTextLen: 0 });
		assert.strictEqual(code, '');
	});
});

// ---------------------------------------------------------------------------
// extractCodeFromFIM
// ---------------------------------------------------------------------------

suite('extractCodeFromFIM', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('extracts code between mid tags', () => {
		const text = '<MID>code here</MID>';
		const [code] = extractCodeFromFIM({ text, recentlyAddedTextLen: 0, midTag: 'MID' });
		assert.strictEqual(code, 'code here');
	});

	test('extracts code with code block wrapper and mid tags', () => {
		const text = '```\n<MID>hello</MID>\n```';
		const [code] = extractCodeFromFIM({ text, recentlyAddedTextLen: 0, midTag: 'MID' });
		assert.strictEqual(code, 'hello');
	});

	test('returns full text when mid tag not found', () => {
		const text = '```\njust code\n```';
		const [code] = extractCodeFromFIM({ text, recentlyAddedTextLen: 0, midTag: 'MID' });
		assert.strictEqual(code, 'just code');
	});
});

// ---------------------------------------------------------------------------
// endsWithAnyPrefixOf
// ---------------------------------------------------------------------------

suite('endsWithAnyPrefixOf', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns the longest matching prefix', () => {
		assert.strictEqual(endsWithAnyPrefixOf('hello world', 'world'), 'world');
	});

	test('returns partial prefix at end of string', () => {
		// 'worl' is a prefix of 'world' and 'hello worl' ends with 'worl'
		assert.strictEqual(endsWithAnyPrefixOf('hello worl', 'world'), 'worl');
	});

	test('returns null when no prefix matches', () => {
		assert.strictEqual(endsWithAnyPrefixOf('hello', 'world'), null);
	});

	test('returns null for empty anyPrefix', () => {
		assert.strictEqual(endsWithAnyPrefixOf('hello', ''), null);
	});
});

// ---------------------------------------------------------------------------
// extractSearchReplaceBlocks — the core search/replace parser
// Uses the test cases from the commented-out tests in the source file.
// ---------------------------------------------------------------------------

suite('extractSearchReplaceBlocks — no blocks', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('empty string returns no blocks', () => {
		assert.deepStrictEqual(extractSearchReplaceBlocks(''), []);
	});

	test('text without ORIGINAL marker returns no blocks', () => {
		assert.deepStrictEqual(extractSearchReplaceBlocks('just some text'), []);
	});

	test('partial ORIGINAL marker (no newline) returns no blocks', () => {
		assert.deepStrictEqual(extractSearchReplaceBlocks('```\n<<<<<<< ORIGINA'), []);
	});
});

suite('extractSearchReplaceBlocks — writingOriginal state', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('ORIGINAL with single line of content, no divider', () => {
		const input = '```\n<<<<<<< ORIGINAL\nA';
		const blocks = extractSearchReplaceBlocks(input);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].state, 'writingOriginal');
		assert.strictEqual(blocks[0].orig, 'A');
		assert.strictEqual(blocks[0].final, '');
	});

	test('ORIGINAL with multi-line content, no divider', () => {
		const input = '```\n<<<<<<< ORIGINAL\nA\nB';
		const blocks = extractSearchReplaceBlocks(input);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].state, 'writingOriginal');
		assert.strictEqual(blocks[0].orig, 'A\nB');
	});

	test('ORIGINAL with content and partial DIVIDER being written', () => {
		const input = '```\n<<<<<<< ORIGINAL\nA\nB\n=======';
		const blocks = extractSearchReplaceBlocks(input);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].state, 'writingOriginal');
		assert.strictEqual(blocks[0].orig, 'A\nB');
	});
});

suite('extractSearchReplaceBlocks — writingFinal state', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('divider found, FINAL not yet written', () => {
		const input = '```\n<<<<<<< ORIGINAL\nA\nB\n=======\n';
		const blocks = extractSearchReplaceBlocks(input);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].state, 'writingFinal');
		assert.strictEqual(blocks[0].orig, 'A\nB');
		assert.strictEqual(blocks[0].final, '');
	});

	test('divider found, partial FINAL being written', () => {
		const input = '```\n<<<<<<< ORIGINAL\nA\nB\n=======\n>>>>>>> UPDAT';
		const blocks = extractSearchReplaceBlocks(input);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].state, 'writingFinal');
		assert.strictEqual(blocks[0].orig, 'A\nB');
		assert.strictEqual(blocks[0].final, '');
	});

	test('divider found, final content being written', () => {
		const input = '```\n<<<<<<< ORIGINAL\nA\nB\n=======\nX\nY';
		const blocks = extractSearchReplaceBlocks(input);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].state, 'writingFinal');
		assert.strictEqual(blocks[0].orig, 'A\nB');
		assert.strictEqual(blocks[0].final, 'X\nY');
	});
});

suite('extractSearchReplaceBlocks — done state', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('complete block with empty final', () => {
		const input = '```\n<<<<<<< ORIGINAL\nA\nB\n=======\n>>>>>>> UPDATED';
		const blocks = extractSearchReplaceBlocks(input);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].state, 'done');
		assert.strictEqual(blocks[0].orig, 'A\nB');
		assert.strictEqual(blocks[0].final, '');
	});

	test('complete block with content in final', () => {
		const input = '```\n<<<<<<< ORIGINAL\nA\nB\n=======\nX\nY\n>>>>>>> UPDATED';
		const blocks = extractSearchReplaceBlocks(input);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].state, 'done');
		assert.strictEqual(blocks[0].orig, 'A\nB');
		assert.strictEqual(blocks[0].final, 'X\nY');
	});

	test('complete block followed by closing code fence', () => {
		const input = '```\n<<<<<<< ORIGINAL\nA\nB\n=======\nX\nY\n>>>>>>> UPDATED\n```';
		const blocks = extractSearchReplaceBlocks(input);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].state, 'done');
		assert.strictEqual(blocks[0].orig, 'A\nB');
		assert.strictEqual(blocks[0].final, 'X\nY');
	});
});

suite('extractSearchReplaceBlocks — multiple blocks', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('two complete blocks in sequence', () => {
		const input = [
			'<<<<<<< ORIGINAL',
			'A',
			'=======',
			'X',
			'>>>>>>> UPDATED',
			'<<<<<<< ORIGINAL',
			'B',
			'=======',
			'Y',
			'>>>>>>> UPDATED',
		].join('\n');
		const blocks = extractSearchReplaceBlocks(input);
		assert.strictEqual(blocks.length, 2);
		assert.strictEqual(blocks[0].state, 'done');
		assert.strictEqual(blocks[0].orig, 'A');
		assert.strictEqual(blocks[0].final, 'X');
		assert.strictEqual(blocks[1].state, 'done');
		assert.strictEqual(blocks[1].orig, 'B');
		assert.strictEqual(blocks[1].final, 'Y');
	});

	test('one complete block followed by a writingOriginal block', () => {
		const input = [
			'<<<<<<< ORIGINAL',
			'A',
			'=======',
			'X',
			'>>>>>>> UPDATED',
			'<<<<<<< ORIGINAL',
			'B',
		].join('\n');
		const blocks = extractSearchReplaceBlocks(input);
		assert.strictEqual(blocks.length, 2);
		assert.strictEqual(blocks[0].state, 'done');
		assert.strictEqual(blocks[1].state, 'writingOriginal');
		assert.strictEqual(blocks[1].orig, 'B');
	});
});
