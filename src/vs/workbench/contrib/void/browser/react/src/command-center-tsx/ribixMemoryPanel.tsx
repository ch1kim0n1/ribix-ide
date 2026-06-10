/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect } from 'react';
import { useAccessor } from '../util/services.js';
import { IRibixMemoryService } from '../../../ribixMemoryService.js';
import { MemoryEntry, MemoryEntryType } from '../../../../common/ribixTypes.js';

type MemorySection = 'codebase' | 'patterns' | 'history' | 'vocabulary';

export const RibixMemoryPanel = () => {
	const accessor = useAccessor();
	const memoryService = accessor.get(IRibixMemoryService);
	const [activeSection, setActiveSection] = useState<MemorySection>('codebase');
	const [entries, setEntries] = useState<MemoryEntry[]>([]);
	const [searchQuery, setSearchQuery] = useState('');
	const [addingNote, setAddingNote] = useState(false);
	const [noteText, setNoteText] = useState('');

	useEffect(() => {
		loadMemoryEntries();
	}, [activeSection, memoryService]);

	const loadMemoryEntries = async () => {
		try {
			const workspaceId = await memoryService.getWorkspaceId();
			let entryType: MemoryEntryType;

			switch (activeSection) {
				case 'codebase':
					entryType = 'codebase_file';
					break;
				case 'patterns':
					entryType = 'codebase_pattern';
					break;
				case 'history':
					entryType = 'mission_summary';
					break;
				case 'vocabulary':
					entryType = 'vocabulary_entry';
					break;
				default:
					entryType = 'codebase_file';
			}

			const loadedEntries = await memoryService.getEntries(entryType as any, workspaceId);
			setEntries(loadedEntries);
		} catch (error) {
			console.error('Failed to load memory entries:', error);
			setEntries([]);
		}
	};

	const filteredEntries = entries.filter((entry) =>
		entry.content.toLowerCase().includes(searchQuery.toLowerCase())
	);

	const handleDelete = async (entryId: string) => {
		try {
			await memoryService.deleteEntry(entryId);
			await loadMemoryEntries();
		} catch (error) {
			console.error('Failed to delete entry:', error);
		}
	};

	const handleAddNote = () => {
		setNoteText('');
		setAddingNote(true);
	};

	const handleNoteSubmit = async () => {
		if (!noteText.trim()) return;
		try {
			const workspaceId = await memoryService.getWorkspaceId();
			await memoryService.writeEntry({
				type: 'codebase_pattern' as any,
				workspaceId,
				content: noteText.trim(),
				metadata: {},
				confidence: 1,
				source: 'engineer',
			});
			setAddingNote(false);
			setNoteText('');
			await loadMemoryEntries();
		} catch (error) {
			console.error('Failed to add note:', error);
		}
	};

	const handleNoteCancel = () => {
		setAddingNote(false);
		setNoteText('');
	};

	const getStatusColor = (source: string) => {
		return source === 'engineer' ? 'text-[var(--ribix-gold, #C6AA58)]' : 'text-[var(--ribix-text-secondary, #8A9E8A)]';
	};

	return (
		<div className="p-4 h-full flex flex-col">
			{/* Segmented Control */}
			<div className="flex mb-4 bg-[var(--ribix-bg-primary, #01311F)] rounded-lg p-1">
				{(['codebase', 'patterns', 'history', 'vocabulary'] as MemorySection[]).map((section) => (
					<button
						key={section}
						onClick={() => setActiveSection(section)}
						className={`flex-1 py-2 px-3 text-sm rounded-md transition-colors ${
							activeSection === section
								? 'text-[var(--ribix-bg-primary, #01311F)] bg-[var(--ribix-gold, #C6AA58)]'
								: 'text-[var(--ribix-text-secondary, #8A9E8A)] hover:text-[var(--ribix-text-primary, #F5F0E8)]'
						}`}
					>
						{section.charAt(0).toUpperCase() + section.slice(1)}
					</button>
				))}
			</div>

			{/* Search */}
			<input
				type="text"
				value={searchQuery}
				onChange={(e) => setSearchQuery(e.target.value)}
				placeholder="Search memory..."
				className="w-full mb-4 px-3 py-2 rounded-lg border focus:outline-none"
				style={{
					backgroundColor: 'var(--ribix-bg-primary, #01311F)',
					borderColor: 'var(--ribix-border, #1E4A32)',
					color: 'var(--ribix-text-primary, #F5F0E8)',
				}}
			/>

			{/* Add Note Button / Inline Form */}
			{addingNote ? (
				<div className="mb-4 p-3 rounded-lg border" style={{ backgroundColor: 'var(--ribix-bg-primary, #01311F)', borderColor: 'var(--ribix-border, #1E4A32)' }}>
					<textarea
						autoFocus
						value={noteText}
						onChange={(e) => setNoteText(e.target.value)}
						placeholder="Enter your note..."
						rows={3}
						className="w-full mb-2 px-3 py-2 rounded-lg border focus:outline-none resize-none text-sm"
						style={{
							backgroundColor: 'var(--ribix-bg-secondary, #012B1A)',
							borderColor: 'var(--ribix-border, #1E4A32)',
							color: 'var(--ribix-text-primary, #F5F0E8)',
						}}
					/>
					<div className="flex gap-2">
						<button
							onClick={handleNoteSubmit}
							className="flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
							style={{ backgroundColor: 'var(--ribix-gold, #C6AA58)', color: 'var(--ribix-bg-primary, #01311F)' }}
						>
							Save
						</button>
						<button
							onClick={handleNoteCancel}
							className="flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors text-[var(--ribix-text-secondary, #8A9E8A)] hover:text-[var(--ribix-text-primary, #F5F0E8)]"
						>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<button
					onClick={handleAddNote}
					className="w-full mb-4 px-4 py-2 rounded-lg font-medium transition-colors"
					style={{
						backgroundColor: 'var(--ribix-gold, #C6AA58)',
						color: 'var(--ribix-bg-primary, #01311F)',
					}}
				>
					Add Note
				</button>
			)}

			{/* Memory Entries List */}
			<div className="flex-1 overflow-auto">
				{filteredEntries.length === 0 ? (
					<div className="text-center py-8 text-[var(--ribix-text-secondary, #8A9E8A)]">
						{searchQuery ? 'No matching entries found.' : 'No entries in this section.'}
					</div>
				) : (
					<div className="space-y-2">
						{filteredEntries.map((entry) => (
							<div
								key={entry.id}
								className="p-3 rounded-lg border"
								style={{
									backgroundColor: 'var(--ribix-bg-primary, #01311F)',
									borderColor: 'var(--ribix-border, #1E4A32)',
								}}
							>
								<div className="flex justify-between items-start mb-2">
									<span className={`text-xs font-medium ${getStatusColor(entry.source)}`}>
										{entry.source}
									</span>
									<div className="flex gap-2">
										<span className="text-xs text-[var(--ribix-text-secondary, #8A9E8A)]">
											{entry.type}
										</span>
									</div>
								</div>
								<p className="text-sm text-[var(--ribix-text-primary, #F5F0E8)] mb-2 line-clamp-3">
									{entry.content}
								</p>
								<div className="flex justify-between items-center">
									<div className="w-24 h-1 bg-[var(--ribix-border, #1E4A32)] rounded-full overflow-hidden">
										<div
											className="h-full bg-[var(--ribix-gold, #C6AA58)]"
											style={{ width: `${entry.confidence * 100}%` }}
										/>
									</div>
									<button
										onClick={() => handleDelete(entry.id)}
										className="text-xs text-red-400 hover:text-red-300"
									>
										Delete
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
};