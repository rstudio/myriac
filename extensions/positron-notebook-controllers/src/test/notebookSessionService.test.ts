/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { strict as assert } from 'assert';
import { NotebookSessionService } from '../notebookSessionService';
import { raceTimeout } from '../utils';
import { randomUUID } from 'crypto';

const TestRuntimeLanguageVersion = '0.0.1';
const TestRuntimeShortName = TestRuntimeLanguageVersion;
const TestRuntimeName = `Test ${TestRuntimeShortName}`;

class TestLanguageRuntimeSession implements positron.LanguageRuntimeSession {
	private _disposables = new Array<vscode.Disposable>();

	private readonly _onDidReceiveRuntimeMessage = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
	private readonly _onDidChangeRuntimeState = new vscode.EventEmitter<positron.RuntimeState>();
	private readonly _onDidEndSession = new vscode.EventEmitter<positron.LanguageRuntimeExit>();

	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage> = this._onDidReceiveRuntimeMessage.event;
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState> = this._onDidChangeRuntimeState.event;
	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit> = this._onDidEndSession.event;

	private _state = positron.RuntimeState.Uninitialized;

	readonly dynState = {
		inputPrompt: `T>`,
		continuationPrompt: 'T+',
	};

	constructor(
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly metadata: positron.RuntimeSessionMetadata,
	) {
		this._disposables.push(
			this._onDidReceiveRuntimeMessage,
			this._onDidChangeRuntimeState,
			this._onDidEndSession,

			// Track the runtime state.
			this.onDidChangeRuntimeState(state => this._state = state),
		);
	}

	execute(_code: string, _id: string, _mode: positron.RuntimeCodeExecutionMode, _errorBehavior: positron.RuntimeErrorBehavior): void {
		throw new Error('Not implemented.');
	}

	async isCodeFragmentComplete(_code: string): Promise<positron.RuntimeCodeFragmentStatus> {
		throw new Error('Not implemented.');
	}

	async createClient(_id: string, _type: positron.RuntimeClientType, _params: any, _metadata?: any): Promise<void> {
		// Runtime clients are not supported.
	}

	async listClients(_type?: positron.RuntimeClientType | undefined): Promise<Record<string, string>> {
		// Runtime clients are not supported.
		return {};
	}

	removeClient(_id: string): void {
		// Runtime clients are not supported.
	}

	sendClientMessage(_client_id: string, _message_id: string, _message: any): void {
		// Runtime clients are not supported.
	}

	replyToPrompt(_id: string, _reply: string): void {
		throw new Error('Not implemented.');
	}

	async start(): Promise<positron.LanguageRuntimeInfo> {
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Ready);
		return {
			banner: 'Test runtime started',
			implementation_version: this.runtimeMetadata.runtimeVersion,
			language_version: this.runtimeMetadata.languageVersion,
		};
	}

	async interrupt(): Promise<void> {
		throw new Error('Not implemented.');
	}

	async restart(): Promise<void> {
		await this.shutdown(positron.RuntimeExitReason.Restart);
		await this.start();
	}

	async shutdown(exitReason: positron.RuntimeExitReason): Promise<void> {
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Exited);
		this._onDidEndSession.fire({
			runtime_name: this.runtimeMetadata.runtimeName,
			exit_code: 0,
			reason: exitReason,
			message: '',
		});
	}

	async forceQuit(): Promise<void> {
		throw new Error('Not implemented.');
	}

	dispose() {
		this._disposables.forEach(disposable => disposable.dispose());
	}

	// Test helpers.

	get state(): positron.RuntimeState {
		return this._state;
	}

	setState(state: positron.RuntimeState) {
		this._onDidChangeRuntimeState.fire(state);
	}
}

