import type { Theme } from './theme-types';

export type ButtonVisualVariant = 'primary' | 'ghost' | 'danger';

export interface ComponentInteractionState {
  pressed?: boolean;
  focused?: boolean;
  disabled?: boolean;
}

export interface ButtonVisualState {
  background: string;
  foreground: string;
  border: string;
  focusInner: string;
  focusOuter: string;
}

export function resolveButtonVisualState(
  theme: Theme,
  variant: ButtonVisualVariant,
  state: ComponentInteractionState,
): ButtonVisualState {
  if (state.disabled) {
    return {
      background: theme.components.disabled.background,
      foreground: theme.components.disabled.foreground,
      border: theme.components.disabled.border,
      focusInner: 'transparent',
      focusOuter: 'transparent',
    };
  }

  if (variant === 'primary') {
    return {
      background: state.pressed
        ? theme.components.primaryButton.pressedBackground
        : theme.components.primaryButton.background,
      foreground: theme.components.primaryButton.foreground,
      border: 'transparent',
      focusInner: state.focused ? theme.components.primaryButton.focusInner : 'transparent',
      focusOuter: state.focused ? theme.components.primaryButton.focusOuter : 'transparent',
    };
  }

  if (variant === 'danger') {
    return {
      background: state.pressed
        ? theme.components.dangerButton.pressedBackground
        : theme.components.dangerButton.background,
      foreground: state.pressed
        ? theme.components.dangerButton.pressedForeground
        : theme.components.dangerButton.foreground,
      border: theme.components.dangerButton.border,
      focusInner: state.focused
        ? state.pressed
          ? theme.components.dangerButton.pressedFocusInner
          : theme.components.dangerButton.focusInner
        : 'transparent',
      focusOuter: state.focused ? theme.components.primaryButton.focusOuter : 'transparent',
    };
  }

  return {
    background: state.pressed ? theme.components.hover.background : 'transparent',
    foreground: state.pressed ? theme.components.hover.foreground : theme.accent,
    border: state.pressed ? theme.components.hover.border : theme.border,
    focusInner: state.focused
      ? state.pressed
        ? theme.components.hover.focusInner
        : theme.components.primaryButton.focusOuter
      : 'transparent',
    focusOuter: state.focused ? theme.components.primaryButton.focusOuter : 'transparent',
  };
}

export interface ChipVisualState {
  background: string;
  foreground: string;
  border: string;
  focusOuter: string;
}

export function resolveChipVisualState(
  theme: Theme,
  { active, focused }: { active: boolean; focused: boolean },
): ChipVisualState {
  return {
    background: active ? theme.components.selected.background : theme.surfaceAlt,
    foreground: active ? theme.components.selected.foreground : theme.textDim,
    border: active ? theme.components.selected.border : theme.border,
    focusOuter: focused ? theme.components.primaryButton.focusOuter : 'transparent',
  };
}
