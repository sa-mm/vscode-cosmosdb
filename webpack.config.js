/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

//asdf

'use strict';

const path = require('path');
const process = require('process');
const webpack = require('webpack');
const fse = require('fs-extra');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const StringReplacePlugin = require("string-replace-webpack-plugin");

const packageLock = fse.readJSONSync('./package-lock.json');

let DEBUG_WEBPACK = !!process.env.DEBUG_WEBPACK;

const externalNodeModules = [
    // Modules that we can't webpack for some reason.
    // Keep this list small, because all the subdependencies will also be excluded
    'require_optional',
    'vscode-languageclient'
];

// External modules and all their dependencies and subdependencies (these will not be webpacked)
const externalModulesClosure = getDependencies(externalNodeModules);
if (DEBUG_WEBPACK) {
    console.log('externalModulesClosure:', externalModulesClosure);
}

/**@type {import('webpack').Configuration}*/
const config = {
    // vscode extensions run in a Node.js context, see https://webpack.js.org/configuration/node/
    target: 'node',
    context: __dirname,
    node: {
        // For __dirname and __filename, use the path to the packed extension.js file (true would mean the relative path to the original source file)
        __dirname: false,
        __filename: false
    },
    entry: {
        // Note: Each entry is a completely separate Node.js application that cannot interact with any
        // of the others, and that individually includes all dependencies necessary (i.e. common
        // dependencies will have a copy in each entry file, no sharing).

        // The entrypoint of this extension, see https://webpack.js.org/configuration/entry-context/
        extension: './src/extension.ts',

        // Separate module for the mongo language server (doesn't share any code with extension.js)
        './mongo-languageServer': './src/mongo/languageServer.ts'
    },
    output: {
        // The bundles are stored in the 'dist' folder (check package.json), see https://webpack.js.org/configuration/output/
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: "commonjs2",
        devtoolModuleFilenameTemplate: "../[resource-path]"
    },
    devtool: 'source-map',
    externals: [
        {
            // Modules that cannot be webpack'ed, see https://webpack.js.org/configuration/externals/

            // The vscode-module is created on-the-fly and must be excluded.
            vscode: 'commonjs vscode',

            // Fix "Module not found" errors in ./node_modules/websocket/lib/{BufferUtil,Validation}.js
            //   and 'ws' module.
            // These files are not in node_modules and so will fail normally at runtime and instead use fallbacks.
            // Make them as external so webpack doesn't try to process them, and they'll simply fail at runtime as before.
            '../build/Release/validation': 'commonjs ../build/Release/validation',
            '../build/default/validation': 'commonjs ../build/default/validation',
            '../build/Release/bufferutil': 'commonjs ../build/Release/bufferutil',
            '../build/default/bufferutil': 'commonjs ../build/default/bufferutil',
            'bufferutil': 'commonjs bufferutil',
            'utf-8-validate': 'commonjs utf-8-validate',

            // Fix "module not found" error in node_modules/es6-promise/dist/es6-promise.js
            'vertx': 'commonjs vertx',

            // Fix trying to load .map file in node_modules\socket.io\lib\index.js
            //   in this code:
            //     clientSourceMap = read(require.resolve('socket.io-client/dist/socket.io.js.map'), 'utf-8');
            'socket.io-client/dist/socket.io.js.map': 'commonjs socket.io-client/dist/socket.io.js.map', // (expected to fail)

            // Fix "Module not found" in node_modules\copy-paste\index.js
            //   in this code:
            //     case "openbsd":
            //       config = require("./platform/openbsd");
            // asdf remove when switch to clipboardy
            './platform/openbsd': 'commonjs ./platform/openbsd',

            // Pull the rest automatically from externalModulesClosure
            ...getExternalsEntries()
        }
    ],
    plugins: [
        // Clean the dist folder before webpacking
        new CleanWebpackPlugin(
            ['dist'],
            {
                root: __dirname,
                verbose: true,
            }),

        // Copy files to dist folder where the runtime can find them
        new CopyWebpackPlugin([
            // Test files -> dist/test (skipped during packaging)
            { from: './out/test', to: 'test' }
        ]),

        // External node modules (can't be webpacked) -> dist/node_modules (where they can be found by extension.js)
        getExternalsCopyEntry(),

        // // Replace vscode-languageserver/lib/files.js with a modified version that doesn't have webpack issues
        // // new webpack.NormalModuleReplacementPlugin(
        // //     /[/\\]vscode-languageserver[/\\]lib[/\\]files\.js/,
        // //     require.resolve('./build/vscode-languageserver-files-stub.js')
        // // ),

        // Fix error:
        //   > WARNING in ./node_modules/ms-rest/lib/serviceClient.js 441:19-43
        //   > Critical dependency: the request of a dependency is an expression
        // in this code:
        //   let data = require(packageJsonPath);
        //
        new webpack.ContextReplacementPlugin(
            // Whenever there is a dynamic require that webpack can't analyze at all (i.e. resourceRegExp=/^\./), ...
            /^\./,
            (context) => {
                // ... and the call was from within node_modules/ms-rest/lib...
                if (/node_modules[/\\]ms-rest[/\\]lib/.test(context.context)) {
                    /* CONSIDER: Figure out how to make this work properly.

                        // ... tell webpack that the call may be loading any of the package.json files from the 'node_modules/azure-arm*' folders
                        // so it will include those in the package to be available for lookup at runtime
                        context.request = path.resolve(__dirname, 'node_modules');
                        context.regExp = /azure-arm.*package\.json/;
                    */

                    // In the meantime, just ignore the error by telling webpack we've solved the critical dependency issue.
                    // The consequences of ignoring this error are that
                    //   the Azure SDKs (e.g. azure-arm-resource) don't get their info stamped into the user agent info for their calls.
                    for (const d of context.dependencies) {
                        if (d.critical) { d.critical = false; }
                    }
                }
            }),

        // An instance of the StringReplacePlugin plugin must be present for it to work (its use is configured in modules).
        //
        // StringReplacePlugin allows you to specific parts of a file by regexp replacement to get around webpack issues such as dynamic imports.
        // This is different from ContextReplacementPlugin, which is simply meant to help webpack find files referred to by a dynamic import (i.e. it
        //   assumes  they can be found by simply knowing the correct the path).
        new StringReplacePlugin()
    ],
    resolve: {
        // Support reading TypeScript and JavaScript files, see https://github.com/TypeStrong/ts-loader
        // These will be automatically transpiled while being placed into dist/extension.js
        extensions: ['.ts', '.js']
    },
    module: {
        //asdf noParse: /websocket[\\/]lib[\\/]Validation/,
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [{
                    // Note: the TS loader will transpile the .ts file directly during webpack, it doesn't use the out folder.
                    // CONSIDER: awesome-typescript-loader (faster?)
                    loader: 'ts-loader'
                }]
            },

            {
                // asdf comment
                test: /\.(png|jpg|gif|svg)$/,
                use: [
                    {
                        loader: 'file-loader',
                        options: {
                            name: '[path][name].[ext]'
                        }
                    }
                ],
            },

            {
                // Fix error:
                //   > WARNING in ./node_modules/engine.io/lib/server.js 67:43-65
                //   > Critical dependency: the request of a dependency is an expression
                // in this code:
                //   var WebSocketServer = (this.wsEngine ? require(this.wsEngine) : require('ws')).Server;
                test: /engine\.io[/\\]lib[/\\]server.js$/,
                loader: StringReplacePlugin.replace({
                    replacements: [
                        {
                            pattern: /var WebSocketServer = \(this.wsEngine \? require\(this\.wsEngine\) : require\('ws'\)\)\.Server;/ig,
                            replacement: function (match, offset, string) {
                                // Since we're not using the wsEngine option, we'll just require it to not be set and use only the `require('ws')` call.
                                return `if (!!this.wsEngine) {
                                            throw new Error('wsEngine option not supported with current webpack settings');
                                        }
                                        var WebSocketServer = require('ws').Server;`;
                            }
                        }
                    ]
                })
            },

            {
                // Fix error:
                //   > ERROR in ./node_modules/socket.io/lib/index.js
                //   > Module not found: Error: Can't resolve 'socket.io-client/package' in 'C:\Users\stephwe\Repos\vscode-cosmosdb\node_modules\socket.io\lib'
                // in this code:
                //   var clientVersion = require('socket.io-client/package').version;
                test: /socket\.io[/\\]lib[/\\]index\.js$/,
                loader: StringReplacePlugin.replace({
                    replacements: [
                        {
                            pattern: /require\('socket\.io-client\/package'\)/ig,
                            replacement: function (match, offset, string) {
                                // Replace it with package.json so it can be found
                                return `require('socket.io-client/package.json')`; // asdf test // asdf other situations like this?
                            }
                        }
                    ]
                })
            },

            // Note: If you use`vscode-nls` to localize your extension than you likely also use`vscode-nls-dev` to create language bundles at build time.
            // To support webpack, a loader has been added to vscode-nls-dev .Add the section below to the`modules/rules` configuration.
            // {
            //     // vscode-nls-dev loader:
            //     // * rewrite nls-calls
            //     loader: 'vscode-nls-dev/lib/webpack-loader',
            //     options: {
            //         base: path.join(__dirname, 'src')
            //     }
            // }
        ]
    }
}

