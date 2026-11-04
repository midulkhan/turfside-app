import { router } from 'expo-router';
import { CalendarClock, ClipboardList, ScanLine } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/headers';
import { Text } from '@/components/ui/text';
import { colors, gutter, radius, space } from '@/theme/tokens';

/** Placeholder until the owner screens (list turf, sessions, slots, scanner) are built. */
export default function OwnerHome() {
  const insets = useSafeAreaInsets();
  const items = [
    { icon: ClipboardList, title: 'List your turf', body: 'Photos, location, format and amenities.' },
    { icon: CalendarClock, title: 'Sessions & pricing', body: 'Opening hours, session length and weekly rates.' },
    { icon: ScanLine, title: 'Manage slots & scan tickets', body: 'Walk-ins, blocks and QR check-in.' },
  ];
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader center={<Wordmark height={24} />} />
      <View style={styles.body}>
        <View style={styles.badge}>
          <Text variant="caption" style={styles.badgeText}>
            OWNER
          </Text>
        </View>
        <Text variant="h1">Owner workspace</Text>
        <Text variant="body" color={colors.textMuted}>
          The owner tools are the next build. Here’s what’s coming:
        </Text>
        {items.map((it) => (
          <Card key={it.title} style={styles.item}>
            <View style={styles.icon}>
              <it.icon size={22} color={colors.ink} strokeWidth={1.9} />
            </View>
            <View style={styles.flex}>
              <Text variant="bodyStrong">{it.title}</Text>
              <Text variant="label" color={colors.textMuted}>
                {it.body}
              </Text>
            </View>
          </Card>
        ))}
        <Button label="Back to explore" variant="dark" onPress={() => router.dismissTo('/explore')} style={styles.mt} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  body: { paddingHorizontal: gutter, gap: space[3], marginTop: space[4] },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.lime,
    borderRadius: radius.xs,
    paddingHorizontal: space[2],
    paddingVertical: 3,
  },
  badgeText: { fontFamily: 'Geist_800ExtraBold', letterSpacing: 1.4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.limeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mt: { marginTop: space[3] },
});
