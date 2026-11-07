import { AppleMaps, GoogleMaps, type CameraMoveEvent } from 'expo-maps';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, LocateFixed, MapPin, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useDeletePlace, usePlaces, useSavePlace } from '@/features/api/queries';
import { errorMessage } from '@/features/session/pending-signup';
import { useSession } from '@/features/session/session';
import { currentPosition, describePlace, round3 } from '@/features/session/use-locate';
import { haptic } from '@/lib/haptics';
import { colors, gutter, radius, shadow, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

type Coords = { latitude: number; longitude: number };
type Label = { name: string; city: string; full: string };

const ZOOM = 16;
const SETTLE_MS = 450; // wait for the map to stop before looking up the address

const PRESETS = ['Home', 'Work'] as const;

/**
 * Foodpanda-style location picker: the pin stays in the middle of the screen
 * and the map moves underneath it. When the map settles we look up the address
 * of the centre point.
 *  - mode=new  → name it (Home / Work / Other), save it, use it, back to Explore
 *  - mode=edit → move the pin or rename it; or delete it
 */
export default function PickLocation() {
  const insets = useSafeAreaInsets();
  const { mode = 'new', id } = useLocalSearchParams<{ mode?: 'new' | 'edit'; id?: string }>();
  const { place, setPlace } = useSession();
  const existing = usePlaces().data?.find((p) => p.id === id);
  const editing = mode === 'edit' && !!existing;
  const save = useSavePlace();
  const remove = useDeletePlace();
  const start = editing ? { lat: existing.lat, lng: existing.lng } : { lat: place.lat, lng: place.lng };

  const initialLabel = existing?.label ?? 'Home';
  const [preset, setPreset] = useState<string>(PRESETS.includes(initialLabel as never) ? initialLabel : 'Other');
  const [custom, setCustom] = useState(PRESETS.includes(initialLabel as never) ? '' : initialLabel);
  const labelText = preset === 'Other' ? custom.trim() : preset;
  const apple = useRef<AppleMaps.MapView>(null);
  const google = useRef<GoogleMaps.MapView>(null);

  const [center, setCenter] = useState<Coords>({ latitude: start.lat, longitude: start.lng });
  const [label, setLabel] = useState<Label | null>(null);
  const [resolving, setResolving] = useState(true);
  const [locating, setLocating] = useState(false);
  const lookup = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seq = useRef(0);

  // The pin lifts while the map is being dragged and drops when it settles.
  const lift = useSharedValue(0);
  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.get() }] }));
  const shadowStyle = useAnimatedStyle(() => ({ opacity: 0.35 - lift.get() / 40, transform: [{ scale: 1 - lift.get() / 30 }] }));

  const resolve = (c: Coords) => {
    clearTimeout(lookup.current);
    const mine = ++seq.current; // any older lookup's answer is now stale
    setResolving(true);
    lift.set(withSpring(10, { damping: 18 }));
    lookup.current = setTimeout(async () => {
      lift.set(withSpring(0, { damping: 12 }));
      const l = await describePlace(c.latitude, c.longitude);
      if (mine !== seq.current) return; // a newer move already started
      setLabel(l);
      setResolving(false);
    }, SETTLE_MS);
  };

  // Address of the starting point (skipped if the user has already moved the map).
  useEffect(() => {
    let live = true;
    describePlace(start.lat, start.lng).then((l) => {
      if (live && seq.current === 0) {
        setLabel(l);
        setResolving(false);
      }
    });
    return () => {
      live = false;
      clearTimeout(lookup.current);
    };
  }, [start.lat, start.lng]);

  const onCameraMove = (e: CameraMoveEvent) => {
    const c = e.coordinates;
    if (c.latitude == null || c.longitude == null) return;
    const next = { latitude: c.latitude, longitude: c.longitude };
    // Ignore ~1 m jitter (the event also fires once on mount).
    if (Math.abs(next.latitude - center.latitude) < 1e-5 && Math.abs(next.longitude - center.longitude) < 1e-5) return;
    setCenter(next);
    resolve(next);
  };

  const moveTo = (c: Coords) => {
    const cam = { coordinates: c, zoom: ZOOM };
    if (Platform.OS === 'ios') apple.current?.setCameraPosition(cam);
    else google.current?.setCameraPosition({ ...cam, duration: 400 });
    setCenter(c);
    resolve(c);
  };

  const locateMe = async () => {
    setLocating(true);
    try {
      const pos = await currentPosition();
      if (pos) moveTo({ latitude: pos.lat, longitude: pos.lng });
    } finally {
      setLocating(false);
    }
  };

  const confirm = () => {
    if (!label || !labelText) return;
    const input = {
      label: labelText,
      name: label.name,
      city: label.city,
      address: label.full,
      lat: round3(center.latitude),
      lng: round3(center.longitude),
    };
    save.mutate(
      { id: editing ? existing.id : undefined, place: input },
      {
        onSuccess: (saved) => {
          haptic.success();
          const asPlace = {
            name: saved.name,
            city: saved.city,
            lat: saved.lat,
            lng: saved.lng,
            source: 'saved' as const,
            savedId: saved.id,
            label: saved.label,
          };
          if (!editing) {
            // A new location is used straight away: close the picker and the list, Explore refilters.
            setPlace(asPlace);
            router.dismissTo('/explore');
          } else {
            if (place.savedId === saved.id) setPlace(asPlace);
            router.back();
          }
        },
        onError: (e) => {
          haptic.error();
          Alert.alert('Couldn’t save this location', errorMessage(e));
        },
      },
    );
  };

  const askDelete = () =>
    editing &&
    Alert.alert(`Delete “${existing.label}”?`, 'You can add it again any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          remove.mutate(existing.id);
          if (place.savedId === existing.id) setPlace({ ...place, source: 'map', savedId: undefined, label: undefined });
          router.back();
        },
      },
    ]);

  const camera = { coordinates: { latitude: start.lat, longitude: start.lng }, zoom: ZOOM };
  const mapProps = {
    style: StyleSheet.absoluteFill,
    cameraPosition: camera,
    onCameraMove,
  };

  return (
    <View style={styles.root}>
      {Platform.OS === 'ios' ? (
        <AppleMaps.View
          ref={apple}
          {...mapProps}
          colorScheme={AppleMaps.MapColorScheme.LIGHT}
          uiSettings={{ compassEnabled: false, myLocationButtonEnabled: false, scaleBarEnabled: false, togglePitchEnabled: false }}
          properties={{ isMyLocationEnabled: true, selectionEnabled: false }}
        />
      ) : (
        <GoogleMaps.View
          ref={google}
          {...mapProps}
          uiSettings={{
            compassEnabled: false,
            myLocationButtonEnabled: false,
            mapToolbarEnabled: false,
            zoomControlsEnabled: false,
            tiltGesturesEnabled: false,
          }}
          properties={{ isMyLocationEnabled: true, selectionEnabled: false, isBuildingEnabled: false }}
        />
      )}

      {/* Fixed centre pin: its tip sits exactly on the map centre. */}
      <View pointerEvents="none" style={styles.pinLayer}>
        <Animated.View style={[styles.pinShadow, shadowStyle]} />
        <Animated.View style={[styles.pin, pinStyle]}>
          <View style={styles.pinHead}>
            <MapPin size={22} color={colors.charcoal} fill={colors.lime} strokeWidth={2.2} />
          </View>
          <View style={styles.pinStem} />
        </Animated.View>
      </View>

      <View style={[styles.top, { paddingTop: insets.top + space[2] }]}>
        <IconButton icon={ArrowLeft} label="Go back" onPress={() => router.back()} />
        <View style={styles.hint}>
          <Text variant="labelStrong">{editing ? 'Move the map to adjust' : 'Move the map to set the pin'}</Text>
        </View>
        {editing ? <IconButton icon={Trash2} label={`Delete ${existing.label}`} onPress={askDelete} /> : null}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space[4] }]}>
          <View style={styles.locateWrap}>
            <IconButton icon={LocateFixed} label="Use my current location" onPress={locateMe} />
            {locating ? <ActivityIndicator style={styles.locateSpin} color={colors.ink} /> : null}
          </View>
          <View style={styles.addressRow}>
            <View style={styles.addressIcon}>
              <MapPin size={20} color={colors.ink} strokeWidth={2} />
            </View>
            <View style={styles.flex}>
              <Text variant="bodyStrong" numberOfLines={1} color={resolving ? colors.textSubtle : colors.text}>
                {label ? [label.name, label.city].filter(Boolean).join(', ') : 'Finding address…'}
              </Text>
              <Text variant="label" color={colors.textMuted} numberOfLines={2}>
                {label?.full ?? ' '}
              </Text>
            </View>
          </View>
          <View style={styles.labels}>
            <Text variant="labelStrong">Save as</Text>
            <View style={styles.chips}>
              {[...PRESETS, 'Other'].map((p) => (
                <Chip key={p} label={p} active={preset === p} onPress={() => setPreset(p)} style={styles.chip} />
              ))}
            </View>
            {preset === 'Other' ? (
              <Input
                placeholder="Name this place, e.g. Friend’s house"
                value={custom}
                onChangeText={setCustom}
                maxLength={30}
                autoFocus={!editing}
                returnKeyType="done"
              />
            ) : null}
          </View>
          <Button
            label={editing ? 'Save changes' : 'Save location'}
            onPress={confirm}
            loading={save.isPending}
            disabled={!label || resolving || !labelText}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const PIN = 44;
const STEM = 14;

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  flex: { flex: 1, gap: 2 },
  pinLayer: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  // Lift the pin by its own height so the stem's tip marks the centre.
  pin: { alignItems: 'center', marginBottom: PIN + STEM },
  pinHead: {
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    backgroundColor: colors.inverse,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
    ...shadow.card,
  },
  pinStem: { width: 3, height: STEM, backgroundColor: colors.charcoal, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  pinShadow: { position: 'absolute', width: 14, height: 6, borderRadius: 7, backgroundColor: colors.charcoal },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: gutter,
  },
  hint: {
    flex: 1,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  labels: { gap: space[2] },
  chips: { flexDirection: 'row', gap: space[2] },
  chip: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: gutter,
    paddingTop: space[5],
    gap: space[4],
    ...shadow.card,
  },
  locateWrap: { position: 'absolute', right: gutter, top: -64 },
  locateSpin: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  addressIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.limeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
