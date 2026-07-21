export type ActionPlatform = 'web' | 'desktop' | 'native';

export type ActionEnabledState =
  | { value: true; reason?: never }
  | { value: false; reason: string };

export interface AppAction {
  id: string;
  label: string;
  group: string;
  glyph: string;
  keywords: readonly string[];
  keyboard: {
    suitable: boolean;
    shortcutIds?: readonly string[];
  };
  palette: { exposed: boolean };
  enabled: ActionEnabledState;
  confirmation:
    | { kind: 'none' }
    | {
        kind: 'destructive' | 'remote';
        title: string;
        description?: string;
      };
  platforms: readonly ActionPlatform[];
  execute(): void | boolean | Promise<void | boolean>;
}

export interface ActionShortcutBinding {
  shortcutId: string;
  actionId: string;
}

export type ActionConfirmationAuthorizer = (
  action: AppAction,
) => boolean | Promise<boolean>;

export class ActionUnavailableError extends Error {
  constructor(
    readonly actionId: string,
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'ActionUnavailableError';
  }
}

export class ActionConfirmationRequiredError extends Error {
  constructor(readonly actionId: string) {
    super(`Action ${actionId} requires explicit confirmation.`);
    this.name = 'ActionConfirmationRequiredError';
  }
}

export class ActionRegistrationChangedError extends Error {
  constructor(readonly actionId: string) {
    super(`Action ${actionId} changed while confirmation was pending.`);
    this.name = 'ActionRegistrationChangedError';
  }
}

interface RegisteredAction {
  action: AppAction;
  owner: symbol;
  generation: symbol;
}

export class ActionRegistry {
  private actions = new Map<string, RegisteredAction>();
  private readonly listeners = new Set<() => void>();
  private currentSnapshot: readonly AppAction[] = [];

  register(action: AppAction): () => void {
    return this.replaceMany(Symbol(action.id), [action]);
  }

  replaceMany(owner: symbol, actions: readonly AppAction[]): () => void {
    const ids = new Set<string>();
    for (const action of actions) {
      validateAction(action);
      if (ids.has(action.id)) throw new Error(`Duplicate action ID: ${action.id}`);
      ids.add(action.id);
      const existing = this.actions.get(action.id);
      if (existing && existing.owner !== owner) {
        throw new Error(`Duplicate action ID: ${action.id}`);
      }
    }
    const generation = Symbol(owner.description);
    const next = new Map(
      [...this.actions].filter(([, entry]) => entry.owner !== owner),
    );
    for (const action of actions) next.set(action.id, { action, owner, generation });
    this.actions = next;
    this.refreshSnapshot();
    this.emit();
    return () => {
      if (![...this.actions.values()].some((entry) => entry.generation === generation)) return;
      this.actions = new Map(
        [...this.actions].filter(([, entry]) => entry.generation !== generation),
      );
      this.refreshSnapshot();
      this.emit();
    };
  }

  get(id: string): AppAction | undefined {
    return this.actions.get(id)?.action;
  }

  snapshot(): readonly AppAction[] {
    return this.currentSnapshot;
  }

  paletteActions(platform: ActionPlatform): AppAction[] {
    return this.snapshot().filter(
      ({ palette, platforms }) => palette.exposed && platforms.includes(platform),
    );
  }

