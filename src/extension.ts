/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This is the entrypoint for extension.js, the main webpack bundle for the extension.
 * Anything needing to be exposed outside of the extension sources must be exported from here, because
 * everything else will be in private modules in extension.js.
 *
 *   dist/extension.js:
 *      The main extension module (contains the bulk of the extension code as packaged by webpack)
 *      Single module containing most of the code sources. Exports activateInternal and any functions needed by the tests
 *      Compiled from src/extension.ts, src/cosmosExtension.ts, and most other production sources
 *      Module entrypoint is src/extension.ts (this file), so only items exported from this file are exported from dist/extension.js
 *
 *   entrypoint.js:
 *      Actual extension entrypoint seen by vscode.
 *      Exports activate.
 *      Its only reason for existence (instead of using dist/extension.js) is to measure the load time for extension.js.
 *
 *   dist/test/
 *      Contains test files compiled from test/*.ts files.
 *      Should not import source .ts files directly because:
 *        1) That can cause multiple definitions of singletons in extension code (like extensionVariables)
 *        2) We want to test the webpacked code
 *      Instead they should import src/extension.ts, which will be exposed at runtime through dist/extension.js.
 */

// Export activate for vscode to call (via entrypoint.js)
export { activateInternal } from './cosmosExtension';

// Exports for use by the tests, which are not packaged with the webpack bundle and therefore
//   only have access to code exported from this file. The tests should import '../extension.ts' (this file),
//   to access these exports, and at runtime they will pick up dist/extension.js.
