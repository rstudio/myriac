/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { setup as setupLargeDataFrameTest } from './areas/positron/dataexplorer/largeDataFrame.test';
import { setup as setupNotebookCreateTest } from './areas/positron/notebook/notebookCreate.test';
import { setup as setupConnectionsTest } from './areas/positron/connections/dbConnections.test';
import { setup as setupXLSXDataFrameTest } from './areas/positron/dataexplorer/xlsxDataFrame.test';
import { setup as setupHelpTest } from './areas/positron/help/help.test';
import { setup as setupClipboardTest } from './areas/positron/console/consoleClipboard.test';
import { setup as setupTopActionBarTest } from './areas/positron/top-action-bar/top-action-bar.test';
import { setup, setupBeforeAfterHooks, TEST_SUITES } from './setupUtils';

const suite = TEST_SUITES.MAIN_1;
const logger = setup(suite);
const web = process.env.WEB;

setupBeforeAfterHooks(logger, suite);

describe(`${process.env.SUITE_TITLE}`, () => {
	setupLargeDataFrameTest(logger);
	setupNotebookCreateTest(logger);
	if (!web) { setupConnectionsTest(logger); }
	if (!web) { setupXLSXDataFrameTest(logger); }
	if (!web) { setupHelpTest(logger); }
	if (!web) { setupClipboardTest(logger); }
	if (!web) { setupTopActionBarTest(logger); }
});