  async execute(
    id: string,
    platform: ActionPlatform,
    authorizeConfirmation?: ActionConfirmationAuthorizer,
  ): Promise<void | boolean> {
    const registration = this.actions.get(id);
    const action = registration?.action;
    if (!registration || !action || !action.platforms.includes(platform)) {
      throw new ActionUnavailableError(id, 'This action is not available on this platform.');
    }
    if (!action.enabled.value) {
      throw new ActionUnavailableError(id, action.enabled.reason);
    }
    if (action.confirmation.kind !== 'none') {
      const execute = action.execute;
      const confirmation = { ...action.confirmation };
      const authorized = await authorizeConfirmation?.(action);
      if (!authorized) throw new ActionConfirmationRequiredError(id);
      const current = this.actions.get(id);
      if (
        current !== registration ||
        current.action.execute !== execute ||
        !sameConfirmation(current.action.confirmation, confirmation)
      ) {
        throw new ActionRegistrationChangedError(id);
      }
      if (!current.action.platforms.includes(platform)) {
        throw new ActionUnavailableError(id, 'This action is not available on this platform.');
      }
      if (!current.action.enabled.value) {
        throw new ActionUnavailableError(id, current.action.enabled.reason);
      }
      return current.action.execute();
    }
    return action.execute();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private refreshSnapshot(): void {
    this.currentSnapshot = [...this.actions.values()].map(({ action }) => action);
  }
}

function sameConfirmation(
  current: AppAction['confirmation'],
  authorized: AppAction['confirmation'],
): boolean {
  if (current.kind !== authorized.kind) return false;
  if (current.kind === 'none' || authorized.kind === 'none') return true;
  return current.title === authorized.title && current.description === authorized.description;
}

function validateAction(action: AppAction): void {
  const enabled = action.enabled as { value?: unknown; reason?: unknown };
  if (enabled.value === false) {
    if (typeof enabled.reason !== 'string' || !enabled.reason.trim()) {
      throw new Error(`Disabled action ${action.id} requires a nonblank reason.`);
    }
  } else if (enabled.value === true) {
    if (enabled.reason !== undefined) {
      throw new Error(`Enabled action ${action.id} must not have a reason.`);
    }
  } else {
    throw new Error(`Action ${action.id} has an invalid enabled state.`);
  }
}

export function resolveActionPlatform(
  platformOs: string,
  hasDesktopHost: boolean,
): ActionPlatform {
  return platformOs === 'web' ? (hasDesktopHost ? 'desktop' : 'web') : 'native';
}

export function assertActionExposureInvariants(
  actions: readonly AppAction[],
  bindings: readonly ActionShortcutBinding[],
): void {
  const byId = new Map<string, AppAction>();
  for (const action of actions) {
    if (byId.has(action.id)) throw new Error(`Duplicate action ID: ${action.id}`);
    byId.set(action.id, action);
    if (action.keyboard.suitable && !action.palette.exposed) {
      throw new Error(`Keyboard-suitable action ${action.id} must be palette-exposed.`);
    }
    const declared = action.keyboard.shortcutIds ?? [];
    if (new Set(declared).size !== declared.length) {
      throw new Error(`Duplicate shortcut declaration on action ${action.id}.`);
    }
  }
  const bindingByShortcut = new Map<string, ActionShortcutBinding>();
  for (const binding of bindings) {
    if (bindingByShortcut.has(binding.shortcutId)) {
      throw new Error(`Duplicate shortcut binding: ${binding.shortcutId}.`);
    }
    bindingByShortcut.set(binding.shortcutId, binding);
    const action = byId.get(binding.actionId);
    if (!action) throw new Error(`Shortcut ${binding.shortcutId} targets an unknown action.`);
    if (!action.palette.exposed) {
      throw new Error(`Shortcut ${binding.shortcutId} action must be palette-exposed.`);
    }
    if (!action.keyboard.suitable) {
      throw new Error(`Shortcut ${binding.shortcutId} action must be keyboard-suitable.`);
    }
    if (!action.keyboard.shortcutIds?.includes(binding.shortcutId)) {
      throw new Error(
        `Shortcut ${binding.shortcutId} binding does not match action ${binding.actionId}.`,
      );
    }
  }
  for (const action of actions) {
    for (const shortcutId of action.keyboard.shortcutIds ?? []) {
      const binding = bindingByShortcut.get(shortcutId);
      if (!binding) {
        throw new Error(`Action ${action.id} declared shortcut ${shortcutId} with no matching binding.`);
      }
      if (binding.actionId !== action.id) {
        throw new Error(`Shortcut ${shortcutId} binding does not match action ${action.id}.`);
      }
    }
  }
}
