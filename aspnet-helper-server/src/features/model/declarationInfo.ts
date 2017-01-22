import {
    CompletionItem, CompletionItemKind,
    Files, Hover,
    MarkedString,
    Position, Range, 
    TextDocument, TextEdit
} from 'vscode-languageserver';
import Uri from 'vscode-uri';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

import { 
    ActionResult, Property, GetParts 
} from '../parsingResults';

export default class ModelDeclarationInfo {

    private _document: TextDocument
    private _rootDir: string;
    private _position: Position;
    public input: string;
    
    constructor(position: Position, document: TextDocument, workspaceRoot: string) {
        this._document = document;
        this._position = position;
        this.getRootPath();
        this.setInput();
    }

    private setInput() {
        let lines = this._document.getText().split(/\r?\n/g);
        this.input = lines[this._position.line].substr(0, this._position.character);
    }

    private getCurrentLine(): string {
        let lines = this._document.getText().split(/\r?\n/g);
        return lines[this._position.line];
    }

    public getWordAtPosition() {
        let left = this.input.slice(0, this._position.character + 1).search(/\S+$/);
        let right = this.input.slice(this._position.character).search(/\s/);
        let line = this.getCurrentLine();
        if (right < 0) return line.slice(left);
        return line.slice(left, right + this._position.character);
    }

    private getRootPath() {
        let currentDir = Files.uriToFilePath(this._document.uri);

        while (currentDir !== this._rootDir) {
            currentDir = path.dirname(currentDir);
            fs.readdirSync(currentDir).forEach(f => {
                if (f.includes('project.json') || f.includes('csproj')) {
                    this._rootDir = currentDir;
                    return;
                } 
            });
        }
    }

    public userWantsProperties(): boolean {
        let userRegExp = /.*@Model\.?$/;
        if (userRegExp.test(this.input)) return true;
        return false
    }

    public userWantsSingleProperty(): boolean {
        let userRegExp = /.*@Model\.[a-zA-Z]*$/;
        if (userRegExp.test(this.input)) return true;
        return false
    }

    public getCurrentModel(): string {
        let firstLine = this._document.getText().split(/\r?\n/g)[0];
        let modelRegExp = /.?model\s(.*)$/
        let model = GetParts(firstLine, modelRegExp);
        if (model) return model[1];
        return '';
    }

    public getNamespaces(): string[] {

        let files = this.getViewImportsFiles();
        let namespaces = this.getNamespacesFromFiles(files);
        return namespaces
    }

    private getViewImportsFiles(): string[] {
        let currentDir = Files.uriToFilePath(this._document.uri);
        let files: string[] = [];

        while (currentDir !== this._rootDir) {
            currentDir = path.dirname(currentDir);
            fs.readdirSync(currentDir).forEach(f => {
                if (f.includes('_ViewImports.cshtml')) files.push(currentDir + path.sep + f);
            });
        }

        return files;
    }

    private getNamespacesFromFiles(files: string[]): string[] {
        let namespaces: string[] = [];
        let namespaceRegExp = /@using\s(.*)/;
        files.forEach(f => {
            let text = fs.readFileSync(f, 'utf8');
            let results = text.match(namespaceRegExp);
            results.forEach(r => { 
                let namespace = GetParts(r, new RegExp(namespaceRegExp.source));
                if (namespace) namespaces.push(namespace[1]);
            })
        });
        return namespaces;
    }

    public getProperties(model: string, namespaces: string[]): Property[] {
        let matchingFiles: string[] = this.getMatchingFiles(model, namespaces);
        
        if (!matchingFiles) return new Array<Property>()

        let text = fs.readFileSync(matchingFiles[0], 'utf8');
        let propRegExp = /public\s([a-zA-Z]*<?[a-zA-Z]+>?)\s([a-zA-Z]+)/g;
        let fullProps = text.match(propRegExp);
        
        if (!fullProps) return new Array<Property>();
        
        fullProps = fullProps.filter(f => !f.includes('class'));
        let items = new Array<Property>();
        fullProps.forEach(p => {
            let results = GetParts(p, new RegExp(propRegExp.source));
            let item = new Property();
            item.type = results[1];
            item.name = results[2];
            items.push(item);
        });
        return items;
    }

    public convertPropertiesToCompletionItems(properties: Property[]): CompletionItem[] {
        let items = new Array<CompletionItem>();
        properties.forEach(p => { 
            let item = CompletionItem.create(p.name);
            item.kind = CompletionItemKind.Property;
            item.detail = p.type;
            items.push(item);
        });
        return items;
    }

    public convertPropertiesToHoverResult(property:Property): Hover {
        let text = property.type + ' ' + property.name;
        let markedString: MarkedString;
        markedString = {
            language: 'csharp',
            value: text
        };
        let hover: Hover;
        hover = {
            contents: markedString
        };
        return hover;
    }

    private getMatchingFiles(model: string, namespaces: string[]): string[] {
        let modelsPattern = this._rootDir + path.sep + '**' + path.sep + 'Models' + path.sep + '**' + path.sep + '*.cs';
        let viewModelsPattern = this._rootDir + path.sep + '**' + path.sep + 'ViewModels' + path.sep + '**' + path.sep + '*.cs';
        let files = glob.sync(modelsPattern).concat(glob.sync(viewModelsPattern));
        let matchingFiles: string[] = [];
        namespaces.forEach(n => {
            files.forEach(f => {
                if (this.isMatchingFile(model, n, f)) matchingFiles.push(f); 
            });
        });
        return matchingFiles;
    }

    private isMatchingFile(model: string, namespace: string, file: string): string {
        let text = fs.readFileSync(file, 'utf8');
        let namespaceRegExp = new RegExp('namespace\\s' + namespace);
        let classNameRegExp = new RegExp('class\\s' + model);

        if (namespaceRegExp.test(text) && classNameRegExp.test(text)) return file;

        return '';
    }

}