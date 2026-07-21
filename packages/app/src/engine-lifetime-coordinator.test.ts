import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { EngineLifetimeCoordinator } from './engine-lifetime-coordinator';

describe('EngineLifetimeCoordinator', () => {
  it('rejects deferred old-engine completions while accepting the new engine lifetime', async () => {
    const old = new EngineLifetimeCoordinator();
    let resolveOld!: (value: string) => void;
    const apply = vi.fn();
    const oldRead = old.runLatest(
      'info',
      () => new Promise((resolve) => (resolveOld = resolve)),
      apply,
    );
    old.dispose();
    const current = new EngineLifetimeCoordinator();
    await current.runLatest('info', async () => 'current', apply);
    resolveOld('old');
    await oldRead;
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith('current');
  });

  it('lets an event invalidate only its same-engine resource bootstrap', async () => {
    const lifetime = new EngineLifetimeCoordinator();
    const traps = lifetime.begin('traps');
    const modules = lifetime.capture('modules');
    lifetime.invalidate('traps');
    expect(lifetime.owns(traps)).toBe(false);
    expect(lifetime.owns(modules)).toBe(true);

    let resolve!: (value: string) => void;
    const apply = vi.fn();
    const bootstrap = lifetime.runLatest(
      'resolver',
      () => new Promise((done) => (resolve = done)),
      apply,
    );
    lifetime.invalidate('resolver');
    resolve('stale bootstrap');
    await bootstrap;
    expect(apply).not.toHaveBeenCalled();
  });

  it('orders concurrent reads atomically per resource', () => {
    const lifetime = new EngineLifetimeCoordinator();
    const older = lifetime.begin('modules');
    const newer = lifetime.begin('modules');
    expect(lifetime.owns(older)).toBe(false);
    expect(lifetime.owns(newer)).toBe(true);
  });

  it('invalidates pre-cleanup tokens while allowing Strict Mode reactivation', () => {
    const lifetime = new EngineLifetimeCoordinator();
    const firstSetup = lifetime.capture('provider-lifetime');
    lifetime.dispose();
    lifetime.activate();
    const secondSetup = lifetime.capture('provider-lifetime');
    expect(lifetime.owns(firstSetup)).toBe(false);
    expect(lifetime.owns(secondSetup)).toBe(true);
  });

  it('suppresses stale same-engine terminal success and global error continuations', () => {
    const lifetime = new EngineLifetimeCoordinator();
    const terminalAModules = lifetime.begin('modules');
    const terminalAError = lifetime.begin('resolver-terminal-error');
    const terminalBModules = lifetime.begin('modules');
    const terminalBError = lifetime.begin('resolver-terminal-error');
    const writes = vi.fn();
    lifetime.apply(terminalAModules, () => writes('A modules'));
    lifetime.apply(terminalAError, () => writes('A error'));
    lifetime.apply(terminalBModules, () => writes('B modules'));
    lifetime.apply(terminalBError, () => writes('B error'));
    expect(writes.mock.calls).toEqual([['B modules'], ['B error']]);
  });

  it('keeps independent resources applicable when another bootstrap fails or changes', () => {
    const lifetime = new EngineLifetimeCoordinator();
    const profiles = lifetime.capture('agent-profiles');
    const groups = lifetime.capture('agent-groups');
    lifetime.invalidate('agent-profiles');
    const applied = vi.fn();
    lifetime.apply(profiles, () => applied('profiles'));
    lifetime.apply(groups, () => applied('groups'));
    expect(applied).toHaveBeenCalledOnce();
    expect(applied).toHaveBeenCalledWith('groups');
  });

  it('runs independent trap status/list bootstraps and suppresses stale errors', async () => {
    const lifetime = new EngineLifetimeCoordinator();
    const receiver = vi.fn();
    const records = vi.fn();
    const errors = vi.fn();
    await Promise.all([
      lifetime.runLatest('traps', async () => ({ running: true }), receiver, errors),
      lifetime.runLatest('trap-records', async () => ['current'], records, errors),
    ]);
    expect(receiver).toHaveBeenCalledWith({ running: true });
    expect(records).toHaveBeenCalledWith(['current']);

    let rejectOld!: (error: Error) => void;
    const stale = lifetime.runLatest(
      'resolver',
      () => new Promise((_resolve, reject) => (rejectOld = reject)),
      vi.fn(),
      errors,
    );
    lifetime.begin('resolver');
    rejectOld(new Error('old engine failure'));
    await stale;
    expect(errors).not.toHaveBeenCalled();
  });

  it('settles resolver/tools continuations only for their owning lifetime', async () => {
    const lifetime = new EngineLifetimeCoordinator();
    const resolverEvent = lifetime.capture('resolver-event-lifetime');
    const toolsEvent = lifetime.capture('tools-event-lifetime');
    let resolveResolver!: (value: string) => void;
    let resolveTools!: (value: string) => void;
    const applied = vi.fn();
    const resolver = lifetime.settle(
      resolverEvent,
      () => new Promise((resolve) => (resolveResolver = resolve)),
      applied,
    );
    const tools = lifetime.settle(
      toolsEvent,
      () => new Promise((resolve) => (resolveTools = resolve)),
      applied,
    );
    lifetime.dispose();
    resolveResolver('resolver');
    resolveTools('tools');
    await Promise.all([resolver, tools]);
    expect(applied).not.toHaveBeenCalled();
  });

  it('rejects an async event continuation after engine switch and supports Strict Mode setup', async () => {
    const first = new EngineLifetimeCoordinator();
    const continuation = first.capture('resolver-event-lifetime');
    let resolve!: () => void;
    const applied = vi.fn();
    const pending = new Promise<void>((done) => (resolve = done)).then(() =>
      first.apply(continuation, applied),
    );
    first.dispose();
    resolve();
    await pending;
    expect(applied).not.toHaveBeenCalled();

    const strictModeSetup = new EngineLifetimeCoordinator();
    const retry = strictModeSetup.capture('resolver');
    expect(strictModeSetup.owns(retry)).toBe(true);
  });

  it('wires AppRoot bootstraps and async continuations through current lifetime ownership', () => {
    const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
    expect(source).toContain('new EngineEffectHarness(ownsEngine)');
    expect(source).toContain('lifetime.dispose()');
    expect(source).toContain("lifetime.runLatest(\n      'info'");
    expect(source).toContain("const trapStatusToken = lifetime.begin('traps')");
    expect(source).toContain('refreshTrapReceiverStatus(engine, () => ownsToken(trapStatusToken))');
    expect(source).toContain("lifetime.begin('resolver')");
    expect(source).toContain('lifetime.owns(token)');
    expect(source).toContain('notifyTrapRule(notificationAdapter');
    expect(source).toContain('notifyWatchAlert(notificationAdapter');
    expect(source).toContain('ownsToken(eventLifetime)');
    expect(source).toContain('ownsToken(eventToken)');
    expect(source).toContain('.catch(() => undefined)');
    expect(source.indexOf("engine.events.subscribe('resolver'")).toBeLessThan(
      source.indexOf("lifetime.begin('resolver')"),
    );
  });
});
