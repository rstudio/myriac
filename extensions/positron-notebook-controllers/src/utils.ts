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
	console.log(`[Runtime session] session states (${allSessions.length}): ${JSON.stringify(allSessions.map(s => s.state))}`);
	const activeSessions = allSessions.filter(
		s => s.metadata.notebookUri?.toString() === notebookUri.toString() &&
			s.state !== positron.RuntimeState.Uninitialized &&
			s.state !== positron.RuntimeState.Exiting &&
			s.state !== positron.RuntimeState.Exited);
	if (activeSessions.length > 1) {
		log.error(`Expected at most one active session for notebook ${notebookUri}, got ${activeSessions.length}. Using the first one.`);
	}
	console.log(`[Runtime session] active session states (${activeSessions.length}): ${JSON.stringify(activeSessions.map(s => s.state))}`);
	return activeSessions[0];
}

// Copied from positron/src/vs/base/common/async.ts
export function raceTimeout<T>(promise: Promise<T>, timeout: number, onTimeout?: () => void): Promise<T | undefined> {
	let promiseResolve: ((value: T | undefined) => void) | undefined = undefined;

	const timer = setTimeout(() => {
		promiseResolve?.(undefined);
		onTimeout?.();
	}, timeout);

	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<T | undefined>(resolve => promiseResolve = resolve)
	]);
}
