import { toast } from 'svelte-sonner';
import { remoteErrorMessage } from './remote-errors.ts';

/**
 * Awaits a remote call and turns a failure into an error toast, so handlers stay one line:
 * `<Button onclick={() => attempt(deleteItem(id))}>`. Resolves to whether it succeeded, which
 * is what `ConfirmDialog` and `FormDialog` expect to decide whether to close.
 */
export async function attempt(action: Promise<unknown>, success?: string): Promise<boolean> {
	try {
		await action;
		if (success) toast.success(success);
		return true;
	} catch (error) {
		toast.error(remoteErrorMessage(error));
		return false;
	}
}
