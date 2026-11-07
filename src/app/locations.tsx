import { router } from 'expo-router';
import { Briefcase, Check, House, LocateFixed, MapPin, Pencil, Plus, X } from 'lucide-react-native';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Overline } from '@/components/ui/headers';
import { IconButton } from '@/components/ui/icon-button';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { usePlaces } from '@/features/api/queries';
import type { SavedPlace } from '@/features/api/types';
import { useSession } from '@/features/session/session';
import { useLocate } from '@/features/session/use-locate';
import { haptic } from '@/lib/haptics';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

export const placeIcon = (label: string) => (/^home$/i.test(label) ? House : /^work$/i.test(label) ? Briefcase : MapPin);
const placeLine = (p: Pick<SavedPlace, 'name' | 'city' | 'address'>) => p.address || [p.name, p.city].filter(Boolean).join(', ');

/**
 * Full-screen location picker (Foodpanda style): live location, add a new
 * location on the map, or pick / edit a saved one. Choosing closes the screen,
 * and Explore refilters straight away because its query depends on the place.
 */
export default function Locations() {
  const scrolled = useScrolled();
  const insets = useSafeAreaInsets();
  const { place, setPlace } = useSession();
  const { locate, locating } = useLocate();
  const places = usePlaces();

  const useLive = async () => {
    if (await locate()) router.back();
  };

  const choose = (p: SavedPlace) => {
    haptic.select();
    setPlace({ name: p.name, city: p.city, lat: p.lat, lng: p.lng, source: 'saved', savedId: p.id, label: p.label });
    router.back();
  };

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress} style={styles.sticky}>
        <View style={styles.header}>
          <IconButton icon={X} label="Close" onPress={() => router.back()} />
          <Text variant="title" style={styles.title}>
            Choose location
          </Text>
          <View style={styles.headerSpacer} />
        </View>
      </StickyHeader>

      <ScrollView
        onScroll={scrolled.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.actions}>
          <ActionRow
            icon={LocateFixed}
            title="Use my current location"
            detail={place.source === 'gps' ? `Now: ${[place.name, place.city].filter(Boolean).join(', ')}` : 'Most accurate distances'}
            active={place.source === 'gps'}
            busy={locating}
            onPress={useLive}
          />
          <ActionRow
            icon={Plus}
            title="Add new location"
            detail="Pick it on the map and save it"
            onPress={() => router.push({ pathname: '/pick-location', params: { mode: 'new' } })}
          />
        </View>

        <View style={styles.overline}>
          <Overline>Saved locations</Overline>
        </View>
        {places.isPending ? (
          <View style={styles.list}>
            <Skeleton height={76} r={radius.lg} />
            <Skeleton height={76} r={radius.lg} />
          </View>
        ) : places.isError ? (
          <Pressable accessibilityRole="button" onPress={() => places.refetch()} style={styles.empty}>
            <Text variant="body" color={colors.textMuted} align="center">
              Couldn’t load your saved locations. Tap to try again.
            </Text>
          </Pressable>
        ) : places.data.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="body" color={colors.textMuted} align="center">
              No saved locations yet. Add Home, Work or anywhere you usually play.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {places.data.map((p) => {
              const Icon = placeIcon(p.label);
              const active = place.savedId === p.id;
              return (
                <View key={p.id} style={[styles.place, active && styles.placeActive]}>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${p.label}, ${placeLine(p)}`}
                    onPress={() => choose(p)}
                    style={({ pressed }) => [styles.placeMain, pressed && styles.pressed]}>
                    <View style={[styles.icon, active && styles.iconActive]}>
                      <Icon size={20} color={colors.ink} strokeWidth={2} />
                    </View>
                    <View style={styles.flex}>
                      <View style={styles.labelRow}>
                        <Text variant="bodyStrong" numberOfLines={1}>
                          {p.label}
                        </Text>
                        {active ? <Check size={16} color={colors.limeText} strokeWidth={3} /> : null}
                      </View>
                      <Text variant="label" color={colors.textMuted} numberOfLines={2}>
                        {placeLine(p)}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${p.label}`}
                    hitSlop={8}
                    onPress={() => router.push({ pathname: '/pick-location', params: { mode: 'edit', id: p.id } })}
                    style={styles.edit}>
                    <Pencil size={18} color={colors.ink} strokeWidth={1.9} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function ActionRow({
  icon: Icon,
  title,
  detail,
  onPress,
  active,
  busy,
}: {
  icon: typeof MapPin;
  title: string;
  detail: string;
  onPress: () => void;
  active?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.action, active && styles.placeActive, pressed && styles.pressed]}>
      <View style={styles.actionIcon}>
        <Icon size={22} color={colors.charcoal} strokeWidth={2} />
      </View>
      <View style={styles.flex}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="label" color={colors.textMuted} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {busy ? <ActivityIndicator color={colors.ink} /> : null}
    </Pressable>
  );
}

const styles = createStyles(() => ({
  sticky: { paddingTop: space[2], paddingBottom: space[2] },
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: gutter, paddingBottom: space[3] },
  title: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 48 },
  content: { paddingHorizontal: gutter, paddingTop: space[3] },
  actions: { gap: space[2] },
  action: {
    minHeight: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  actionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  overline: { marginTop: space[7], marginBottom: space[3] },
  list: { gap: space[2] },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  placeActive: { borderColor: colors.ink, borderWidth: 1.5 },
  placeMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 76,
    paddingLeft: space[4],
    paddingVertical: space[3],
  },
  pressed: { backgroundColor: colors.bg },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  iconActive: { backgroundColor: colors.limeSoft },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  edit: { width: 56, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
  empty: { paddingVertical: space[6], paddingHorizontal: space[4] },
}));
