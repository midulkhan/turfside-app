import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, MapPinOff } from 'lucide-react-native';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { ApiError } from '@/features/api/types';
import { useAuthGate } from '@/features/session/auth-gate';
import { useSession } from '@/features/session/session';
import { colors, gutter, space } from '@/theme/tokens';

const CODE = /^[A-HJ-NP-Z2-9]{7}$/;

/**
 * A share link (turfsides.com/FDJV346 → /t/FDJV346): looks the code up and opens the turf, or the
 * player/opponent request, it belongs to.
 * Guests see turfs straight away; a game link asks them to sign in first (over Explore), then
 * opens the game.
 */
export default function TurfLink() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = String(params.code ?? '').toUpperCase();
  const { user } = useSession();
  const { requireAuth } = useAuthGate();
  const valid = CODE.test(code);
  const look = useQuery({
    queryKey: ['link', code],
    queryFn: ({ signal }) => api.getLink(code, signal),
    enabled: valid,
    retry: (n, e) => !(e instanceof ApiError && e.code === 'not_found') && n < 2,
    staleTime: 60_000,
  });
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!look.data) return;
    const to = look.data.kind === 'match' ? (`/game/${look.data.id}` as const) : (`/venue/${look.data.id}` as const);
    // Games are for members: a guest gets Explore with the sign-in drawer, then the game.
    if (look.data.kind === 'match' && !user) {
      router.replace('/explore');
      setTimeout(() => requireAuth('Sign in to see this game', () => router.push(to)), 300);
      return;
    }
    // Opened from a link: put Explore underneath so back (button or swipe) lands somewhere useful.
    if (router.canGoBack()) router.replace(to);
    else {
      router.replace('/explore');
      router.push(to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per resolved link
  }, [look.data]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/explore'));
  const notFound = !valid || (look.error instanceof ApiError && look.error.code === 'not_found');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: gutter, paddingVertical: space[2] }}>
        <IconButton icon={ArrowLeft} label="Back" onPress={back} />
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {notFound ? (
          <EmptyState
            icon={MapPinOff}
            title="This link isn’t active"
            body="The turf or game may have been removed, or the link was mistyped."
            action="Explore turfs"
            onAction={() => router.replace('/explore')}
          />
        ) : look.error ? (
          <ErrorState message={look.error.message} onRetry={() => look.refetch()} />
        ) : (
          <View style={{ alignItems: 'center', gap: space[3] }}>
            <ActivityIndicator color={colors.text} />
            <Text variant="caption" color={colors.textMuted}>
              Opening…
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
