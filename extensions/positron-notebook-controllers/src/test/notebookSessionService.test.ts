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

class TestLanguageRuntimeSession implements Partial<positron.LanguageRuntimeSession>, vscode.Disposable {
	private readonly _onDidEndSession = new vscode.EventEmitter<positron.LanguageRuntimeExit>();
	private readonly _onDidChangeRuntimeState = new vscode.EventEmitter<positron.RuntimeState>();

	public readonly onDidEndSession = this._onDidEndSession.event;
	public readonly onDidChangeRuntimeState = this._onDidChangeRuntimeState.event;

	constructor(
		public readonly metadata: positron.RuntimeSessionMetadata,
		public readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
	) { }

	dispose() {
		this._onDidEndSession.dispose();
		this._onDidChangeRuntimeState.dispose();
	}

	async shutdown(_exitReason: positron.RuntimeExitReason): Promise<void> {
		this._onDidEndSession.fire({} as positron.LanguageRuntimeExit);
	}

	setState(state: positron.RuntimeState): void {
		this._onDidChangeRuntimeState.fire(state);
	}
}

suite('NotebookSessionService', () => {
	let disposables: vscode.Disposable[];
	let notebookSessionService: NotebookSessionService;
	let runtime: positron.LanguageRuntimeMetadata;
	let notebookUri: vscode.Uri;
	let session: positron.LanguageRuntimeSession;
	let notebookUri2: vscode.Uri;
	let session2: positron.LanguageRuntimeSession;
	let startLanguageRuntimeStub: sinon.SinonStub;
	let restartSessionStub: sinon.SinonStub;
	let getNotebookSessionStub: sinon.SinonStub;
	let shutdownSpy: sinon.SinonSpy;

	setup(() => {
		disposables = [];
		notebookSessionService = new NotebookSessionService();
		disposables.push(notebookSessionService);

		runtime = {
			runtimeId: 'testRuntime',
			languageName: 'Test Language'
		} as positron.LanguageRuntimeMetadata;

		notebookUri = vscode.Uri.file('test/notebook');
		session = new TestLanguageRuntimeSession(
			{ sessionId: 'testSession' } as positron.RuntimeSessionMetadata, runtime,
		) as any;
		disposables.push(session);

		notebookUri2 = vscode.Uri.file('test/notebook2');
		session2 = new TestLanguageRuntimeSession(
			{ sessionId: 'testSession2' } as positron.RuntimeSessionMetadata, runtime,
		) as any;
		disposables.push(session2);

		// Stub startLanguageRuntime to return the appropriate mock session based on the notebook URI.
		startLanguageRuntimeStub = sinon.stub(positron.runtime, 'startLanguageRuntime');
		startLanguageRuntimeStub.withArgs(runtime.runtimeId, path.basename(notebookUri.fsPath), notebookUri).resolves(session);
		startLanguageRuntimeStub.withArgs(runtime.runtimeId, path.basename(notebookUri2.fsPath), notebookUri2).resolves(session2);

		// Stub the restartSession method to simulate restarting the session.
		const sessionsBySessionId = new Map<string, TestLanguageRuntimeSession>(
			[session, session2].map(s => [s.metadata.sessionId, s as any as TestLanguageRuntimeSession])
		);
		restartSessionStub = sinon.stub(positron.runtime, 'restartSession').callsFake(async (sessionId: string) => {
			const session = sessionsBySessionId.get(sessionId);
			assert(session, `Session with ID ${sessionId} not found`);
			session.setState(positron.RuntimeState.Ready);
		});

		getNotebookSessionStub = sinon.stub(positron.runtime, 'getNotebookSession').resolves(undefined);

		shutdownSpy = sinon.spy(session, 'shutdown');
	});

	teardown(() => {
		disposables.forEach(disposable => disposable.dispose());
		sinon.restore();
	});

	// #region startRuntimeSession

	async function verifyStartRuntimeSession(
		notebookUri: vscode.Uri,
		runtimeId: string,
		expectedSession: positron.LanguageRuntimeSession,
	): Promise<positron.LanguageRuntimeSession> {
		// Start a session for the notebook.
		const session = await notebookSessionService.startRuntimeSession(notebookUri, runtimeId);

		// Assert that the expected session was returned.
		assert.equal(session, expectedSession);

		// Assert that the session was registered.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), expectedSession);

		return session;
	}

	test('start', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		sinon.assert.calledOnce(startLanguageRuntimeStub);
	});

	test('start with a positron error', async () => {
		// Override startLanguageRuntime to throw an error.
		const error = new Error('Failed to start runtime');
		startLanguageRuntimeStub.reset();
		startLanguageRuntimeStub.rejects(error);

		// Assert that starting a session throws the expected error.
		await assert.rejects(notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId), error);

		// Assert that the session was not registered.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('start with existing session in positron', async () => {
		// Stub getNotebookSession to return the mock session.
		getNotebookSessionStub.resolves(session);

		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		sinon.assert.calledOnce(getNotebookSessionStub);
		sinon.assert.notCalled(startLanguageRuntimeStub);
	});

	test('start after already started', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);
		startLanguageRuntimeStub.resetHistory();

		// Starting a session when one is already running should reject.
		await assert.rejects(
			notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId),
			new Error('Tried to start a runtime for a notebook that already has one: /test/notebook')
		);

		sinon.assert.notCalled(startLanguageRuntimeStub);

		// Assert that the session is still registered.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	test('start different notebooks concurrently', async () => {
		// Start sessions for two different notebooks concurrently.
		await Promise.all([
			verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session),
			verifyStartRuntimeSession(notebookUri2, runtime.runtimeId, session2),
		]);

		sinon.assert.calledTwice(startLanguageRuntimeStub);
	});

	test('start while starting', async () => {
		// Start sessions for the same notebook twice concurrently.
		const [startedSession1, startedSession2] = await Promise.all([
			verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session),
			verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session),
		]);

		// Assert that the same session is returned.
		assert.equal(startedSession1, startedSession2);

		// The positron API should only be called once.
		sinon.assert.calledOnce(startLanguageRuntimeStub);
	});

	test('start while starting and starting errors', async () => {
		// Override startLanguageRuntime to throw an error.
		const error = new Error('Failed to start runtime');
		startLanguageRuntimeStub.reset();
		startLanguageRuntimeStub.rejects(error);

		// Attempt to start a session for the same notebook twice concurrently.
		const startPromise1 = notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId);
		const startPromise2 = notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId);

		// Assert that both start attempts throw the expected error.
		await assert.rejects(startPromise1, error);
		await assert.rejects(startPromise2, error);

		sinon.assert.calledOnce(startLanguageRuntimeStub);

		// Assert that the session was not registered with the notebook session service.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('start while shutting down', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);
		startLanguageRuntimeStub.resetHistory();

		// Shutdown the session for the notebook and start a session concurrently.
		notebookSessionService.shutdownRuntimeSession(notebookUri);
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		sinon.assert.calledOnce(shutdownSpy);
		sinon.assert.calledOnce(startLanguageRuntimeStub);
		sinon.assert.callOrder(shutdownSpy, startLanguageRuntimeStub);
	});

	// Related: https://github.com/posit-dev/positron/issues/4224
	test('start while shutting down and shutting down errors', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Stub the shutdown method to throw an error.
		const error = new Error('Failed to shutdown runtime');
		shutdownSpy.restore();
		shutdownSpy = sinon.stub(session, 'shutdown').rejects(error);

		// Attempt to shutdown the runtime session for the notebook URI and start a new session concurrently.
		notebookSessionService.shutdownRuntimeSession(notebookUri);
		// TODO: This should probably not error and should instead use commented out code below.
		await assert.rejects(notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId), error);
		// await notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId);

		// // Verify that the session was shutdown before starting a new one.
		// sinon.assert.callOrder(shutdownSpy, startLanguageRuntimeStub);

		// // Verify that the notebook session service knows of the new session.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	test('start while restarting', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Restart the runtime session for the notebook URI and start a new session concurrently.
		verifyRestartRuntimeSession(notebookUri, session);
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Verify that the restartSession method was called once.
		sinon.assert.calledOnce(restartSessionStub);

		// Verify that startLanguageRuntime was not called a second time.
		sinon.assert.calledOnce(startLanguageRuntimeStub);
	});

	test('start while restarting and restarting errors', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Stub the restartSession method to throw an error.
		const error = new Error('Failed to restart runtime');
		restartSessionStub.reset();
		restartSessionStub.rejects(error);

		// Attempt to restart the runtime session for the notebook URI and start a new session concurrently.
		notebookSessionService.restartRuntimeSession(notebookUri);
		await assert.rejects(notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId), error);

		// Verify that the restartSession method was called once.
		sinon.assert.calledOnce(restartSessionStub);

		// Verify that the notebook session service did not record the session.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	// #endregion

	// #region shutdownRuntimeSession

	async function verifyShutdownRuntimeSession(notebookUri: vscode.Uri): Promise<void> {
		// Shutdown the runtime session for the notebook URI.
		await notebookSessionService.shutdownRuntimeSession(notebookUri);

		// Assert that the session's shutdown method was called.
		sinon.assert.calledOnce(shutdownSpy);

		// Verify that the session is removed from the active sessions map.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	}

	test('shutdown', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);
		await verifyShutdownRuntimeSession(notebookUri);
	});

	test('shutdown with a positron error', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Override the shutdown method to throw an error.
		const error = new Error('Failed to shutdown runtime');
		shutdownSpy.restore();
		shutdownSpy = sinon.stub(session, 'shutdown').rejects(error);

		// Attempt to shutdown the session for the notebook and assert that it throws the expected error.
		await assert.rejects(notebookSessionService.shutdownRuntimeSession(notebookUri), error);

		sinon.assert.calledOnce(shutdownSpy);

		// TODO: Should it be removed?
		// Verify that the session is still recorded in the active sessions map.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	test('shutdown and time out waiting for session to end', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Override the shutdown method to not emit onDidEndSession to trigger a timeout.
		shutdownSpy.restore();
		shutdownSpy = sinon.stub(session, 'shutdown').resolves();

		// Stub the shutdown method to simulate a timeout by not resolving.
		const clock = sinon.useFakeTimers();
		const shutdownPromise = notebookSessionService.shutdownRuntimeSession(notebookUri);

		// Move the clock forward to trigger the timeout.
		clock.tick(5000);

		// Attempt to shutdown the runtime session and assert that it throws a timeout error.
		await assert.rejects(
			shutdownPromise,
			new Error('Shutting down runtime undefined for notebook /test/notebook timed out'),
		);

		// Verify that the session's shutdown method was called.
		sinon.assert.calledOnce(shutdownSpy);

		// TODO: Should it still be removed from the map?
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
		// // Verify that the session is removed from the active sessions map.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('shutdown after already shutdown', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Shutdown the runtime session for the notebook URI.
		await verifyShutdownRuntimeSession(notebookUri);

		// TODO: This should probably *not* throw an error! See: https://github.com/posit-dev/positron/issues/4043
		// Attempt to shutdown the runtime session again and assert that it throws an error.
		await assert.rejects(
			notebookSessionService.shutdownRuntimeSession(notebookUri),
			new Error('Tried to shutdown runtime for notebook without a running runtime: /test/notebook'),
		);

		// Verify that the session's shutdown method was called once.
		sinon.assert.calledOnce(shutdownSpy);
	});

	test('shutdown different notebooks concurrently', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);
		await verifyStartRuntimeSession(notebookUri2, runtime.runtimeId, session2);

		const shutdownSpy2 = sinon.spy(session2, 'shutdown');

		// Shutdown the runtime sessions for two different notebook URIs concurrently.
		await Promise.all([
			verifyShutdownRuntimeSession(notebookUri),
			verifyShutdownRuntimeSession(notebookUri2),
		]);

		// Verify that the shutdown method was called once for each session.
		sinon.assert.calledOnce(shutdownSpy);
		sinon.assert.calledOnce(shutdownSpy2);
	});

	test('shutdown while shutting down', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Shutdown the runtime session for the same notebook URI twice concurrently.
		await Promise.all([
			verifyShutdownRuntimeSession(notebookUri),
			verifyShutdownRuntimeSession(notebookUri),
		]);

		// Verify that the session's shutdown method was called once.
		sinon.assert.calledOnce(shutdownSpy);
	});

	test('shutdown while shutting down and shutting down errors', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Stub the shutdown method to throw an error.
		const error = new Error('Failed to shutdown runtime');
		shutdownSpy.restore();
		shutdownSpy = sinon.stub(session, 'shutdown').rejects(error);

		// Attempt to shutdown the runtime session for the same notebook URI twice concurrently.
		const shutdownPromise1 = notebookSessionService.shutdownRuntimeSession(notebookUri);
		const shutdownPromise2 = notebookSessionService.shutdownRuntimeSession(notebookUri);

		// Assert that both shutdown attempts throw the expected error.
		await assert.rejects(shutdownPromise1, error);
		await assert.rejects(shutdownPromise2, error);

		// Verify that the session's shutdown method was called once.
		sinon.assert.calledOnce(shutdownSpy);

		// Verify that the session is still recorded in the active sessions map.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	test('shutdown while starting', async () => {
		// Start the runtime session for the notebook URI and shutdown the session concurrently.
		verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);
		await notebookSessionService.shutdownRuntimeSession(notebookUri);

		// Verify that the session was started before shutting down.
		sinon.assert.callOrder(startLanguageRuntimeStub, shutdownSpy);

		// Verify that the session is removed from the active sessions map.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('shutdown while starting and starting errors', async () => {
		// Stub startLanguageRuntime to throw an error.
		const error = new Error('Failed to start runtime');
		startLanguageRuntimeStub.reset();
		startLanguageRuntimeStub.rejects(error);

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
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Restart the runtime session for the notebook URI and shutdown the session concurrently.
		verifyRestartRuntimeSession(notebookUri, session);
		await notebookSessionService.shutdownRuntimeSession(notebookUri);

		// Verify that the session was restarted before shutting down.
		sinon.assert.callOrder(restartSessionStub, shutdownSpy);

		// Verify that the session is removed from the active sessions map.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('shutdown while restarting and restarting errors', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Stub the restartSession method to throw an error.
		const error = new Error('Failed to restart runtime');
		restartSessionStub.reset();
		restartSessionStub.rejects(error);

		// Attempt to restart the runtime session for the notebook URI and shutdown the session concurrently.
		notebookSessionService.restartRuntimeSession(notebookUri);

		// TODO: This should probably not error and should instead use commented out code below.
		await assert.rejects(notebookSessionService.shutdownRuntimeSession(notebookUri), error);
		// await notebookSessionService.shutdownRuntimeSession(notebookUri);

		// // Verify that the session was restarted before shutting down.
		// sinon.assert.callOrder(restartSessionStub, shutdownSpy);

		// // Verify that the session is removed from the active sessions map.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	// #endregion

	// #region Restart tests

	async function verifyRestartRuntimeSession(
		notebookUri: vscode.Uri,
		expectedSession: positron.LanguageRuntimeSession,
	): Promise<positron.LanguageRuntimeSession> {
		// Restart the runtime session for the notebook URI.
		const restartedSession = await notebookSessionService.restartRuntimeSession(notebookUri);

		// Assert that the restarted session matches the expected session.
		assert.equal(restartedSession, expectedSession);

		// Verify that the notebook session service now knows of the new session.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), expectedSession);

		return restartedSession;
	}

	test('restart', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);
		await verifyRestartRuntimeSession(notebookUri, session);

		// Verify that the restartRuntimeSession method was called once.
		sinon.assert.calledOnce(restartSessionStub);
	});

	test('restart with a positron error', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Stub the restartSession method to throw an error.
		const error = new Error('Failed to restart runtime');
		restartSessionStub.reset();
		restartSessionStub.rejects(error);

		// TODO: Maybe this shouldn't raise an error?
		// Attempt to restart the runtime session for the notebook URI and assert that it throws the expected error.
		await assert.rejects(notebookSessionService.restartRuntimeSession(notebookUri), error);

		// TODO: This should still be the session, not undefined
		// // Verify that the notebook session service still knows of the original session.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('restart and time out waiting for session to be ready', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Override the restartSession method to simulate a timeout by not resolving.
		restartSessionStub.restore();
		restartSessionStub = sinon.stub(positron.runtime, 'restartSession').callsFake(async () => {
			// Do nothing to simulate a timeout.
		});

		// Stub the setTimeout method to simulate a timeout.
		const clock = sinon.useFakeTimers();
		const restartPromise = notebookSessionService.restartRuntimeSession(notebookUri);

		// Move the clock forward to trigger the timeout.
		clock.tick(5000);

		// Attempt to restart the runtime session and assert that it throws a timeout error.
		await assert.rejects(
			restartPromise,
			new Error('Timeout waiting for runtime to restart')
		);

		// Verify that the restartSession method was called.
		sinon.assert.calledOnce(restartSessionStub);

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
			new Error('Tried to restart runtime for notebook without a running runtime: /test/notebook')
		);

		// Verify that the restartSession method was not called.
		sinon.assert.notCalled(restartSessionStub);
	});

	test('restart after already restarted', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Restart the runtime session for the notebook URI.
		await verifyRestartRuntimeSession(notebookUri, session);

		// Attempt to restart the runtime session again.
		await verifyRestartRuntimeSession(notebookUri, session);

		// Verify that the restartSession method was called twice.
		sinon.assert.calledTwice(restartSessionStub);
	});

	test('restart with a restartSession error', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Stub the restartSession method to throw an error.
		const error = new Error('Failed to restart runtime');
		restartSessionStub.reset();
		restartSessionStub.rejects(error);

		// Attempt to restart the runtime session for the notebook URI and assert that it throws the expected error.
		await assert.rejects(notebookSessionService.restartRuntimeSession(notebookUri), error);

		// TODO: This is currently a bug since we first set the notebook session to undefined
		//       and never correct that if an error is occurred.
		// Verify that the notebook session service still knows of the original session.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	test('restart different notebooks concurrently', async () => {
		await Promise.all([
			verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session),
			verifyStartRuntimeSession(notebookUri2, runtime.runtimeId, session2),
		]);

		// Restart the runtime sessions for two different notebook URIs concurrently.
		await Promise.all([
			verifyRestartRuntimeSession(notebookUri, session),
			verifyRestartRuntimeSession(notebookUri2, session2),
		]);

		// Verify that the restartSession method was called twice.
		sinon.assert.calledTwice(restartSessionStub);
	});

	test('restart while restarting', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Restart the runtime session for the same notebook URI twice concurrently.
		await Promise.all([
			verifyRestartRuntimeSession(notebookUri, session),
			verifyRestartRuntimeSession(notebookUri, session),
		]);

		// Verify that the restartSession method was called once.
		sinon.assert.calledOnce(restartSessionStub);
	});

	test('restart while starting', async () => {
		// Start the runtime session for the notebook URI and restart the session concurrently.
		verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);
		await verifyRestartRuntimeSession(notebookUri, session);

		// Verify that startLanguageRuntime was called once and the restartSession method was not called.
		sinon.assert.calledOnce(startLanguageRuntimeStub);
		sinon.assert.notCalled(restartSessionStub);

		// Verify that the notebook session service now knows of the new session.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	test('restart while starting and starting errors', async () => {
		// Stub startLanguageRuntime to throw an error.
		const error = new Error('Failed to start runtime');
		startLanguageRuntimeStub.reset();
		startLanguageRuntimeStub.rejects(error);

		// Attempt to start the runtime session for the notebook URI and restart the session concurrently.
		notebookSessionService.startRuntimeSession(notebookUri, runtime.runtimeId);
		await assert.rejects(notebookSessionService.restartRuntimeSession(notebookUri), error);

		// Verify that the notebook session service did not record the session.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), undefined);
	});

	test('restart while shutting down', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Shutdown the runtime session for the notebook URI and restart the session concurrently.
		notebookSessionService.shutdownRuntimeSession(notebookUri);
		await verifyRestartRuntimeSession(notebookUri, session);

		// Verify that the session was shutdown before restarting.
		sinon.assert.callOrder(shutdownSpy, restartSessionStub);

		// Verify that the notebook session service now knows of the new session.
		assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	test('restart while shutting down and shutting down errors', async () => {
		await verifyStartRuntimeSession(notebookUri, runtime.runtimeId, session);

		// Stub the shutdown method to throw an error.
		const error = new Error('Failed to shutdown runtime');
		shutdownSpy.restore();
		shutdownSpy = sinon.stub(session, 'shutdown').rejects(error);

		// Attempt to shutdown the runtime session for the notebook URI and restart the session concurrently.
		notebookSessionService.shutdownRuntimeSession(notebookUri);
		// TODO: This should probably not error and should instead use commented out code below.
		await assert.rejects(notebookSessionService.restartRuntimeSession(notebookUri), error);
		// await notebookSessionService.restartRuntimeSession(notebookUri);

		// // Verify that the session was shutdown before restarting.
		// sinon.assert.callOrder(shutdownSpy, restartSessionStub);

		// // Verify that the notebook session service knows of the session.
		// assert.equal(notebookSessionService.getNotebookSession(notebookUri), session);
	});

	// #endregion
});
