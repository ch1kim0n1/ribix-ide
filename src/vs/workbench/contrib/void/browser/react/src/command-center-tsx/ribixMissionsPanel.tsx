/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect, useRef } from 'react';
import { useAccessor } from '../util/services.js';
import { IRibixMissionService } from '../../../ribixMissionService.js';
import { Mission } from '../../../../common/ribixTypes.js';
import { RibixMissionCard } from './ribixMissionCard.js';
import { RibixPlanReviewDialog } from './ribixPlanReviewDialog.js';
import { ICodeEditorService } from '../../../../../../../editor/browser/services/codeEditorService.js';

export const RibixMissionsPanel = () => {
	const accessor = useAccessor();
	const missionService = accessor.get(IRibixMissionService);
	const codeEditorService = accessor.get(ICodeEditorService);

	const [missions, setMissions] = useState<Mission[]>([]);
	const [outcome, setOutcome] = useState('');
	const [selectedMission, setSelectedMission] = useState<Mission | null>(null);

	// Context attachment state
	const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
	const [issueUrl, setIssueUrl] = useState('');
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Auto-attach the active editor file on mount and when focus changes
	useEffect(() => {
		const syncActiveFile = () => {
			const activeEditor = codeEditorService.getActiveCodeEditor();
			const resource = activeEditor?.getModel()?.uri;
			if (resource) {
				const uriStr = resource.toString();
				setAttachedFiles(prev => {
					if (prev.includes(uriStr)) { return prev; }
					return [uriStr, ...prev.filter(f => f !== uriStr)];
				});
			}
		};

		syncActiveFile();

		// Re-sync whenever the active editor changes
		const disposable = codeEditorService.onCodeEditorAdd(() => syncActiveFile());
		return () => disposable.dispose();
	}, [codeEditorService]);

	// Derive selection context from active editor on submit
	const getSelectionContext = (): Array<{ filePath: string; range: [number, number]; content: string }> => {
		const editor = codeEditorService.getActiveCodeEditor();
		if (!editor) { return []; }
		const model = editor.getModel();
		const selection = editor.getSelection();
		if (!model || !selection || selection.isEmpty()) { return []; }

		const startLine = selection.startLineNumber;
		const endLine = selection.endLineNumber;
		const text = model.getValueInRange(selection);
		const filePath = model.uri.toString();

		return [{ filePath, range: [startLine, endLine], content: text }];
	};

	useEffect(() => {
		// Load missions on mount
		setMissions(missionService.getAllMissions());

		// Subscribe to mission changes
		const disposable = missionService.onDidChangeMissions(() => {
			setMissions(missionService.getAllMissions());
		});

		return () => {
			disposable.dispose();
		};
	}, [missionService]);

	const handlePlanThis = async () => {
		if (!outcome.trim()) return;

		const attachedSelections = getSelectionContext();

		try {
			const mission = await missionService.createMission(outcome, {
				attachedFiles: [...attachedFiles],
				attachedSelections,
				issueUrls: [issueUrl].filter(Boolean),
				notes: '',
			});

			await missionService.submitForPlanning(mission.id);
			setOutcome('');
			setIssueUrl('');
			setSelectedMission(mission);
		} catch (error) {
			console.error('Failed to create mission:', error);
		}
	};

	const handleAttachFile = () => {
		fileInputRef.current?.click();
	};

	const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (!files) { return; }
		const uris = Array.from(files).map(f => `file://${f.name}`);
		setAttachedFiles(prev => {
			const merged = [...prev];
			for (const uri of uris) {
				if (!merged.includes(uri)) { merged.push(uri); }
			}
			return merged;
		});
		// Reset so the same file can be re-selected
		e.target.value = '';
	};

	const handleRemoveFile = (uri: string) => {
		setAttachedFiles(prev => prev.filter(f => f !== uri));
	};

	const handleMissionClick = (mission: Mission) => {
		setSelectedMission(mission);
	};

	const handleCloseDetail = () => {
		setSelectedMission(null);
	};

	const fileBasename = (uri: string): string => {
		return uri.split('/').pop() ?? uri;
	};

	return (
		<div className="p-4 h-full flex flex-col">
			{/* Outcome Input */}
			<div className="mb-4">
				<textarea
					value={outcome}
					onChange={(e) => setOutcome(e.target.value)}
					placeholder="Describe what you want to achieve..."
					className="w-full h-24 p-3 rounded-lg border-2 resize-none focus:outline-none"
					style={{
						backgroundColor: 'var(--ribix-bg-primary, #01311F)',
						borderColor: 'var(--ribix-gold, #C6AA58)',
						color: 'var(--ribix-text-primary, #F5F0E8)',
					}}
				/>

				{/* Attached files list */}
				{attachedFiles.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-1">
						{attachedFiles.map(uri => (
							<span
								key={uri}
								className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
								style={{
									backgroundColor: 'var(--ribix-bg-secondary, #012A19)',
									color: 'var(--ribix-text-secondary, #8A9E8A)',
									border: '1px solid var(--ribix-gold-dim, #7A6830)',
								}}
								title={uri}
							>
								{fileBasename(uri)}
								<button
									onClick={() => handleRemoveFile(uri)}
									className="ml-0.5 opacity-60 hover:opacity-100"
									aria-label={`Remove ${fileBasename(uri)}`}
								>
									×
								</button>
							</span>
						))}
					</div>
				)}

				{/* Attach file button */}
				<div className="mt-2 flex items-center gap-2">
					<button
						onClick={handleAttachFile}
						className="px-3 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80"
						style={{
							backgroundColor: 'transparent',
							color: 'var(--ribix-text-secondary, #8A9E8A)',
							border: '1px solid var(--ribix-text-secondary, #8A9E8A)',
						}}
						title="Attach a file to this mission"
					>
						+ Attach file
					</button>
					{/* Hidden native file input */}
					<input
						ref={fileInputRef}
						type="file"
						multiple
						className="hidden"
						onChange={handleFileInputChange}
						aria-hidden="true"
					/>
				</div>

				{/* GitHub issue URL */}
				<div className="mt-2">
					<input
						type="url"
						value={issueUrl}
						onChange={(e) => setIssueUrl(e.target.value)}
						placeholder="GitHub issue URL (optional)"
						className="w-full px-3 py-1.5 rounded border text-sm focus:outline-none"
						style={{
							backgroundColor: 'var(--ribix-bg-primary, #01311F)',
							borderColor: 'var(--ribix-border, #2A4A3A)',
							color: 'var(--ribix-text-primary, #F5F0E8)',
						}}
					/>
				</div>

				<button
					onClick={handlePlanThis}
					disabled={!outcome.trim()}
					className="mt-2 px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					style={{
						backgroundColor: 'var(--ribix-gold, #C6AA58)',
						color: 'var(--ribix-bg-primary, #01311F)',
					}}
				>
					Plan This
				</button>
			</div>

			{/* Mission List */}
			<div className="flex-1 overflow-auto">
				<h3 className="text-sm font-semibold mb-3 text-[var(--ribix-text-secondary, #8A9E8A)]">
					Missions
				</h3>
				{missions.length === 0 ? (
					<div className="text-center py-8 text-[var(--ribix-text-secondary, #8A9E8A)]">
						No missions yet. Create your first mission above.
					</div>
				) : (
					<div className="space-y-3">
						{missions.map((mission) => (
							<RibixMissionCard
								key={mission.id}
								mission={mission}
								onClick={() => handleMissionClick(mission)}
							/>
						))}
					</div>
				)}
			</div>

			{/* Mission Detail Dialog */}
			{selectedMission && (
				<RibixPlanReviewDialog
					mission={selectedMission}
					onClose={handleCloseDetail}
				/>
			)}
		</div>
	);
};
