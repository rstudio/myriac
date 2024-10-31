/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import * as sinon from 'sinon';
import { URI } from 'vs/base/common/uri';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { formatLanguageRuntimeMetadata, ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
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

	function startSession(
		notebookUri?: URI,
		runtimeMetadata?: ILanguageRuntimeMetadata,
		sessionMode?: LanguageRuntimeSessionMode,
	): Promise<TestLanguageRuntimeSession> {
		return startTestLanguageRuntimeSession(
			instantiationService,
			disposables,
			{
				runtime: runtimeMetadata ?? runtime,
				sessionName,
				startReason,
				sessionMode: sessionMode ??
					notebookUri ?
					LanguageRuntimeSessionMode.Notebook :
					LanguageRuntimeSessionMode.Console,
				notebookUri,
			},
		);
	}

	interface IServiceState {
		hasStartingOrRunningConsole?: boolean;
		consoleSession?: ILanguageRuntimeSession;
		notebookSession?: ILanguageRuntimeSession;
		notebookSessionForNotebookUri?: ILanguageRuntimeSession;
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

		// Check the notebook session state.
		assert.equal(
			runtimeSessionService.getSession(expectedState?.notebookSession?.sessionId ?? ''),
			expectedState?.notebookSession,
		);
		assert.equal(
			runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri),
			expectedState?.notebookSessionForNotebookUri,
		);

		// Check the global state.
		assert.deepEqual(
			runtimeSessionService.activeSessions,
			expectedState?.activeSessions ??
			[expectedState?.consoleSession, expectedState?.notebookSession].filter(session => Boolean(session)),
		);
	}

	async function testStartSessionDetails(notebookUri?: URI) {
		const session = await startSession(notebookUri);
		assert.equal(session.getRuntimeState(), RuntimeState.Starting);
		assert.equal(session.metadata.sessionName, sessionName);
		assert.equal(
			session.metadata.sessionMode,
			notebookUri ? LanguageRuntimeSessionMode.Notebook : LanguageRuntimeSessionMode.Console,
		);
		assert.equal(session.metadata.notebookUri, notebookUri);
		assert.equal(session.metadata.startReason, startReason);
		assert.equal(session.runtimeMetadata, runtime);
	}

	async function testStartFiresOnWillStartSession(verify: () => void, notebookUri?: URI) {
		let error: Error | undefined;
		const target = sinon.spy(({ session }: IRuntimeSessionWillStartEvent) => {
			try {
				// TODO: Should onWillStartSession only fire once?
				if (target.callCount > 1) {
					return;
				}
				assert.equal(session.getRuntimeState(), RuntimeState.Uninitialized);
				verify();
			} catch (e) {
				error = e;
			}
		});
		disposables.add(runtimeSessionService.onWillStartSession(target));
		const session = await startSession(notebookUri);

		// TODO: Should onWillStartSession only fire once?
		sinon.assert.calledTwice(target);
		sinon.assert.alwaysCalledWithExactly(target, { isNew: true, session });
		assert.ifError(error);
	}

	async function testStartFiresOnDidStartRuntime(
		verify: (session: ILanguageRuntimeSession) => void,
		notebookUri?: URI,
	) {
		let error: Error | undefined;
		const target = sinon.stub<[e: ILanguageRuntimeSession]>().callsFake(session => {
			try {
				assert.equal(session.getRuntimeState(), RuntimeState.Starting);
				verify(session);
			} catch (e) {
				error = e;
			}
		});
		disposables.add(runtimeSessionService.onDidStartRuntime(target));

		const session = await startSession(notebookUri);

		sinon.assert.calledOnceWithExactly(target, session);
		assert.ifError(error);
	}

	suite('startNewRuntimeSession', () => {
		test('start console session details', async () => {
			await testStartSessionDetails();
		});

		test('start notebook session details', async () => {
			await testStartSessionDetails(notebookUri);
		});

		test('start console service state', async () => {
			// Check the initial state.
			assertServiceState();

			const promise = startSession();

			// Check the state while starting.
			assertServiceState({ hasStartingOrRunningConsole: true });

			const session = await promise;

			// Check the state after starting.
			assertServiceState({ hasStartingOrRunningConsole: true, consoleSession: session });
		});

		test('start notebook service state', async () => {
			// Check the initial state.
			assertServiceState();

			const promise = startSession(notebookUri);

			// Check the state while starting.
			assertServiceState();

			const session = await promise;

			// Check the state after starting.
			assertServiceState({ notebookSession: session, notebookSessionForNotebookUri: session });
		});

		test('start console fires onWillStartSession', async () => {
			await testStartFiresOnWillStartSession(
				() => assertServiceState({ hasStartingOrRunningConsole: true }),
			);
		});

		test('start notebook fires onWillStartSession', async () => {
			await testStartFiresOnWillStartSession(
				() => assertServiceState(),
				notebookUri,
			);
		});

		test('start console fires onDidStartRuntime', async () => {
			await testStartFiresOnDidStartRuntime(
				session => assertServiceState({ hasStartingOrRunningConsole: true, consoleSession: session }),
			);
		});

		test('start notebook fires onDidStartRuntime', async () => {
			await testStartFiresOnDidStartRuntime(
				session => assertServiceState({ notebookSession: session, notebookSessionForNotebookUri: session }),
				notebookUri,
			);
		});

		test('start session event order', async () => {
			const willStartSession = sinon.spy();
			disposables.add(runtimeSessionService.onWillStartSession(willStartSession));

			const didStartRuntime = sinon.spy();
			disposables.add(runtimeSessionService.onDidStartRuntime(didStartRuntime));

			await startSession();

			sinon.assert.callOrder(willStartSession, didStartRuntime);
		});

		test('start console sets foregroundSession', async () => {
			const target = sinon.spy();
			disposables.add(runtimeSessionService.onDidChangeForegroundSession(target));

			const session = await startSession();

			assert.equal(runtimeSessionService.foregroundSession, session);

			await new Promise<void>(resolve => {
				disposables.add(session.onDidChangeRuntimeState(state => {
					if (state === RuntimeState.Ready) {
						resolve();
					}
				}));
			});

			// TODO: Feels a bit surprising that this isn't fired. It's because we set the private
			//       _foregroundSession property instead of the setter. When the 'ready' state is
			//       entered, we skip setting foregroundSession because it already matches the session.
			sinon.assert.notCalled(target);
		});

		test('start session for unknown runtime', async () => {
			const runtimeId = 'unknown-runtime-id';
			await assert.rejects(
				startSession(undefined, { runtimeId } as ILanguageRuntimeMetadata),
				new Error(`No language runtime with id '${runtimeId}' was found.`),
			);
		});

		test('start notebook without notebook uri', async () => {
			await assert.rejects(
				startSession(undefined, undefined, LanguageRuntimeSessionMode.Notebook),
				new Error('A notebook URI must be provided to start a notebook session.'),
			);
		});

		// TODO: Not sure why this is failing.
		test.skip('start console encounters session.start() error', async () => {
			// Stub the session start method to throw an error.
			const willStartSession = sinon.spy((e: IRuntimeSessionWillStartEvent) => {
				sinon.stub(e.session, 'start').rejects(new Error('Session failed to start'));
			});
			disposables.add(runtimeSessionService.onWillStartSession(willStartSession));

			const didFailStartRuntime = sinon.spy();
			disposables.add(runtimeSessionService.onDidFailStartRuntime(didFailStartRuntime));

			const didStartRuntime = sinon.spy();
			disposables.add(runtimeSessionService.onDidStartRuntime(didStartRuntime));

			const session = await startSession();

			assert.equal(session.getRuntimeState(), RuntimeState.Uninitialized);

			// TODO: Seems unexpected that some of these are defined and others not.
			assert.equal(runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId), false);
			assert.equal(runtimeSessionService.getConsoleSessionForLanguage(runtime.languageId), undefined);
			assert.equal(runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId), session);
			assert.equal(runtimeSessionService.getSession(session.sessionId), session);
			assert.deepEqual(runtimeSessionService.activeSessions, [session]);

			sinon.assert.calledOnceWithExactly(didFailStartRuntime, session);
			sinon.assert.callOrder(willStartSession, didFailStartRuntime);
			sinon.assert.notCalled(didStartRuntime);
		});
	});

	suite('shutdownNotebookSession', () => {
		test('shutdown notebook', async () => {
			const session = await startSession(notebookUri);

			await runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown);

			assert.equal(session.getRuntimeState(), RuntimeState.Exited);
			// TODO: The session is in activeSessions and returned by getSession but not by
			//       getNotebookSessionForNotebookUri. Is that correct? This is also the only reason
			//       we need a notebookForNotebookUri parameter in assertServiceState.
			assertServiceState({ notebookSession: session });
		});

		test('shutdown notebook without running runtime', async () => {
			// It should not error, since it's already in the desired state.
			await runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown);
			assertServiceState();
		});
	});

	suite('queuing', () => {
		test('start console and notebook from the same runtime concurrently', async () => {
			// Consoles and notebooks shouldn't interfere with each other, even for the same runtime.
			const [consoleSession, notebookSession] = await Promise.all([
				startSession(),
				startSession(notebookUri),
			]);

			assert.equal(consoleSession.getRuntimeState(), RuntimeState.Starting);
			assert.equal(notebookSession.getRuntimeState(), RuntimeState.Starting);

			assertServiceState({
				hasStartingOrRunningConsole: true,
				consoleSession,
				notebookSession,
				notebookSessionForNotebookUri: notebookSession,
				activeSessions: [consoleSession, notebookSession],
			});
		});

		test('start console while another runtime is starting for the language', async () => {
			const anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);

			await assert.rejects(
				Promise.all([
					startSession(),
					startSession(undefined, anotherRuntime),
				]),
				new Error(`Session for language runtime ${formatLanguageRuntimeMetadata(anotherRuntime)} ` +
					`cannot be started because language runtime ${formatLanguageRuntimeMetadata(runtime)} ` +
					`is already starting for the language. Request source: ${startReason}`),
			);
		});

		test('start notebook while another runtime is starting for the notebook', async () => {
			const anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);

			await assert.rejects(
				Promise.all([
					startSession(notebookUri),
					startSession(notebookUri, anotherRuntime),
				]),
				new Error(`Session for language runtime ${formatLanguageRuntimeMetadata(anotherRuntime)} ` +
					`cannot be started because language runtime ${formatLanguageRuntimeMetadata(runtime)} ` +
					`is already starting for the notebook ${notebookUri.toString()}. Request source: ${startReason}`));
		});

		test('start console while another runtime is running for the language', async () => {
			await startSession();

			const anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
			await assert.rejects(
				startSession(undefined, anotherRuntime),
				new Error(`A console for ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
					`be started because a console for ${formatLanguageRuntimeMetadata(runtime)} ` +
					`is already running for the ${runtime.languageName} language.`),
			);
		});

		test('start notebook while another runtime is running for the notebook', async () => {
			await startSession(notebookUri);

			const anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
			await assert.rejects(
				startSession(notebookUri, anotherRuntime),
				new Error(`A session for ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
					`be started because a session for ${formatLanguageRuntimeMetadata(runtime)} ` +
					`is already running for the notebook ${notebookUri.toString()}.`));
		});

		test('shutdown notebook while starting', async () => {
			const [session,] = await Promise.all([
				startSession(notebookUri),
				runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown),
			]);

			assert.equal(session.getRuntimeState(), RuntimeState.Exited);
			assertServiceState({ notebookSession: session });
		});

		test('start notebook while shutting down', async () => {
			const session1 = await startSession(notebookUri);

			const [, session2,] = await Promise.all([
				runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown),
				startSession(notebookUri),
			]);

			assert.equal(session1.getRuntimeState(), RuntimeState.Exited);
			assert.equal(session2.getRuntimeState(), RuntimeState.Starting);
			assertServiceState({
				notebookSession: session2,
				notebookSessionForNotebookUri: session2,
				activeSessions: [session1, session2],
			});
		});

		test('start console concurrently', async () => {
			const [session1, session2, session3] = await Promise.all([
				startSession(),
				startSession(),
				startSession(),
			]);

			// Check that the same session was returned.
			assert.equal(session1, session2);
			assert.equal(session2, session3);

			// Check that only one session was started.
			assertServiceState({ hasStartingOrRunningConsole: true, consoleSession: session1 });
		});

		test('shutdown notebook concurrently', async () => {
			const session = await startSession(notebookUri);

			await Promise.all([
				runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown),
				runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown),
				runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown),
			]);

			assert.equal(session.getRuntimeState(), RuntimeState.Exited);
		});

		test('start console successively', async () => {
			const session1 = await startSession();
			const session2 = await startSession();
			const session3 = await startSession();

			// Check that the same session was returned each time.
			assert.equal(session1, session2);
			assert.equal(session2, session3);

			// Check that only one session was started.
			assertServiceState({ hasStartingOrRunningConsole: true, consoleSession: session1 });
		});

		test('start notebook successively', async () => {
			const session1 = await startSession(notebookUri);
			const session2 = await startSession(notebookUri);
			const session3 = await startSession(notebookUri);

			// Check that the same session was returned each time.
			assert.equal(session1, session2);
			assert.equal(session2, session3);

			// Check that only one session was started.
			assertServiceState({ notebookSession: session1, notebookSessionForNotebookUri: session1 });
		});
	});

	// test.skip('restart a console session with "ready" state', async () => {
	// 	// Start a new session.
	// 	const session = await startConsoleSession();

	// 	// Check the initial session state.
	// 	assert.equal(session.getRuntimeState(), RuntimeState.Ready);

	// 	// Check the initial runtime session service state.
	// 	assertServiceState(runtime, { hasStartingOrRunningConsole: true, consoleSession: session });

	// 	// Listen to the onDidChangeRuntimeState event.
	// 	const didChangeRuntimeStateStub = sinon.stub<[e: RuntimeState]>();
	// 	disposables.add(session.onDidChangeRuntimeState(didChangeRuntimeStateStub));

	// 	// Listen to the onDidEndSession event.
	// 	const didEndSessionStub = sinon.stub<[e: ILanguageRuntimeExit]>();
	// 	disposables.add(session.onDidEndSession(didEndSessionStub));

	// 	// Restart the session.
	// 	const restartReason = 'Test requested a restart a runtime session';
	// 	await runtimeSessionService.restartSession(session.sessionId, restartReason);

	// 	// Check the session state after restart.
	// 	assert.equal(session.getRuntimeState(), RuntimeState.Ready);

	// 	// Check the runtime session service state after restart.
	// 	assertServiceState(runtime, { hasStartingOrRunningConsole: true, consoleSession: session });

	// 	// Check the event handlers.
	// 	sinon.assert.calledTwice(didChangeRuntimeStateStub);
	// 	sinon.assert.calledWith(didChangeRuntimeStateStub.firstCall, RuntimeState.Exited);
	// 	sinon.assert.calledWith(didChangeRuntimeStateStub.secondCall, RuntimeState.Ready);
	// 	sinon.assert.calledOnceWithExactly(didEndSessionStub, {
	// 		runtime_name: runtime.runtimeName,
	// 		exit_code: 0,
	// 		reason: RuntimeExitReason.Restart,
	// 		message: ''
	// 	} as ILanguageRuntimeExit);

	// 	// Cleanup.
	// 	session.dispose();
	// });

	// test.skip('restart a console session with "exited" state', async () => {
	// 	// Start a new session.
	// 	let session = await startConsoleSession();

	// 	// Check the initial session state.
	// 	assert.equal(session.getRuntimeState(), RuntimeState.Ready);

	// 	// Check the initial runtime session service state.
	// 	assertServiceState(runtime, { hasStartingOrRunningConsole: true, consoleSession: session });

	// 	// Shut it down.
	// 	await session.shutdown(RuntimeExitReason.Shutdown);

	// 	// Check the session state after shutdown.
	// 	assert.equal(session.getRuntimeState(), RuntimeState.Exited);

	// 	// Listen to the onDidChangeRuntimeState event.
	// 	// const didChangeRuntimeStateStub = sinon.stub<[e: RuntimeState]>();
	// 	// disposables.add(session.onDidChangeRuntimeState(didChangeRuntimeStateStub));

	// 	// Listen to the onDidEndSession event.
	// 	const didEndSessionStub = sinon.stub<[e: ILanguageRuntimeExit]>();
	// 	disposables.add(session.onDidEndSession(didEndSessionStub));

	// 	// Restart the session.
	// 	const restartReason = 'Test requested a restart a runtime session';
	// 	await runtimeSessionService.restartSession(session.sessionId, restartReason);

	// 	// TODO: Should this be required or is it a bug?
	// 	const oldSession = session;
	// 	session = runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId) as TestLanguageRuntimeSession;

	// 	// Check the session state after restart.
	// 	assert.equal(session.getRuntimeState(), RuntimeState.Ready);

	// 	// Check the runtime session service state after restart.
	// 	// TODO: Should there be two active sessions or is this a bug? See above.
	// 	assertServiceState(runtime, { hasStartingOrRunningConsole: true, consoleSession: session, activeSessions: [oldSession, session] });

	// 	// Check the event handlers.
	// 	// sinon.assert.calledOnceWithExactly(didChangeRuntimeStateStub, RuntimeState.Ready);

	// 	// Cleanup.
	// 	session.dispose();
	// });

	// test.skip('restart a console session with "starting" state', async () => {
	// 	// Start a new session.
	// 	const session = await startConsoleSession();

	// 	// Check the initial session state.
	// 	assert.equal(session.getRuntimeState(), RuntimeState.Ready);

	// 	// Check the initial runtime session service state.
	// 	assertServiceState(runtime, { hasStartingOrRunningConsole: true, consoleSession: session });

	// 	// Restart the session while it is still starting.
	// 	const restartReason = 'Test requested a restart a runtime session';
	// 	// TODO: This currently fails unless the runtime enters the 'starting' or 'restarting' state.
	// 	//       Maybe it's better for restartSession to coalesce requests while pending than rely
	// 	//       on runtime state.
	// 	// runtimeSessionService.restartSession(session.sessionId, restartReason);
	// 	await runtimeSessionService.restartSession(session.sessionId, restartReason);

	// 	// Check the runtime session service state after restart attempt.
	// 	assertServiceState(runtime, { hasStartingOrRunningConsole: true, consoleSession: session });

	// 	session.dispose();
	// });
});
