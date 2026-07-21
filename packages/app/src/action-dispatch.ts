import type {
  ActionConfirmationAuthorizer,
  ActionPlatform,
  ActionRegistry,
} from './action-registry';

export async function dispatchRegisteredAction(
  registry: ActionRegistry,
  actionId: string,
  platform: ActionPlatform,
  onError: (message: string) => void,
  authorizeConfirmation?: ActionConfirmationAuthorizer,
): Promise<boolean> {
  try {
    await registry.execute(actionId, platform, authorizeConfirmation);
    return true;
  } catch (cause) {
    onError(cause instanceof Error ? cause.message : String(cause));
    return false;
  }
}
