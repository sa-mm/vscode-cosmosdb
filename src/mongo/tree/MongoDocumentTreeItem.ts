/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Collection, DeleteWriteOpResultObject, ObjectID, UpdateWriteOpResult } from 'mongodb';
import * as path from 'path';
import * as _ from 'underscore';
import * as vscode from 'vscode';
import { AzureTreeItem, DialogResponses, UserCancelledError } from 'vscode-azureextensionui';
import { resourcesPath } from '../../constants';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { IMongoTreeRoot } from './IMongoTreeRoot';
import { MongoCollectionTreeItem } from './MongoCollectionTreeItem';

export interface IMongoDocument {
    _id: string | ObjectID;

    // custom properties
    // tslint:disable-next-line:no-any
    [key: string]: any;
}

export class MongoDocumentTreeItem extends AzureTreeItem<IMongoTreeRoot> {
    public static contextValue: string = "MongoDocument";
    public readonly contextValue: string = MongoDocumentTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openDocument';
    public document: IMongoDocument;
    public readonly parent: MongoCollectionTreeItem;

    private _label;

    constructor(parent: MongoCollectionTreeItem, document: IMongoDocument) {
        super(parent);
        this.document = document;
        this._label = getDocumentTreeItemLabel(this.document);
    }

    get id(): string {
        // tslint:disable-next-line:no-non-null-assertion
        return String(this.document!._id);
    }

    public async refreshLabelImpl(): Promise<void> {
        this._label = getDocumentTreeItemLabel(this.document);
    }

    get label(): string {
        return this._label;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(resourcesPath, 'icons', 'theme-agnostic', 'Document.svg'),
            dark: path.join(resourcesPath, 'icons', 'theme-agnostic', 'Document.svg')
        };
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const message: string = `Are you sure you want to delete document '${this._label}'?`;
        const dialogResult = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (dialogResult === DialogResponses.deleteResponse) {
            const deleteResult: DeleteWriteOpResultObject = await this.parent.collection.deleteOne({ "_id": this.document._id });
            if (deleteResult.deletedCount !== 1) {
                throw new Error(`Failed to delete document with _id '${this.document._id}'.`);
            }
        } else {
            throw new UserCancelledError();
        }
    }

    public async update(newDocument: IMongoDocument): Promise<IMongoDocument> {
        this.document = await MongoDocumentTreeItem.update(this.parent.collection, newDocument);
        return this.document;
    }

    public static async update(collection: Collection, newDocument: IMongoDocument): Promise<IMongoDocument> {
        if (!newDocument["_id"]) {
            throw new Error(`The "_id" field is required to update a document.`);
        }
        const filter: object = { _id: newDocument._id };
        const result: UpdateWriteOpResult = await collection.updateOne(filter, _.omit(newDocument, '_id'));
        if (result.modifiedCount !== 1) {
            throw new Error(`Failed to update document with _id '${newDocument._id}'.`);
        }
        return newDocument;
    }
}
