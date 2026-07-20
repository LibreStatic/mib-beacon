import { describe, expect, it, vi } from 'vitest';
import { createRnSecretStore, secureStoreKey } from './secure-store';

describe('React Native secret store', () => {
  it('maps slash-separated logical references to valid Expo SecureStore keys', async () => {
    const secureStore = {
      setItemAsync: vi.fn(async () => undefined),
      getItemAsync: vi.fn(async () => 'public'),
      deleteItemAsync: vi.fn(async () => undefined),
    };
    const store = createRnSecretStore(secureStore);
    const logicalKey = 'agents/agent-0123456789abcdef/community';
    const nativeKey = secureStoreKey(logicalKey);

    expect(nativeKey).toMatch(/^[\w.-]+$/);
    expect(nativeKey).not.toBe(logicalKey);

    await store.set(logicalKey, 'public');
    await expect(store.get(logicalKey)).resolves.toBe('public');
    await store.delete(logicalKey);

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(nativeKey, 'public');
    expect(secureStore.getItemAsync).toHaveBeenCalledWith(nativeKey);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(nativeKey);
    expect(store.isEncrypted()).toBe(true);
  });

  it('does not collapse distinct logical references onto the same native key', () => {
    expect(secureStoreKey('trap-users/alice/auth-key')).not.toBe(
      secureStoreKey('trap-users-alice-auth-key'),
    );
  });
});
