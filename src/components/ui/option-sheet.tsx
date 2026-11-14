import { Check } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/lib/haptics';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

import { Sheet } from './sheet';
import { Text } from './text';

export type Option<T extends string> = { value: T; label: string; detail?: string };

/** Single-choice picker in a bottom sheet. Selecting closes the sheet first, then applies the value. */
export function OptionSheet<T extends string>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Option<T>[];
  value: T;
  onSelect: (v: T) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Sheet visible={visible} onClose={onClose} scroll={false}>
      <View style={[styles.body, { paddingBottom: insets.bottom + space[4] }]}>
        <Text variant="h3" style={styles.title}>
          {title}
        </Text>
        <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {options.map((o) => {
            const active = o.value === value;
            return (
              <Pressable
                key={o.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptic.select();
                  onSelect(o.value);
                  onClose();
                }}
                style={({ pressed }) => [styles.option, active && styles.optionActive, pressed && styles.pressed]}>
                <View style={styles.flex}>
                  <Text variant="bodyStrong">{o.label}</Text>
                  {o.detail ? (
                    <Text variant="label" color={colors.textMuted}>
                      {o.detail}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.radio, active && styles.radioOn]}>
                  {active ? <Check size={15} color={colors.charcoal} strokeWidth={3} /> : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Sheet>
  );
}

const styles = createStyles(() => ({
  body: { paddingHorizontal: gutter, paddingTop: space[2] },
  title: { marginBottom: space[4] },
  list: { gap: space[2] },
  option: {
    minHeight: 60,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  optionActive: { borderColor: colors.ink, borderWidth: 1.5 },
  pressed: { backgroundColor: colors.bg },
  flex: { flex: 1, gap: 2 },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.lime, borderColor: colors.lime },
}));
