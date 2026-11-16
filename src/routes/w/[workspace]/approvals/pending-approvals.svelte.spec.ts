import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { PendingApprovalRow } from '#lib/server/executions/types.ts';
import PendingApprovals from './pending-approvals-harness.test.svelte';

const row = (over: Partial<PendingApprovalRow> = {}): PendingApprovalRow => ({
	approvalId: '0b6c1f0e-1d9a-4d55-9d0e-3f1a2b3c4d5e',
	executionId: 'e1',
	toolPath: 'github.createIssue',
	connectorName: 'GitHub',
	connectorIcon: null,
	argumentsPreview: '{ "title": "Bug" }',
	client: 'Claude Code (claude-code 2.1.3)',
	createdAt: new Date(Date.now() - 60_000),
	expiresAt: new Date(Date.now() + 29 * 60_000),
	...over
});

describe('PendingApprovals', () => {
	it('lists tool, connector, arguments and client, and links to the approval page', async () => {
		render(PendingApprovals, { rows: [row()] });
		await expect.element(page.getByText('github.createIssue')).toBeInTheDocument();
		await expect.element(page.getByText('GitHub').first()).toBeInTheDocument();
		await expect.element(page.getByText('{ "title": "Bug" }')).toBeInTheDocument();
		await expect.element(page.getByText('Claude Code (claude-code 2.1.3)')).toBeInTheDocument();
		const link = page.getByRole('link', { name: 'Review the call to github.createIssue' });
		await expect
			.element(link)
			.toHaveAttribute('href', '/approve/0b6c1f0e-1d9a-4d55-9d0e-3f1a2b3c4d5e');
		// Deciding happens only on the approval page: no approve or reject button here
		await expect
			.element(page.getByRole('button', { name: /approve|reject/i }))
			.not.toBeInTheDocument();
	});

	it('shows an empty state when nothing waits', async () => {
		render(PendingApprovals, { rows: [] });
		await expect.element(page.getByText('Nothing to approve')).toBeInTheDocument();
	});
});