function testLanguageRuntimeMetadata(): positron.LanguageRuntimeMetadata {
	const runtimeId = randomUUID();
	return {
		base64EncodedIconSvg: '',
		extraRuntimeData: {},
		languageId: 'test',
		languageName: 'Test',
		languageVersion: TestRuntimeLanguageVersion,
		runtimeId,
		runtimeName: TestRuntimeName,
		runtimePath: '/test',
		runtimeShortName: TestRuntimeShortName,
		runtimeSource: 'Test',
		runtimeVersion: '0.0.1',
		sessionLocation: positron.LanguageRuntimeSessionLocation.Browser,
		startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit,
	};
}

class TestLanguageRuntimeManager implements positron.LanguageRuntimeManager {
	readonly onDidDiscoverRuntimeEmitter = new vscode.EventEmitter<positron.LanguageRuntimeMetadata>();

	onDidDiscoverRuntime = this.onDidDiscoverRuntimeEmitter.event;

	async* discoverRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		// Do nothing on discovery - we manually register runtimes.
	}

	registerTestLanguageRuntime(): void {
		this.onDidDiscoverRuntimeEmitter.fire(testLanguageRuntimeMetadata());
	}

	async createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata
	): Promise<positron.LanguageRuntimeSession> {
		return new TestLanguageRuntimeSession(runtimeMetadata, sessionMetadata);
	}
}

