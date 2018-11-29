/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccount } from 'azure-arm-cosmosdb/lib/models';
import { Db } from 'mongodb';
import * as path from 'path';
import * as vscode from 'vscode';
import { appendExtensionUserAgent, AzureParentTreeItem, AzureTreeItem, parseError } from 'vscode-azureextensionui';
import { deleteCosmosDBAccount } from '../../commands/deleteCosmosDBAccount';
import { resourcesPath } from '../../constants';
import { ext } from '../../extensionVariables';
import { connectToMongoClient } from '../connectToMongoClient';
import { getDatabaseNameFromConnectionString } from '../mongoConnectionStrings';
import { IMongoTreeRoot } from './IMongoTreeRoot';
import { MongoCollectionTreeItem } from './MongoCollectionTreeItem';
import { MongoDatabaseTreeItem } from './MongoDatabaseTreeItem';
import { MongoDocumentTreeItem } from './MongoDocumentTreeItem';

export class MongoAccountTreeItem extends AzureParentTreeItem<IMongoTreeRoot> {
    public static contextValue: string = "cosmosDBMongoServer";
    public readonly contextValue: string = MongoAccountTreeItem.contextValue;
    public readonly childTypeLabel: string = "Database";
    public readonly id: string;
    public readonly label: string;
    public readonly connectionString: string;

    private _root: IMongoTreeRoot;

    constructor(parent: AzureParentTreeItem, id: string, label: string, connectionString: string, isEmulator: boolean, readonly databaseAccount?: DatabaseAccount) {
        super(parent);
        this.id = id;
        this.label = label;
        this.connectionString = connectionString;
        this._root = Object.assign({}, parent.root, { isEmulator });
    }

    // overrides ISubscriptionRoot with an object that also has Mongo info
    public get root(): IMongoTreeRoot {
        return this._root;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(resourcesPath, 'icons', 'light', 'CosmosDBAccount.svg'),
            dark: path.join(resourcesPath, 'icons', 'dark', 'CosmosDBAccount.svg')
        };
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem<IMongoTreeRoot>[]> {
        let db: Db | undefined;
        try {
            let databases: IDatabaseInfo[];

            if (!this.connectionString) {
                throw new Error('Missing connection string');
            }

            db = await connectToMongoClient(this.connectionString, appendExtensionUserAgent());
            let databaseInConnectionString = getDatabaseNameFromConnectionString(this.connectionString);
            if (databaseInConnectionString && !this.root.isEmulator) { // emulator violates the connection string format
                // If the database is in the connection string, that's all we connect to (we might not even have permissions to list databases)
                databases = [{
                    name: databaseInConnectionString,
                    empty: false
                }];
            } else {
                let result: { databases: IDatabaseInfo[] } = await db.admin().listDatabases();
                databases = result.databases;
            }
            return databases
                .filter((database: IDatabaseInfo) => !(database.name && database.name.toLowerCase() === "admin" && database.empty)) // Filter out the 'admin' database if it's empty
                .map(database => new MongoDatabaseTreeItem(this, database.name, this.connectionString));
        } catch (error) {
            let message = parseError(error).message;
            if (this._root.isEmulator && message.includes("ECONNREFUSED")) {
                error.message = "Unable to reach emulator. Please ensure it is started and writing to the appropriate port. Then try again.\n" + message;
            }
            throw error;
        }
        finally {
            if (db) {
                db.close();
            }
        }
    }

    public async createChildImpl(showCreatingTreeItem: (label: string) => void): Promise<MongoDatabaseTreeItem> {
        const databaseName = await ext.ui.showInputBox({
            placeHolder: "Database Name",
            prompt: "Enter the name of the database",
            validateInput: validateDatabaseName
        });
        showCreatingTreeItem(databaseName);

        const databaseTreeItem = new MongoDatabaseTreeItem(this, databaseName, this.connectionString);
        return databaseTreeItem;
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        switch (contextValue) {
            case MongoDatabaseTreeItem.contextValue:
            case MongoCollectionTreeItem.contextValue:
            case MongoDocumentTreeItem.contextValue:
                return true;
            default:
                return false;
        }
    }

    public async deleteTreeItemImpl(): Promise<void> {
        await deleteCosmosDBAccount(this);
    }
}

function validateDatabaseName(database: string): string | undefined | null {
    // https://docs.mongodb.com/manual/reference/limits/#naming-restrictions
    const min = 1;
    const max = 63;
    if (!database || database.length < min || database.length > max) {
        return `Database name must be between ${min} and ${max} characters.`;
    }
    if (/[/\\. "$]/.test(database)) {
        return "Database name cannot contain these characters - `/\\. \"$`";
    }
    return undefined;
}

interface IDatabaseInfo {
    name?: string;
    empty?: boolean;
}