function getExternalsEntries() {
    let externals = {};
    for (let moduleName of externalModulesClosure) {
        // e.g.
        // 'clipboardy': 'commonjs clipboardy',
        externals[moduleName] = `commonjs ${moduleName}`;
    }

    return externals;
}

function getExternalsCopyEntry() {
    // e.g.
    // new CopyWebpackPlugin([
    //     { from: './node_modules/clipboardy', to: 'node_modules/clipboardy' }
    //     ...
    // ])
    let patterns = [];
    for (let moduleName of externalModulesClosure) {
        patterns.push({
            from: `./node_modules/${moduleName}`,
            to: `node_modules/${moduleName}`
        });
    }

    return new CopyWebpackPlugin(patterns);
}

function getDependencies(modules) {
    let set = new Set();

    for (let module of modules) {
        set.add(module);
        let depEntry = packageLock.dependencies[module];
        if (!depEntry) {
            throw new Error(`Could not find package-lock entry for ${module}`);
        }

        if (depEntry.requires) {
            let requiredModules = Object.getOwnPropertyNames(depEntry.requires);
            let subdeps = getDependencies(requiredModules);
            for (let subdep of subdeps) {
                set.add(subdep);
            }
        }
    }

    return Array.from(set);
}

if (DEBUG_WEBPACK) {
    console.log('Config:', config);
}

module.exports = config;
