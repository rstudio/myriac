/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import * as sinon from 'sinon';
import { URI } from 'vs/base/common/uri';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { formatLanguageRuntimeMetadata, ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
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

	function startSession(
		notebookUri?: URI,
		runtimeMetadata?: ILanguageRuntimeMetadata,
	): Promise<TestLanguageRuntimeSession> {
		return startTestLanguageRuntimeSession(
			instantiationService,
			disposables,
			{
				runtime: runtimeMetadata ?? runtime,
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

		// Check the notebook session state.
		assert.equal(
			runtimeSessionService.getSession(expectedState?.notebookSession?.sessionId ?? ''),
			expectedState?.notebookSession,
		);

		// Check the global state.
		assert.deepEqual(
			runtimeSessionService.activeSessions,
			expectedState?.activeSessions ??
			[expectedState?.consoleSession, expectedState?.notebookSession].filter(session => Boolean(session)),
		);
	}

	async function testStartSessionDetails(notebookUri?: URI) {
		const session = disposables.add(await startSession(notebookUri));
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
		const promise = startSession(notebookUri);

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

		const session = disposables.add(await promise);

		// TODO: Should onWillStartSession only fire once?
		sinon.assert.calledTwice(target);
		sinon.assert.alwaysCalledWithExactly(target, { isNew: true, session });
		assert.ifError(error);
	}

	async function testStartFiresOnDidStartRuntime(
		verify: (session: ILanguageRuntimeSession) => void,
		notebookUri?: URI,
	) {
		const promise = startSession(notebookUri);

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

		const session = disposables.add(await promise);

		sinon.assert.calledOnceWithExactly(target, session);
		assert.ifError(error);
	}

	suite('startNewRuntimeSession', () => {
		test('start console details', async () => {
			await testStartSessionDetails();
		});

		test('start notebook details', async () => {
			await testStartSessionDetails(notebookUri);
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
				session => assertServiceState({ notebookSession: session }),
				notebookUri,
			);
		});

		test('start session event order', async () => {
			const promise = startSession();

			const willStartSession = sinon.spy();
			disposables.add(runtimeSessionService.onWillStartSession(willStartSession));

			const didStartRuntime = sinon.spy();
			disposables.add(runtimeSessionService.onDidStartRuntime(didStartRuntime));

			disposables.add(await promise);

			sinon.assert.callOrder(willStartSession, didStartRuntime);
		});

		test('start console sets foregroundSession', async () => {
			const target = sinon.spy();
			disposables.add(runtimeSessionService.onDidChangeForegroundSession(target));

			const session = disposables.add(await startSession());

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

		// TODO: Maybe this should be moved to a queuing suite.
		test('start console for a runtime that is already running', async () => {
			const session1 = await startSession();
			const session2 = await startSession();

			// Check that the same session was returned.
			assert.equal(session1, session2);

			// Check that only one session was started.
			assertServiceState({ hasStartingOrRunningConsole: true, consoleSession: session1 });
		});

		test('start console while the same runtime is starting', async () => {
			const [session1, session2] = await Promise.all([
				startSession(),
				startSession(),
			]);

			// Check that the same session was returned.
			assert.equal(session1, session2);

			// Check that only one session was started.
			assertServiceState({ hasStartingOrRunningConsole: true, consoleSession: session1 });
		});

		// TODO: Maybe this should be moved to a queuing suite.
		test('start console while another runtime is starting for the language', async () => {
			const anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
			startSession();

			await assert.rejects(
				startSession(undefined, anotherRuntime),
				new Error(`Session for language runtime ${formatLanguageRuntimeMetadata(anotherRuntime)} ` +
					`cannot be started because language runtime ${formatLanguageRuntimeMetadata(runtime)} ` +
					`is already starting for the language. Request source: ${startReason}`),
			);
		});

		// TODO: Maybe this should be moved to a queuing suite.
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

		// TODO: Maybe this should be moved to a queuing suite.
		test('start notebook while another runtime is starting for the notebook', async () => {
			const anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
			startSession(notebookUri);

			await assert.rejects(startSession(notebookUri, anotherRuntime),
				new Error(`Session for language runtime ${formatLanguageRuntimeMetadata(anotherRuntime)} ` +
					`cannot be started because language runtime ${formatLanguageRuntimeMetadata(runtime)} ` +
					`is already starting for the notebook ${notebookUri.toString()}. Request source: ${startReason}`));
		});

		// TODO: Maybe this should be moved to a queuing suite.
		test('start notebook while another runtime is running for the notebook', async () => {
			await startSession(notebookUri);

			const anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
			await assert.rejects(startSession(notebookUri, anotherRuntime),
				new Error(`A session for ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
					`be started because a session for ${formatLanguageRuntimeMetadata(runtime)} ` +
					`is already running for the notebook ${notebookUri.toString()}.`));
		});

		// TODO: Not sure why the after hook is failing here.
		test.skip('start session encounters session.start() error', async () => {
			// Stub the session start method to throw an error.
			disposables.add(runtimeSessionService.onWillStartSession(e => {
				sinon.stub(e.session, 'start').rejects(new Error('Session failed to start'));
			}));

			const willStartSession = sinon.spy();
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

	suite('Queuing', () => {
		// TODO: We can't actually test this yet because we don't have a shutdown method.
		// test('should process operations in order', async () => {
		// 	const sessionPromise = startSession();
		// 	const shutdownPromise = startSession();
		// 	const restartPromise = runtimeSessionService.restartSession(sessionPromise.id);

		// 	await shutdownPromise;
		// 	assert.strictEqual(sessionPromise.status, 'exited');

		// 	await restartPromise;
		// 	assert.strictEqual(sessionPromise.status, 'active');
		// });

		test('should return the same promise for duplicate start requests', async () => {
			// const startPromise1 = manager.startSession('console', { runtimeId: '123' });
			// const startPromise2 = manager.startSession('console', { runtimeId: '123' });

			// assert.strictEqual(startPromise1, startPromise2);

			// const session = await startPromise1;
			// assert.strictEqual(session.status, 'active');
		});
	});

	// test.skip('start a new console session while starting', async () => {
	// 	const [session1, session2] = await Promise.all([
	// 		startConsoleSession(),
	// 		startConsoleSession(),
	// 	]);

	// 	// Check that the same session is resolved.
	// 	assert.equal(session1, session2);

	// 	// Check the session state.
	// 	assert.equal(session1.getRuntimeState(), RuntimeState.Ready);

	// 	// Check that only one session was started.
	// 	assert.deepEqual(runtimeSessionService.activeSessions, [session1]);
	// });

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
