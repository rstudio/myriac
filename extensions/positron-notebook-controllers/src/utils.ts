/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { log } from './extension';

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getRunningNotebookSession(notebookUri: vscode.Uri): Promise<positron.LanguageRuntimeSession | undefined> {
	const allSessions = await positron.runtime.getSessions();
	const activeSessions = allSessions.filter(
		s => s.metadata.notebookUri?.toString() === notebookUri.toString() &&
			s.state !== positron.RuntimeState.Exited);
	if (activeSessions.length > 1) {
		log.error(`Expected at most one active session for notebook ${notebookUri}, got ${activeSessions.length}. Using the first one.`);
	}
	return activeSessions[0];
}
