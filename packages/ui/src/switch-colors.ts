import type { Theme } from './theme-types';
import { colorContrast, opaqueColor, relativeLuminance } from './vscode-theme';

export interface SwitchColors {
  track: string;
  thumb: string;
  outline: string;
}

function mix(color: string, target: 0 | 255, amount: number): string {
  const value = color.slice(1, 7);
  const channels = [0, 2, 4].map((offset) =>
    Math.round(
      Number.parseInt(value.slice(offset, offset + 2), 16) * (1 - amount) + target * amount,
    ),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function isCompatibleTrack(track: string, surface: string): boolean {
  return colorContrast(track, surface) >= 3 && colorContrast('#ffffff', track) >= 3;
}

function visibleTrack(candidate: string, surface: string): string {
  if (isCompatibleTrack(candidate, surface)) return candidate;
  for (let step = 1; step <= 20; step += 1) {
    const amount = step / 20;
    const adjusted = [mix(candidate, 0, amount), mix(candidate, 255, amount)].filter((track) =>
      isCompatibleTrack(track, surface),
    );
    if (adjusted.length) {
      return adjusted.sort((left, right) => relativeLuminance(right) - relativeLuminance(left))[0]!;
    }
  }
  const grayscale = Array.from({ length: 256 }, (_, channel) => {
    const value = channel.toString(16).padStart(2, '0');
    return `#${value}${value}${value}`;
  }).filter((track) => isCompatibleTrack(track, surface));
  if (grayscale.length) {
    return grayscale.sort((left, right) => relativeLuminance(right) - relativeLuminance(left))[0]!;
  }
  if (colorContrast('#ffffff', candidate) >= 3) return candidate;
  for (let step = 1; step <= 20; step += 1) {
    const amount = step / 20;
    const adjusted = [mix(candidate, 0, amount), mix(candidate, 255, amount)].filter(
      (track) => colorContrast('#ffffff', track) >= 3,
    );
    if (adjusted.length) {
      return adjusted.sort((left, right) => relativeLuminance(right) - relativeLuminance(left))[0]!;
    }
  }
  return '#767676';
}

function chroma(color: string): number {
  const value = color.slice(1, 7);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  return Math.max(...channels) - Math.min(...channels);
}

export function resolveSwitchColors(theme: Theme, value: boolean): SwitchColors {
  const surface = opaqueColor(theme.surface, theme.scheme === 'dark' ? '#000000' : '#ffffff');
  const accent = opaqueColor(theme.accent, surface);
  const brightInteractiveCandidates = [theme.focus, ...theme.chart.series]
    .map((color) => opaqueColor(color, surface))
    .filter((color) => chroma(color) >= 24);
  const candidate = value
    ? chroma(accent) >= 24
      ? accent
      : (brightInteractiveCandidates[0] ?? accent)
    : opaqueColor(theme.textDim, surface);
  const track = visibleTrack(candidate, surface);
  const thumb = '#ffffff';
  const outline =
    colorContrast(track, surface) >= 3
      ? track
      : ['#000000', '#ffffff'].sort(
          (left, right) => colorContrast(right, surface) - colorContrast(left, surface),
        )[0]!;
  // The thumb remains the brighter moving affordance in both schemes.
  if (relativeLuminance(thumb) <= relativeLuminance(track)) {
    return { track: '#767676', thumb, outline };
  }
  return { track, thumb, outline };
}
