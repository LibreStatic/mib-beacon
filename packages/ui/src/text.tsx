import { Text as RNText, type TextProps } from 'react-native';
import { useTheme } from './theme';
import { textToneColor, type TextTone } from './text-tone';

export type { TextTone } from './text-tone';

/**
 * Drop-in replacement for react-native `Text` that applies the theme text
 * color and the shared dynamic-type cap by default. A true drop-in: it spreads
 * every other prop, and an explicit `style.color` still wins over the default.
 */
export function Text({
  tone,
  style,
  maxFontSizeMultiplier = 1.3,
  ...rest
}: TextProps & { tone?: TextTone }) {
  const t = useTheme();
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[{ color: textToneColor(tone, t) }, style]}
    />
  );
}
