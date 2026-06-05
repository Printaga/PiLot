import * as vscode from 'vscode';
import { PiAgentProvider } from './pi-agent-provider.js';

export class SessionsTreeProvider implements vscode.TreeDataProvider<SessionNodeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private provider: PiAgentProvider) {
		provider.onDidChangeTreeData(() => this.refresh());
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: SessionNodeItem): vscode.TreeItem {
		const item = new vscode.TreeItem(
			element.label,
			element.children.length > 0
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.None
		);

		item.id = element.id;
		item.description = element.description;
		item.iconPath = element.isActive
			? new vscode.ThemeIcon('hubot')
			: new vscode.ThemeIcon('circle-outline');
		item.contextValue = 'session';
		item.command = {
			command: 'pi-agent.openPanel',
			title: 'Open Session',
			arguments: [element.id]
		};

		return item;
	}

	async getChildren(element?: SessionNodeItem): Promise<SessionNodeItem[]> {
		if (!element) {
			const tree = await this.provider.listSessions();
			return tree.map((node) => this.mapNode(node));
		}

		return element.children;
	}

	private mapNode(node: { id: string; label: string; timestamp: number }): SessionNodeItem {
		return {
			id: node.id,
			label: node.label,
			description: this.formatTimestamp(node.timestamp),
			children: [],
			isActive: false,
			timestamp: node.timestamp,
			parent: null
		};
	}

	private formatTimestamp(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleString();
	}
}

export interface SessionNodeItem {
	id: string;
	label: string;
	description: string;
	children: SessionNodeItem[];
	isActive: boolean;
	timestamp: number;
	parent: string | null;
}