suite('NotebookSessionService', () => {
	let manager: TestLanguageRuntimeManager;
	let managerDisposable: vscode.Disposable;
	let runtime: positron.LanguageRuntimeMetadata;
	let disposables: vscode.Disposable[];
	let notebookSessionService: NotebookSessionService;
	let notebookUri: vscode.Uri;
	let notebookUri2: vscode.Uri;

	suiteSetup(() => {
		// Register a test runtime manager.
		manager = new TestLanguageRuntimeManager();
		managerDisposable = positron.runtime.registerLanguageRuntimeManager(manager);
	});

	suiteTeardown(() => {
		managerDisposable.dispose();
	});

	setup(async () => {
		disposables = [];

		// Register a new test runtime and wait for it to be acknowledged.
		const registeredRuntimePromise = new Promise<positron.LanguageRuntimeMetadata>((resolve) => {
			const disposable = positron.runtime.onDidRegisterRuntime((runtimeMetadata) => {
				if (runtimeMetadata.runtimeName === TestRuntimeName) {
					disposable.dispose();
					resolve(runtimeMetadata);
				}
			});
		});
		manager.registerTestLanguageRuntime();
		const registeredRuntime = await raceTimeout(registeredRuntimePromise, 50);
		assert(registeredRuntime, 'Timed out waiting for test runtime to be registered');
		runtime = registeredRuntime;

		notebookSessionService = new NotebookSessionService();
		disposables.push(notebookSessionService);

		notebookUri = vscode.Uri.file(randomUUID());
		notebookUri2 = vscode.Uri.file(randomUUID());
	});

	teardown(async () => {
		disposables.forEach(disposable => disposable.dispose());
		sinon.restore();
	});

	// #region startRuntimeSession

	async function verifyStartRuntimeSession(
		notebookUri: vscode.Uri,
	): Promise<TestLanguageRuntimeSession> {
		// Start a session for the notebook.
		const session = await notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId);

		// Check that the expected session was returned.
		assert.ok(session instanceof TestLanguageRuntimeSession);
		assert.equal(session.runtimeMetadata.runtimeName, TestRuntimeName);

		// Check that the session was started.
		assert.equal(session.state, positron.RuntimeState.Ready);

		// Check that the session was registered with the notebook session service.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);

		return session;
	}

	test('start', async () => {
		await verifyStartRuntimeSession(notebookUri);
	});

	test('start with a positron error', async () => {
		// Stub startLanguageRuntime to throw an error.
		const error = new Error('Failed to start runtime');
		sinon.stub(positron.runtime, 'startLanguageRuntime').rejects(error);

		// Check that starting a session throws the expected error.
		await assert.rejects(notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId), error);

		// Check that the session was not registered.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('start with existing session in positron', async () => {
		// Start a session without the notebook session service's knowledge.
		const existingSession = await positron.runtime.startLanguageRuntime(
			runtime.runtimeId, path.basename(notebookUri.fsPath), notebookUri
		);

		const session = await verifyStartRuntimeSession(notebookUri);

		assert.equal(session.metadata.sessionId, existingSession.metadata.sessionId);
	});

	test('start after already started', async () => {
		const session = await verifyStartRuntimeSession(notebookUri);

		// Starting a session when one is already running should reject.
		await assert.rejects(
			notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId),
			new Error(`Tried to start a runtime for a notebook that already has one: ${notebookUri.fsPath}`)
		);

		// Assert that the session is still registered.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	test('start different notebooks concurrently', async () => {
		// Start sessions for two different notebooks concurrently.
		const [session1, session2] = await Promise.all([
			verifyStartRuntimeSession(notebookUri),
			verifyStartRuntimeSession(notebookUri2),
		]);

		// Assert that different sessions are returned.
		assert.notEqual(session1.metadata.sessionId, session2.metadata.sessionId);
	});

	test('start while starting', async () => {
		// Start sessions for the same notebook twice concurrently.
		const [session1, session2] = await Promise.all([
			verifyStartRuntimeSession(notebookUri),
			verifyStartRuntimeSession(notebookUri),
		]);

		// Assert that the same session is returned.
		assert.equal(session1.metadata.sessionId, session2.metadata.sessionId);
	});

	test('start while starting and starting errors', async () => {
		// Stub startLanguageRuntime to throw an error.
		const error = new Error('Failed to start runtime');
		sinon.stub(positron.runtime, 'startLanguageRuntime').rejects(error);

		// Attempt to start a session for the same notebook twice concurrently.
		const startPromise1 = notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId);
		const startPromise2 = notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId);

		// Assert that both start attempts throw the expected error.
		await assert.rejects(startPromise1, error);
		await assert.rejects(startPromise2, error);

		// Assert that no session was registered with the notebook session service.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('start while shutting down', async () => {
		const session = await verifyStartRuntimeSession(notebookUri);

		// Shutdown the session for the notebook and start a session concurrently.
		notebookSessionService.shutdownRuntimeSession(notebookUri);
		const newSession = await verifyStartRuntimeSession(notebookUri);

		// Check that the old session has exited.
		assert.equal(session.state, positron.RuntimeState.Exited);

		// Check that a new session is returned.
		assert.notEqual(session.metadata.sessionId, newSession.metadata.sessionId);
	});

	// Related: https://github.com/posit-dev/positron/issues/4224
	test('start while shutting down and shutting down errors', async () => {
		const session = await verifyStartRuntimeSession(notebookUri);

		// Stub the shutdown method to throw an error.
		const error = new Error('Failed to shutdown runtime');
		sinon.stub(session, 'shutdown').rejects(error);

		// Attempt to shutdown the runtime session for the notebook URI and start a new session concurrently.
		notebookSessionService.shutdownRuntimeSession(notebookUri);
		// TODO: This should probably not error and should instead use commented out code below.
		await assert.rejects(notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId), error);
		// await notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId);

		// // Verify that the notebook session service knows of the new session.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	test('start while restarting', async () => {
		await verifyStartRuntimeSession(notebookUri);

		// Restart the runtime session for the notebook URI and start a new session concurrently.
		notebookSessionService.restartRuntimeSession(notebookUri);
		await verifyStartRuntimeSession(notebookUri);
	});

	test('start while restarting and restarting errors', async () => {
		await verifyStartRuntimeSession(notebookUri);

		// Stub the restartSession method to throw an error.
		const error = new Error('Failed to restart runtime');
		sinon.stub(positron.runtime, 'restartSession').rejects(error);

		// Attempt to restart the runtime session for the notebook URI and start a new session concurrently.
		notebookSessionService.restartRuntimeSession(notebookUri);
		await assert.rejects(notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId), error);

		// Verify that the notebook session service did not record the session.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	// #endregion

	// #region shutdownRuntimeSession

	async function verifyShutdownRuntimeSession(
		notebookUri: vscode.Uri,
		session: TestLanguageRuntimeSession,
	): Promise<void> {
		// Shutdown the runtime session for the notebook URI.
		await notebookSessionService.shutdownRuntimeSession(notebookUri);

		// Check that the session has exited.
		assert.equal(session.state, positron.RuntimeState.Exited);

		// Check that the session is deregistered with the notebook session service.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	}

	test('shutdown', async () => {
		const session = await verifyStartRuntimeSession(notebookUri);
		await verifyShutdownRuntimeSession(notebookUri, session);
	});

	test('shutdown with a positron error', async () => {
		const session = await verifyStartRuntimeSession(notebookUri);

		// Override the shutdown method to throw an error.
		const error = new Error('Failed to shutdown runtime');
		sinon.stub(session, 'shutdown').rejects(error);

		// Attempt to shutdown the session for the notebook and assert that it throws the expected error.
		await assert.rejects(notebookSessionService.shutdownRuntimeSession(notebookUri), error);

		// TODO: Should it be removed?
		// Check that the session is still recorded in the active sessions map.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	test('shutdown and time out waiting for session to end', async () => {
		const session = await verifyStartRuntimeSession(notebookUri);

		// Override the shutdown method to not emit onDidEndSession to trigger a timeout.
		sinon.stub(session, 'shutdown').resolves();

		const clock = sinon.useFakeTimers();
		const shutdownPromise = notebookSessionService.shutdownRuntimeSession(notebookUri);

		// Move the clock forward to trigger the timeout.
		clock.tick(5000);

		// Attempt to shutdown the runtime session and assert that it throws a timeout error.
		await assert.rejects(
			shutdownPromise,
			new Error(`Shutting down runtime ${runtime.runtimeName} for notebook ${notebookUri.fsPath} timed out`),
		);

		// TODO: Should it still be removed from the map?
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
		// // Check that the session is removed from the active sessions map.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('shutdown after already shutdown', async () => {
		const session = await verifyStartRuntimeSession(notebookUri);

		// Shutdown the session for the notebook.
		await verifyShutdownRuntimeSession(notebookUri, session);

		// TODO: This should probably *not* throw an error! See: https://github.com/posit-dev/positron/issues/4043
		// Attempt to shutdown the runtime session again and assert that it throws an error.
		await assert.rejects(
			notebookSessionService.shutdownRuntimeSession(notebookUri),
			new Error(`Tried to shutdown runtime for notebook without a running runtime: ${notebookUri.fsPath}`),
		);

		// TODO: Do we need additional checks here?
	});

	test('shutdown different notebooks concurrently', async () => {
		const session = await verifyStartRuntimeSession(notebookUri);
		const session2 = await verifyStartRuntimeSession(notebookUri2);

		// Shutdown the runtime sessions for two different notebook URIs concurrently.
		await Promise.all([
			verifyShutdownRuntimeSession(notebookUri, session),
			verifyShutdownRuntimeSession(notebookUri2, session2),
		]);
	});

	test('shutdown while shutting down', async () => {
		const session = await verifyStartRuntimeSession(notebookUri);

		// Shutdown the runtime session for the same notebook URI twice concurrently.
		await Promise.all([
			verifyShutdownRuntimeSession(notebookUri, session),
			verifyShutdownRuntimeSession(notebookUri, session),
		]);
	});

	test('shutdown while shutting down and shutting down errors', async () => {
		const session = await verifyStartRuntimeSession(notebookUri);

		// Stub the shutdown method to throw an error.
		const error = new Error('Failed to shutdown runtime');
		sinon.stub(session, 'shutdown').rejects(error);

		// Attempt to shutdown the runtime session for the same notebook URI twice concurrently.
		const shutdownPromise1 = notebookSessionService.shutdownRuntimeSession(notebookUri);
		const shutdownPromise2 = notebookSessionService.shutdownRuntimeSession(notebookUri);

		// Assert that both shutdown attempts throw the expected error.
		await assert.rejects(shutdownPromise1, error);
		await assert.rejects(shutdownPromise2, error);

		// Verify that the session is still recorded in the active sessions map.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	test('shutdown while starting', async () => {
		// Start the runtime session for the notebook URI and shutdown the session concurrently.
		const sessionPromise = notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId);
		await notebookSessionService.shutdownRuntimeSession(notebookUri);

		const session = await sessionPromise;
		assert.ok(session instanceof TestLanguageRuntimeSession);

		assert.equal(session.state, positron.RuntimeState.Exited);

		// Verify that the session is removed from the active sessions map.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('shutdown while starting and starting errors', async () => {
		// Stub startLanguageRuntime to throw an error.
		const error = new Error('Failed to start runtime');
		sinon.stub(positron.runtime, 'startLanguageRuntime').rejects(error);

		// Attempt to start the runtime session for the notebook URI and shutdown the session concurrently.
		notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId);

		// TODO: This should probably not error and should instead use commented out code below.
		await assert.rejects(notebookSessionService.shutdownRuntimeSession(notebookUri), error);

		// await notebookSessionService.shutdownRuntimeSession(notebookUri);

		// // Verify that the session's shutdown method was not called since the session never started.
		// sinon.assert.notCalled(shutdownSpy);

		// // Verify that the session is not recorded in the active sessions map.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('shutdown while restarting', async () => {
		await verifyStartRuntimeSession(notebookUri);

		// Restart the runtime session for the notebook URI and shutdown the session concurrently.
		notebookSessionService.restartRuntimeSession(notebookUri);
		await notebookSessionService.shutdownRuntimeSession(notebookUri);

		// Verify that the session is removed from the active sessions map.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('shutdown while restarting and restarting errors', async () => {
		await verifyStartRuntimeSession(notebookUri);

		// Stub the restartSession method to throw an error.
		const error = new Error('Failed to restart runtime');
		sinon.stub(positron.runtime, 'restartSession').rejects(error);

		// Attempt to restart the runtime session for the notebook URI and shutdown the session concurrently.
		notebookSessionService.restartRuntimeSession(notebookUri);

		// TODO: This should probably not error and should instead use commented out code below.
		await assert.rejects(notebookSessionService.shutdownRuntimeSession(notebookUri), error);
		// await notebookSessionService.shutdownRuntimeSession(notebookUri);

		// // Verify that the session is removed from the active sessions map.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	// #endregion

	// #region Restart tests

	async function verifyRestartRuntimeSession(
		notebookUri: vscode.Uri,
	): Promise<positron.LanguageRuntimeSession> {
		// Restart the runtime session for the notebook URI.
		const session = await notebookSessionService.restartRuntimeSession(notebookUri);

		// Check that the expected session was returned.
		assert.ok(session instanceof TestLanguageRuntimeSession);
		assert.equal(session.runtimeMetadata.runtimeName, TestRuntimeName);

		// Check that the session was started.
		assert.equal(session.state, positron.RuntimeState.Ready);

		// Verify that the notebook session service now knows of the new session.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);

		return session;
	}

	test('restart', async () => {
		await verifyStartRuntimeSession(notebookUri);
		await verifyRestartRuntimeSession(notebookUri);
	});

	test('restart with a positron error', async () => {
		await verifyStartRuntimeSession(notebookUri);

		// Stub the restartSession method to throw an error.
		const error = new Error('Failed to restart runtime');
		sinon.stub(positron.runtime, 'restartSession').rejects(error);

		// TODO: Maybe this shouldn't raise an error?
		// Attempt to restart the runtime session for the notebook URI and assert that it throws the expected error.
		await assert.rejects(notebookSessionService.restartRuntimeSession(notebookUri), error);

		// TODO: This should still be the session, not undefined
		// // Verify that the notebook session service still knows of the original session.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('restart and time out waiting for session to be ready', async () => {
		await verifyStartRuntimeSession(notebookUri);

		// Stub the restartSession method to not fire any events, simulating a timeout.
		sinon.stub(positron.runtime, 'restartSession').resolves();

		const clock = sinon.useFakeTimers();
		const restartPromise = notebookSessionService.restartRuntimeSession(notebookUri);

		// Move the clock forward to trigger the timeout.
		clock.tick(5000);

		// Attempt to restart the runtime session and assert that it throws a timeout error.
		await assert.rejects(
			restartPromise,
			new Error('Timeout waiting for runtime to restart')
		);

		// TODO: This should still be the session, not undefined
		// // Verify that the notebook session service still knows of the original session.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('restart with no running session for the notebook', async () => {
		// TODO: Maybe this shouldn't error and should just start the notebook?
		// Attempt to restart the runtime session for a notebook URI with no running session.
		await assert.rejects(
			notebookSessionService.restartRuntimeSession(notebookUri),
			new Error(`Tried to restart runtime for notebook without a running runtime: ${notebookUri.fsPath}`)
		);

		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('restart after already restarted', async () => {
		await verifyStartRuntimeSession(notebookUri);
		await verifyRestartRuntimeSession(notebookUri);
		await verifyRestartRuntimeSession(notebookUri);
	});

	test('restart with a restartSession error', async () => {
		await verifyStartRuntimeSession(notebookUri);

		// Stub the restartSession method to throw an error.
		const error = new Error('Failed to restart runtime');
		sinon.stub(positron.runtime, 'restartSession').rejects(error);

		// Attempt to restart the runtime session for the notebook URI and assert that it throws the expected error.
		await assert.rejects(notebookSessionService.restartRuntimeSession(notebookUri), error);

		// TODO: This is currently a bug since we first set the notebook session to undefined
		//       and never correct that if an error is occurred.
		// Verify that the notebook session service still knows of the original session.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	test('restart different notebooks concurrently', async () => {
		await Promise.all([
			verifyStartRuntimeSession(notebookUri),
			verifyStartRuntimeSession(notebookUri2),
		]);

		// Restart the runtime sessions for two different notebook URIs concurrently.
		await Promise.all([
			verifyRestartRuntimeSession(notebookUri),
			verifyRestartRuntimeSession(notebookUri2),
		]);
	});

	test('restart while restarting', async () => {
		await verifyStartRuntimeSession(notebookUri);

		// Restart the runtime session for the same notebook URI twice concurrently.
		const [session1, session2] = await Promise.all([
			verifyRestartRuntimeSession(notebookUri),
			verifyRestartRuntimeSession(notebookUri),
		]);

		assert.equal(session1.metadata.sessionId, session2.metadata.sessionId);
	});

	test('restart while starting', async () => {
		// Start the runtime session for the notebook URI and restart the session concurrently.
		notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId);
		await verifyRestartRuntimeSession(notebookUri);
	});

	test('restart while starting and starting errors', async () => {
		// Stub startLanguageRuntime to throw an error.
		const error = new Error('Failed to start runtime');
		sinon.stub(positron.runtime, 'startLanguageRuntime').rejects(error);

		// Attempt to start the runtime session for the notebook URI and restart the session concurrently.
		notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId);
		await assert.rejects(notebookSessionService.restartRuntimeSession(notebookUri), error);

		// Verify that the notebook session service did not record the session.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('restart while shutting down', async () => {
		await verifyStartRuntimeSession(notebookUri);

		// Shutdown the runtime session for the notebook URI and restart the session concurrently.
		notebookSessionService.shutdownRuntimeSession(notebookUri);
		await verifyRestartRuntimeSession(notebookUri);
	});

	test('restart while shutting down and shutdown errors', async () => {
		const session = await verifyStartRuntimeSession(notebookUri);

		// Stub the shutdown method to throw an error.
		const error = new Error('Failed to shutdown runtime');
		sinon.stub(session, 'shutdown').rejects(error);

		// Attempt to shutdown the runtime session for the notebook URI and restart the session concurrently.
		notebookSessionService.shutdownRuntimeSession(notebookUri);
		// TODO: This should probably not error and should instead use commented out code below.
		await assert.rejects(notebookSessionService.restartRuntimeSession(notebookUri), error);
		// await notebookSessionService.restartRuntimeSession(notebookUri);

		// // Verify that the notebook session service knows of the session.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	// #endregion
});
