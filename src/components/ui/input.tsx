import { Eye, EyeOff, type LucideIcon } from 'lucide-react-native';
import { forwardRef, useState, type ReactNode } from 'react';
import { Platform, TextInput, View, type TextInputInstance, type TextInputProps, type StyleProp, type ViewStyle } from 'react-native';

import { colors, font, radius, size, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

import { PressableScale } from './pressable-scale';
import { Text } from './text';

export type Tone = 'light' | 'dark';

const tones = () => ({
  light: {
    bg: colors.surface,
    border: colors.border,
    focus: colors.ink,
    text: colors.text,
    placeholder: colors.textSubtle,
    label: colors.text,
  },
  dark: {
    bg: colors.inkRaised,
    border: colors.borderOnDark,
    focus: colors.lime,
    text: colors.textOnDark,
    placeholder: '#7D878B',
    label: colors.textOnDark,
  },
});

export type InputProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string;
  tone?: Tone;
  icon?: LucideIcon;
  leading?: ReactNode;
  trailing?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
};

/** Pill-shaped input used everywhere (auth, search, forms). */
export const Input = forwardRef<TextInputInstance, InputProps>(function Input(
  { label, hint, error, tone = 'light', icon: Icon, leading, trailing, containerStyle, style, onFocus, onBlur, ...rest },
  ref,
) {
  const t = tones()[tone];
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <Text variant="labelStrong" color={t.label}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          rest.multiline && styles.fieldMulti,
          { backgroundColor: t.bg, borderColor: error ? (tone === 'dark' ? '#FF8A80' : colors.danger) : focused ? t.focus : t.border },
        ]}>
        {Icon ? <Icon size={size.icon} color={tone === 'dark' ? t.placeholder : colors.textMuted} strokeWidth={2} /> : null}
        {leading}
        <TextInput
          ref={ref}
          placeholderTextColor={t.placeholder}
          selectionColor={tone === 'dark' ? colors.lime : colors.ink}
          cursorColor={tone === 'dark' ? colors.lime : colors.ink}
          maxFontSizeMultiplier={1.3}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, rest.multiline && styles.inputMulti, { color: t.text }, style]}
        />
        {trailing}
      </View>
      {error ? (
        <Text variant="caption" color={tone === 'dark' ? '#FF8A80' : colors.danger}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color={tone === 'dark' ? colors.textOnDarkMuted : colors.textMuted}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

export const PasswordInput = forwardRef<TextInputInstance, InputProps>(function PasswordInput(props, ref) {
  const [visible, setVisible] = useState(false);
  const tone = props.tone ?? 'light';
  const Icon = visible ? EyeOff : Eye;
  return (
    <Input
      ref={ref}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={!visible}
      textContentType="password"
      {...props}
      trailing={
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          hitSlop={10}
          onPress={() => setVisible((v) => !v)}>
          <Icon size={size.icon} color={tone === 'dark' ? colors.textOnDark : colors.ink} strokeWidth={1.8} />
        </PressableScale>
      }
    />
  );
});

/** Bangladesh mobile input. Stores only the 10 national digits (1XXXXXXXXX). */
export const PhoneInput = forwardRef<TextInputInstance, InputProps & { value: string; onChangeText: (v: string) => void }>(
  function PhoneInput({ value, onChangeText, tone = 'light', ...rest }, ref) {
    const t = tones()[tone];
    return (
      <Input
        ref={ref}
        tone={tone}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        inputMode="tel"
        maxLength={10}
        placeholder="1XXXXXXXXX"
        value={value}
        onChangeText={(v) => {
          // Accept pasted "+8801…" / "01…" and keep just the 10 digits.
          let digits = v.replace(/\D/g, '');
          if (digits.startsWith('880')) digits = digits.slice(3);
          if (digits.startsWith('0')) digits = digits.slice(1);
          onChangeText(digits.slice(0, 10));
        }}
        leading={
          <View style={styles.prefix}>
            <View style={styles.flag}>
              <View style={styles.flagDot} />
            </View>
            <Text variant="bodyStrong" color={t.text}>
              +880
            </Text>
            <View style={[styles.prefixDivider, { backgroundColor: t.border }]} />
          </View>
        }
        {...rest}
      />
    );
  },
);

const styles = createStyles(() => ({
  wrap: { gap: space[2] },
  field: {
    height: size.control,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space[5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  // Multi-line (e.g. a review): a taller box, text starts at the top.
  fieldMulti: { height: undefined, minHeight: 120, borderRadius: radius.md, alignItems: 'flex-start', paddingVertical: space[3] },
  inputMulti: { height: undefined, minHeight: 96, textAlignVertical: 'top', paddingTop: 0 },
  input: {
    flex: 1,
    height: '100%',
    fontFamily: font.regular,
    fontSize: 16,
    paddingVertical: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : null),
  },
  prefix: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flag: { width: 26, height: 18, borderRadius: 3, backgroundColor: '#006A4E', alignItems: 'center', justifyContent: 'center' },
  flagDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#F42A41', marginLeft: -2 },
  prefixDivider: { width: 1, height: 26, marginLeft: space[2] },
}));
