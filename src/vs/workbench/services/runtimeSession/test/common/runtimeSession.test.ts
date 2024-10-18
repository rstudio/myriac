/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import * as sinon from 'sinon';
import { DeferredPromise, timeout } from 'vs/base/common/async';
import { URI } from 'vs/base/common/uri';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILanguageRuntimeExit, ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession, IRuntimeSessionService, IRuntimeSessionWillStartEvent } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';
import { createRuntimeServices, createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testRuntimeSessionService';

suite('Positron - RuntimeSessionService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const sessionName = 'Test session';
	const startReason = 'Test requested to start a runtime session';
	const notebookUri = URI.file('/path/to/notebook');
	let instantiationService: TestInstantiationService;
	let runtimeSessionService: IRuntimeSessionService;
	let runtime: ILanguageRuntimeMetadata;

	setup(() => {
		instantiationService = disposables.add(new TestInstantiationService());
		createRuntimeServices(instantiationService, disposables);
		runtimeSessionService = instantiationService.get(IRuntimeSessionService);
		runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
	});

	// TODO: no runtime registered
	// TODO: start after started (different runtime but same language)
	// TODO: start after trusted

	function startSession(notebookUri?: URI): Promise<TestLanguageRuntimeSession> {
		return startTestLanguageRuntimeSession(
			instantiationService,
			disposables,
			{
				runtime,
				sessionName,
				startReason,
				sessionMode: notebookUri ? LanguageRuntimeSessionMode.Notebook : LanguageRuntimeSessionMode.Console,
				notebookUri,
			},
		);
	}

	interface IServiceState {
		hasStartingOrRunningConsole?: boolean;
		consoleSession?: ILanguageRuntimeSession;
		notebookSession?: ILanguageRuntimeSession;
		activeSessions?: ILanguageRuntimeSession[];
	}

	function assertServiceState(expectedState?: IServiceState): void {
		// Check the console session state.
		assert.equal(
			runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId),
			expectedState?.hasStartingOrRunningConsole ?? false,
		);
		assert.equal(
			runtimeSessionService.getConsoleSessionForLanguage(runtime.languageId),
			expectedState?.consoleSession,
		);
		assert.equal(
			runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId),
			expectedState?.consoleSession,
		);
		assert.equal(
			runtimeSessionService.getSession(expectedState?.consoleSession?.sessionId ?? ''),
			expectedState?.consoleSession,
		);
		assert.equal(runtimeSessionService.foregroundSession, expectedState?.consoleSession);

		// Check the notebook session state.
		assert.equal(
			runtimeSessionService.getSession(expectedState?.notebookSession?.sessionId ?? ''),
			expectedState?.notebookSession,
		);

		// Check the global state.
		assert.deepEqual(
			runtimeSessionService.activeSessions,
			expectedState?.activeSessions ??
			(expectedState?.consoleSession ? [expectedState?.consoleSession] : []),
		);
	}

	async function testStartFiresOnWillStartSession(
		notebookUri?: URI,
		expectedState?: IServiceState,
	) {
		const promise = startSession(notebookUri);

		let error: Error | undefined;
		const target = sinon.spy(({ session }: IRuntimeSessionWillStartEvent) => {
			try {
				// TODO: Should onWillStartSession only fire once?
				if (target.callCount > 1) {
					return;
				}
				assert.equal(session.getRuntimeState(), RuntimeState.Uninitialized);
				assertServiceState(expectedState);
			} catch (e) {
				error = e;
			}
		});
		disposables.add(runtimeSessionService.onWillStartSession(target));

		const session = disposables.add(await promise);

		// TODO: Should onWillStartSession only fire once?
		sinon.assert.calledTwice(target);
		sinon.assert.alwaysCalledWithExactly(target, { isNew: true, session });
		assert.ifError(error);
	}

	async function testStartFiresOnDidStartRuntime(
		notebookUri?: URI,
		expectedState?: IServiceState,
	) {
		const promise = startSession(notebookUri);

		let error: Error | undefined;
		const target = sinon.stub<[e: ILanguageRuntimeSession]>().callsFake(session => {
			try {
				assert.equal(session.getRuntimeState(), RuntimeState.Starting);
				assertServiceState(expectedState);
			} catch (e) {
				error = e;
			}
		});
		disposables.add(runtimeSessionService.onDidStartRuntime(target));

		const session = disposables.add(await promise);

		sinon.assert.calledOnceWithExactly(target, session);
		assert.ifError(error);
	}

	test('start console session fires onWillStartSession', async () => {
		testStartFiresOnWillStartSession(undefined, { hasStartingOrRunningConsole: true });
	});

	test('start notebook session fires onWillStartSession', async () => {
		testStartFiresOnWillStartSession(notebookUri);
	});

	test('start console session fires onDidStartRuntime', async () => {
		testStartFiresOnDidStartRuntime();
	});

	test('start notebook session fires onDidStartRuntime', async () => {
		testStartFiresOnDidStartRuntime(notebookUri);
	});

	test.skip('start a new console session', async () => {
		// Start a new session.
		const sessionPromise = startSession();

		// Listen to the onWillStartSession event.
		let willStartSessionError: Error | undefined;
		let willStartSessionCallCount = 0;
		const willStartSessionStub = sinon.stub<[e: IRuntimeSessionWillStartEvent]>().callsFake(({ session }) => {
			try {
				if (willStartSessionCallCount === 0) {
					// Check the session state.
					assert.equal(session.getRuntimeState(), RuntimeState.Uninitialized);

					// Check the runtime session service state.
					assert.equal(runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId), true);
					assert.equal(runtimeSessionService.getSession(session.sessionId), undefined);
					assert.equal(runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId), undefined);
					assert.deepEqual(runtimeSessionService.activeSessions, []);
					assert.equal(runtimeSessionService.getConsoleSessionForLanguage(runtime.languageId), undefined);
					assert.equal(runtimeSessionService.foregroundSession, undefined);
				} else {
					// Check the session state.
					assert.equal(session.getRuntimeState(), RuntimeState.Starting);

					// Check the runtime session service state.
					assert.equal(runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId), true);
					assert.equal(runtimeSessionService.getSession(session.sessionId), session);
					assert.equal(runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId), session);
					assert.deepEqual(runtimeSessionService.activeSessions, [session]);

					// TODO: This is set between willStartSession and didStartRuntime.
					assert.equal(runtimeSessionService.getConsoleSessionForLanguage(runtime.languageId), undefined);

					// TODO: This is only set when the runtime enters the 'ready' state.
					assert.equal(runtimeSessionService.foregroundSession, undefined);
				}

			} catch (error) {
				willStartSessionError = error;
			}
			willStartSessionCallCount++;
		});
		disposables.add(runtimeSessionService.onWillStartSession(willStartSessionStub));

		// Listen to the onDidStartRuntime event.
		const didStartRuntimeDeferred = new DeferredPromise<ILanguageRuntimeSession>();
		const didStartRuntimeStub = sinon.stub<[e: ILanguageRuntimeSession]>().callsFake(session => {
			try {
				// Check the session state.
				assert.equal(session.getRuntimeState(), RuntimeState.Starting);

				// Check the runtime session service state.
				assert.equal(runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId), true);
				assert.equal(runtimeSessionService.getSession(session.sessionId), session);
				assert.equal(runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId), session);
				assert.equal(runtimeSessionService.getConsoleSessionForLanguage(runtime.languageId), session);
				assert.deepEqual(runtimeSessionService.activeSessions, [session]);

				// TODO: These are only set when the runtime enters the 'ready' state.
				assert.equal(runtimeSessionService.foregroundSession, undefined);

				didStartRuntimeDeferred.complete(session);
			} catch (error) {
				didStartRuntimeDeferred.error(error);
			}
		});
		disposables.add(runtimeSessionService.onDidStartRuntime(didStartRuntimeStub));

		// Listen to the onDidChangeForegroundSession event.
		const didChangeForegroundSessionStub = sinon.stub<[e: ILanguageRuntimeSession | undefined]>();
		disposables.add(runtimeSessionService.onDidChangeForegroundSession(didChangeForegroundSessionStub));

		// Check the resolved session details.
		const session = disposables.add(await sessionPromise);
		assert.equal(session.getRuntimeState(), RuntimeState.Starting);
		assert.equal(session.metadata.sessionName, sessionName);
		assert.equal(session.metadata.sessionMode, LanguageRuntimeSessionMode.Console);
		assert.equal(session.metadata.startReason, startReason);

		// Check the event handlers.
		// TODO: This currently fires twice. Once during startNewRuntimeSession and once when the session
		//       changes its state to 'starting'.
		sinon.assert.calledWithExactly(willStartSessionStub, { isNew: true, session });
		sinon.assert.calledOnceWithExactly(didStartRuntimeStub, session);
		sinon.assert.callOrder(willStartSessionStub, didStartRuntimeStub);

		const readyDeferred = new DeferredPromise<void>();
		disposables.add(session.onDidChangeRuntimeState(state => {
			if (state === RuntimeState.Ready) {
				try {

					readyDeferred.complete();
				} catch (error) {
					readyDeferred.error(error);
				}
			}
		}));
		await readyDeferred.p;
		await timeout(0);

		// TODO: Feels a bit surprising that this isn't fired. It's because we set the private
		//       _foregroundSession property instead of the setter. When the 'ready' state is
		//       entered, we skip setting foregroundSession because it already matches the session.
		sinon.assert.notCalled(didChangeForegroundSessionStub);

		// Throw any errors that occurred during the event handlers.
		assert.ifError(willStartSessionError);

		return session;
	});

	test.skip('start a new console session while starting', async () => {
		const [session1, session2] = await Promise.all([
			startConsoleSession(),
			startConsoleSession(),
		]);

		// Check that the same session is resolved.
		assert.equal(session1, session2);

		// Check the session state.
		assert.equal(session1.getRuntimeState(), RuntimeState.Ready);

		// Check that only one session was started.
		assert.deepEqual(runtimeSessionService.activeSessions, [session1]);
	});

	test.skip('restart a console session with "ready" state', async () => {
		// Start a new session.
		const session = await startConsoleSession();

		// Check the initial session state.
		assert.equal(session.getRuntimeState(), RuntimeState.Ready);

		// Check the initial runtime session service state.
		assertServiceState(runtime, { hasStartingOrRunningConsole: true, consoleSession: session });

		// Listen to the onDidChangeRuntimeState event.
		const didChangeRuntimeStateStub = sinon.stub<[e: RuntimeState]>();
		disposables.add(session.onDidChangeRuntimeState(didChangeRuntimeStateStub));

		// Listen to the onDidEndSession event.
		const didEndSessionStub = sinon.stub<[e: ILanguageRuntimeExit]>();
		disposables.add(session.onDidEndSession(didEndSessionStub));

		// Restart the session.
		const restartReason = 'Test requested a restart a runtime session';
		await runtimeSessionService.restartSession(session.sessionId, restartReason);

		// Check the session state after restart.
		assert.equal(session.getRuntimeState(), RuntimeState.Ready);

		// Check the runtime session service state after restart.
		assertServiceState(runtime, { hasStartingOrRunningConsole: true, consoleSession: session });

		// Check the event handlers.
		sinon.assert.calledTwice(didChangeRuntimeStateStub);
		sinon.assert.calledWith(didChangeRuntimeStateStub.firstCall, RuntimeState.Exited);
		sinon.assert.calledWith(didChangeRuntimeStateStub.secondCall, RuntimeState.Ready);
		sinon.assert.calledOnceWithExactly(didEndSessionStub, {
			runtime_name: runtime.runtimeName,
			exit_code: 0,
			reason: RuntimeExitReason.Restart,
			message: ''
		} as ILanguageRuntimeExit);

		// Cleanup.
		session.dispose();
	});

	test.skip('restart a console session with "exited" state', async () => {
		// Start a new session.
		let session = await startConsoleSession();

		// Check the initial session state.
		assert.equal(session.getRuntimeState(), RuntimeState.Ready);

		// Check the initial runtime session service state.
		assertServiceState(runtime, { hasStartingOrRunningConsole: true, consoleSession: session });

		// Shut it down.
		await session.shutdown(RuntimeExitReason.Shutdown);

		// Check the session state after shutdown.
		assert.equal(session.getRuntimeState(), RuntimeState.Exited);

		// Listen to the onDidChangeRuntimeState event.
		// const didChangeRuntimeStateStub = sinon.stub<[e: RuntimeState]>();
		// disposables.add(session.onDidChangeRuntimeState(didChangeRuntimeStateStub));

		// Listen to the onDidEndSession event.
		const didEndSessionStub = sinon.stub<[e: ILanguageRuntimeExit]>();
		disposables.add(session.onDidEndSession(didEndSessionStub));

		// Restart the session.
		const restartReason = 'Test requested a restart a runtime session';
		await runtimeSessionService.restartSession(session.sessionId, restartReason);

		// TODO: Should this be required or is it a bug?
		const oldSession = session;
		session = runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId) as TestLanguageRuntimeSession;

		// Check the session state after restart.
		assert.equal(session.getRuntimeState(), RuntimeState.Ready);

		// Check the runtime session service state after restart.
		// TODO: Should there be two active sessions or is this a bug? See above.
		assertServiceState(runtime, { hasStartingOrRunningConsole: true, consoleSession: session, activeSessions: [oldSession, session] });

		// Check the event handlers.
		// sinon.assert.calledOnceWithExactly(didChangeRuntimeStateStub, RuntimeState.Ready);

		// Cleanup.
		session.dispose();
	});

	test.skip('restart a console session with "starting" state', async () => {
		// Start a new session.
		const session = await startConsoleSession();

		// Check the initial session state.
		assert.equal(session.getRuntimeState(), RuntimeState.Ready);

		// Check the initial runtime session service state.
		assertServiceState(runtime, { hasStartingOrRunningConsole: true, consoleSession: session });

		// Restart the session while it is still starting.
		const restartReason = 'Test requested a restart a runtime session';
		// TODO: This currently fails unless the runtime enters the 'starting' or 'restarting' state.
		//       Maybe it's better for restartSession to coalesce requests while pending than rely
		//       on runtime state.
		// runtimeSessionService.restartSession(session.sessionId, restartReason);
		await runtimeSessionService.restartSession(session.sessionId, restartReason);

		// Check the runtime session service state after restart attempt.
		assertServiceState(runtime, { hasStartingOrRunningConsole: true, consoleSession: session });

		session.dispose();
	});
});
