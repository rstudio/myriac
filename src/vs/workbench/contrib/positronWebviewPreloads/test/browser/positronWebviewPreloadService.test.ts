/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { timeout } from 'vs/base/common/async';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { NotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/browser/services/notebookRendererMessagingServiceImpl';
import { INotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/common/notebookRendererMessagingService';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { PositronWebviewPreloadService } from 'vs/workbench/contrib/positronWebviewPreloads/browser/positronWebviewPreloadsService';
import { TestNotebookService } from 'vs/workbench/contrib/positronIPyWidgets/test/browser/positronIPyWidgetsService.test';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { PositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl';
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';
import { IWebviewService } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewService } from 'vs/workbench/contrib/webview/browser/webviewService';
import { LanguageRuntimeSessionMode, RuntimeOutputKind } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';
import { TestRuntimeSessionService } from 'vs/workbench/services/runtimeSession/test/common/testRuntimeSessionService';
import { workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';


const hvPreloadMessage = {
	kind: RuntimeOutputKind.WebviewPreload,
	data: {
		'application/vnd.holoviews_load.v0+json': {},
	},
};

const hvDisplayMessage = {
	kind: RuntimeOutputKind.WebviewPreload,
	data: {
		"application/vnd.holoviews_exec.v0+json": '',
		'text/html': '<div></div>',
		'text/plain': 'hello',
	},
};

const bokehPreloadMessage = {
	kind: RuntimeOutputKind.WebviewPreload,
	data: {
		'application/vnd.bokehjs_load.v0+json': {},
	},
};

const bokehDisplayMessage = {
	kind: RuntimeOutputKind.WebviewPreload,
	data: {
		"application/vnd.bokehjs_exec.v0+json": '',
		"application/javascript": 'console.log("hello")',
	},
};

suite('Positron - PositronWebviewPreloadService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let positronWebviewPreloadService: PositronWebviewPreloadService;
	let runtimeSessionService: TestRuntimeSessionService;

	setup(() => {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.stub(INotebookRendererMessagingService, disposables.add(instantiationService.createInstance(NotebookRendererMessagingService)));
		instantiationService.stub(INotebookService, new TestNotebookService());
		instantiationService.stub(IWebviewService, disposables.add(new WebviewService(instantiationService)));
		instantiationService.stub(IPositronNotebookOutputWebviewService, instantiationService.createInstance(PositronNotebookOutputWebviewService));
		runtimeSessionService = disposables.add(new TestRuntimeSessionService());
		instantiationService.stub(IRuntimeSessionService, runtimeSessionService);
		positronWebviewPreloadService = disposables.add(instantiationService.createInstance(PositronWebviewPreloadService));
	});

	async function createConsoleSession() {

		// Start a console session.
		const session = disposables.add(new TestLanguageRuntimeSession(LanguageRuntimeSessionMode.Console));
		runtimeSessionService.startSession(session);

		await timeout(0);

		const out: {
			session: TestLanguageRuntimeSession;
			plotClient: WebviewPlotClient | undefined;
		} = {
			session, plotClient: undefined,
		};

		disposables.add(positronWebviewPreloadService.onDidCreatePlot(client => {
			out.plotClient = client;
		}));

		return out;
	}

	test('console session: dependency messages are absorbed without emitting plot', async () => {
		const consoleSession = await createConsoleSession();

		// Simulate the runtime sending an HoloViews output message.
		consoleSession.session.receiveOutputMessage(hvPreloadMessage);
		await timeout(0);

		// No plot should have been emitted.
		assert(!Boolean(consoleSession.plotClient));
		assert.equal(positronWebviewPreloadService.sessionInfo(consoleSession.session.sessionId)?.numberOfMessages, 1);

		// Send another preload message.
		consoleSession.session.receiveOutputMessage(bokehPreloadMessage);
		await timeout(0);
		assert.equal(positronWebviewPreloadService.sessionInfo(consoleSession.session.sessionId)?.numberOfMessages, 2);

		// End the session.
		consoleSession.session.endSession();
		await timeout(0);
	});

	test('console session: Service emits plot client after display message is received', async () => {
		const consoleSession = await createConsoleSession();

		// Send one preload message.
		consoleSession.session.receiveOutputMessage(hvPreloadMessage);
		await timeout(0);

		// Send a display message
		const displayMessageHv = consoleSession.session.receiveOutputMessage(hvDisplayMessage);
		await timeout(0);

		// Display message shouldnt have been absorbed into preload messages
		assert.equal(positronWebviewPreloadService.sessionInfo(consoleSession.session.sessionId)?.numberOfMessages, 1);

		// Plot client should have been emitted and it should be linked to the display message.
		assert(Boolean(consoleSession.plotClient));
		assert.strictEqual(consoleSession.plotClient!.id, displayMessageHv.id);

		// Emit a bokeh display message and another plot should be created
		const displayMessageBokeh = consoleSession.session.receiveOutputMessage(bokehDisplayMessage);
		await timeout(0);
		assert.strictEqual(consoleSession.plotClient!.id, displayMessageBokeh.id);

		// End the session.
		consoleSession.session.endSession();
		await timeout(0);
	});

});