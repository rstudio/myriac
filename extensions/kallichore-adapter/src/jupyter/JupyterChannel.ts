/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export enum JupyterChannel {
	Shell = 'shell',
	Control = 'control',
	Stdin = 'stdin',
	IOPub = 'iopub',
	Heartbeat = 'heartbeat'
}