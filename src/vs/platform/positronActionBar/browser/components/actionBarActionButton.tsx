/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./actionBarActionButton';

// React.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { IAction } from 'vs/base/common/actions';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { MenuItemAction } from 'vs/platform/actions/common/actions';
import { IModifierKeyStatus, ModifierKeyEmitter } from 'vs/base/browser/dom';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { useRegisterWithActionBar } from 'vs/platform/positronActionBar/browser/useRegisterWithActionBar';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { ActionBarButton, ActionBarButtonProps } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { actionTooltip, toMenuActionItem } from 'vs/platform/positronActionBar/common/helpers';

/**
 * Constants.
 */
const CODICON_ID = /^codicon codicon-(.+)$/;

/**
 * Determines whether the alternative action should be used.
 * @param accessibilityService The accessibility service.
 * @param menuItemAction The menu item action.
 * @param mouseOver Whether the mouse is over the action bar action button.
 * @param modifierKeyStatus The modifier key status.
 * @returns A value which indicates whether the alternative action should be used.
 */
const shouldUseAlternativeAction = (
	accessibilityService: IAccessibilityService,
	menuItemAction?: MenuItemAction,
	mouseOver?: boolean,
	modifierKeyStatus?: IModifierKeyStatus
) => {
	// If a menu item action was not supplied, return false
	if (!menuItemAction) {
		return false;
	}

	// If there isn't an alt action, or there is and it's not enabled, return false
	if (!menuItemAction.alt?.enabled) {
		return false;
	}

	// If the modifier key status was not supplied, get it from the modifier key emitter.
	if (!modifierKeyStatus) {
		modifierKeyStatus = ModifierKeyEmitter.getInstance().keyStatus;
	}

	// If motion is not reduced and the alt key is pressed, return true.
	if (!accessibilityService.isMotionReduced() && modifierKeyStatus.altKey) {
		return true;
	}

	// If the mouse is over the action bar action button and the shift or alt key is pressed, return
	// true.
	if (mouseOver && (modifierKeyStatus.shiftKey || modifierKeyStatus.altKey)) {
		return true;
	}

	// Do not use the alternative action.
	return false;
};

/**
 * ActionBarActionButtonProps interface.
 */
interface ActionBarActionButtonProps {
	readonly action: IAction;
}

/**
 * ActionBarCommandButton component.
 * @param props An ActionBarCommandButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarActionButton = (props: ActionBarActionButtonProps) => {
	// Context hooks.
	const context = usePositronActionBarContext();

	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// Menu action item.
	const menuActionItem = toMenuActionItem(props.action);

	// State hooks.
	const [, setMouseInside, mouseInsideRef] = useStateRef(false);
	const [useAlternativeAction, setUseAlternativeAction] = useState(
		shouldUseAlternativeAction(context.accessibilityService, menuActionItem)
	);

	// Main use effect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Get the modifier key emitter and add the event listener to it.
		const modifierKeyEmitter = ModifierKeyEmitter.getInstance();
		disposableStore.add(modifierKeyEmitter.event(modifierKeyStatus => {
			setUseAlternativeAction(shouldUseAlternativeAction(
				context.accessibilityService,
				menuActionItem,
				mouseInsideRef.current,
				modifierKeyStatus
			));
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [context.accessibilityService, menuActionItem, mouseInsideRef]);

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	// Get the action we're going to render.
	const action = menuActionItem &&
		useAlternativeAction &&
		menuActionItem.alt?.enabled ? menuActionItem.alt : props.action;

	// Build the dynamic properties.
	const dynamicProps = ((): ActionBarButtonProps => {
		// Extract the icon ID from the action's class.
		const iconIdResult = action.class?.match(CODICON_ID);
		const iconId = iconIdResult?.length === 2 ? iconIdResult[1] : undefined;

		// Return the properties.
		return {
			ariaLabel: action.label ?? action.tooltip,
			iconId: iconId,
			tooltip: actionTooltip(
				context.contextKeyService,
				context.keybindingService,
				action,
				!useAlternativeAction
			),
			disabled: !action.enabled,
			onMouseEnter: () => setMouseInside(true),
			onMouseLeave: () => setMouseInside(false),
			onPressed: () =>
				action.run()
		};
	})();

	// Render.
	return (
		<ActionBarButton
			ref={buttonRef}
			{...dynamicProps}
		/>
	);
};