/**
 * Kallichore API
 * Kallichore is a Jupyter kernel gateway and supervisor
 *
 * The version of the OpenAPI document: 1.0.0
 * Contact: info@posit.co
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { RequestFile } from './models';
import { InterruptMode } from './interruptMode';

export class Session {
    /**
    * A unique identifier for the session
    */
    'sessionId': string;
    /**
    * The username of the user who owns the session
    */
    'username': string;
    /**
    * The program and command-line parameters for the session
    */
    'argv': Array<string>;
    /**
    * The working directory in which to start the session.
    */
    'workingDirectory': string;
    /**
    * Environment variables to set for the session
    */
    'env': { [key: string]: string; };
    'interruptMode'?: InterruptMode;

    static discriminator: string | undefined = undefined;

    static attributeTypeMap: Array<{name: string, baseName: string, type: string}> = [
        {
            "name": "sessionId",
            "baseName": "session_id",
            "type": "string"
        },
        {
            "name": "username",
            "baseName": "username",
            "type": "string"
        },
        {
            "name": "argv",
            "baseName": "argv",
            "type": "Array<string>"
        },
        {
            "name": "workingDirectory",
            "baseName": "working_directory",
            "type": "string"
        },
        {
            "name": "env",
            "baseName": "env",
            "type": "{ [key: string]: string; }"
        },
        {
            "name": "interruptMode",
            "baseName": "interrupt_mode",
            "type": "InterruptMode"
        }    ];

    static getAttributeTypeMap() {
        return Session.attributeTypeMap;
    }
}

export namespace Session {
}