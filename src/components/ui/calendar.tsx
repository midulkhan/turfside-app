import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, SlideInLeft, SlideInRight, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptic } from '@/lib/haptics';
import { dayOfWeekIndex, dhakaToday, formatDay, type DayKey } from '@/lib/time';
import { colors, radius, shadow, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

import { Button } from './button';
import { Text } from './text';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Mode = 'single' | 'multiple';

export type CalendarProps = {
  mode?: Mode;
  value: DayKey[];
  onChange: (days: DayKey[]) => void;
  min?: DayKey;
  max?: DayKey;
  /** Max number of days in multiple mode. */
  limit?: number;
};

const ym = (d: DayKey) => d.slice(0, 7);
function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}
function daysIn(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Pure-JS month calendar (identical on iOS, Android and web).
 * Supports single and multiple selection; swipe or use the arrows to change month.
 */
export function Calendar({ mode = 'single', value, onChange, min, max, limit = 31 }: CalendarProps) {
  const today = dhakaToday();
  const [month, setMonth] = useState(ym(value[0] ?? today));
  const [dir, setDir] = useState<1 | -1>(1);
  const canPrev = !min || shiftMonth(month, -1) >= ym(min);
  const canNext = !max || shiftMonth(month, 1) <= ym(max);

  const go = (by: 1 | -1) => {
    if ((by < 0 && !canPrev) || (by > 0 && !canNext)) return;
    haptic.select();
    setDir(by);
    setMonth((m) => shiftMonth(m, by));
  };

  const cells = useMemo(() => {
    const lead = dayOfWeekIndex(`${month}-01`);
    const n = daysIn(month);
    const out: (DayKey | null)[] = Array.from({ length: lead }, () => null);
    for (let i = 1; i <= n; i++) out.push(`${month}-${String(i).padStart(2, '0')}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);

  const selected = useMemo(() => new Set(value), [value]);

  const toggle = (d: DayKey) => {
    haptic.select();
    if (mode === 'single') return onChange([d]);
    if (selected.has(d)) return onChange(value.filter((x) => x !== d));
    if (value.length >= limit) return;
    onChange([...value, d].sort());
  };

  const swipe = usePanGesture({
    activeOffsetX: [-18, 18],
    failOffsetY: [-14, 14],
    onDeactivate: (e) => {
      'worklet';
      if (e.translationX < -40) scheduleOnRN(go, 1);
      else if (e.translationX > 40) scheduleOnRN(go, -1);
    },
  });

  const [y, m] = month.split('-').map(Number);

  return (
    <View>
      <View style={styles.head}>
        <Text variant="title">
          {MONTHS[m - 1]}{' '}
          <Text variant="title" color={colors.textMuted}>
            {y}
          </Text>
        </Text>
        <View style={styles.nav}>
          <NavButton icon="prev" disabled={!canPrev} onPress={() => go(-1)} />
          <NavButton icon="next" disabled={!canNext} onPress={() => go(1)} />
        </View>
      </View>

      <View style={styles.week}>
        {WEEKDAYS.map((w) => (
          <Text key={w} variant="caption" color={colors.textSubtle} align="center" style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>

      <GestureDetector gesture={swipe}>
        <Animated.View
          key={month}
          entering={(dir > 0 ? SlideInRight : SlideInLeft).duration(240).easing(Easing.out(Easing.cubic))}
          style={styles.grid}>
          {cells.map((d, i) => {
            if (!d) return <View key={`b${i}`} style={styles.cell} />;
            const disabled = (!!min && d < min) || (!!max && d > max);
            const on = selected.has(d);
            const isToday = d === today;
            return (
              <View key={d} style={styles.cell}>
                <Pressable
                  disabled={disabled}
                  onPress={() => toggle(d)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled }}
                  accessibilityLabel={formatDay(d)}
                  style={({ pressed }) => [
                    styles.day,
                    isToday && !on && styles.today,
                    on && styles.dayOn,
                    pressed && !on && styles.pressed,
                  ]}>
                  <Text
                    variant={on || isToday ? 'labelStrong' : 'label'}
                    color={disabled ? colors.borderStrong : on ? colors.charcoal : colors.text}>
                    {Number(d.slice(8))}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function NavButton({ icon, disabled, onPress }: { icon: 'prev' | 'next'; disabled: boolean; onPress: () => void }) {
  const Icon = icon === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={icon === 'prev' ? 'Previous month' : 'Next month'}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.navBtn, pressed && styles.pressed, disabled && styles.navOff]}>
      <Icon size={18} color={colors.ink} strokeWidth={2.2} />
    </Pressable>
  );
}

/** Centered calendar popup with Cancel / Done. Animates with a soft scale + fade. */
export function CalendarModal({
  visible,
  title = 'Select date',
  mode = 'single',
  value,
  min,
  max,
  limit,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title?: string;
  mode?: Mode;
  value: DayKey[];
  min?: DayKey;
  max?: DayKey;
  limit?: number;
  onConfirm: (days: DayKey[]) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(visible);
  const [prevVisible, setPrevVisible] = useState(visible);
  const [draft, setDraft] = useState<DayKey[]>(value);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setMounted(true);
      setDraft(value);
    }
  }

  const p = useSharedValue(0);
  useEffect(() => {
    if (!mounted) return;
    if (visible) p.set(withTiming(1, { duration: 260, easing: Easing.bezier(0.22, 1, 0.36, 1) }));
    else
      p.set(
        withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }, (done) => {
          if (done) scheduleOnRN(setMounted, false);
        }),
      );
  }, [visible, mounted, p]);

  const scrim = useAnimatedStyle(() => ({ opacity: p.get() }));
  const card = useAnimatedStyle(() => ({
    opacity: p.get(),
    transform: [{ scale: 0.94 + p.get() * 0.06 }, { translateY: (1 - p.get()) * 12 }],
  }));

  if (!mounted) return null;

  const summary =
    mode === 'single'
      ? draft[0]
        ? formatDay(draft[0], { year: false })
        : 'No date selected'
      : draft.length
        ? `${draft.length} date${draft.length > 1 ? 's' : ''} selected`
        : 'Pick one or more dates';

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close calendar" />
        </Animated.View>
        <Animated.View style={[styles.card, shadow.float, card]} accessibilityViewIsModal>
          <Text variant="overline" color={colors.textMuted}>
            {title.toUpperCase()}
          </Text>
          <Calendar mode={mode} value={draft} onChange={setDraft} min={min} max={max} limit={limit} />
          <View style={styles.footer}>
            <Animated.View key={summary} entering={FadeIn.duration(160)} style={styles.flex}>
              <Text variant="labelStrong" numberOfLines={1}>
                {summary}
              </Text>
            </Animated.View>
            <Button label="Cancel" variant="ghost" small onPress={onClose} />
            <Button
              label="Done"
              variant="dark"
              small
              disabled={!draft.length}
              onPress={() => {
                onConfirm(draft);
                onClose();
              }}
            />
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const CELL = 44;
const styles = createStyles(() => ({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[5] },
  scrim: { backgroundColor: colors.scrim },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radius.xl, padding: space[5], gap: space[3] },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nav: { flexDirection: 'row', gap: space[2] },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navOff: { opacity: 0.35 },
  week: { flexDirection: 'row', marginTop: space[3] },
  weekday: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space[1] },
  cell: { width: `${100 / 7}%`, height: CELL + 4, alignItems: 'center', justifyContent: 'center' },
  day: { width: CELL, height: CELL, borderRadius: CELL / 2, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1.5, borderColor: colors.ink },
  dayOn: { backgroundColor: colors.lime },
  pressed: { backgroundColor: colors.bg },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[2],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
}));
