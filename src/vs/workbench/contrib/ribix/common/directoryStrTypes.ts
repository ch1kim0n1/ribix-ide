import { URI } from '../../../../base/common/uri.js';

export type RibixDirectoryItem = {
	uri: URI;
	name: string;
	isSymbolicLink: boolean;
	children: RibixDirectoryItem[] | null;
	isDirectory: boolean;
	isGitIgnoredDirectory: false | { numChildren: number }; // if directory is gitignored, we ignore children
}
