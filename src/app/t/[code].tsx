import { useQuery } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, MapPinOff } from 'lucide-react-native';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { ApiError } from '@/features/api/types';
import { pendingTurfLink } from '@/features/session/pending-link';
import { useSession } from '@/features/session/session';
import { colors, gutter, space } from '@/theme/tokens';

const CODE = /^[A-HJ-NP-Z2-9]{7}$/;

/**
 * A turf share link (turfsides.com/FDJV346 → /t/FDJV346): looks the code up and opens the turf.
 * Signed out: keeps the code while they sign in or sign up, then the start screen brings them here.
 */
export default function TurfLink() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = String(params.code ?? '').toUpperCase();
  const { user } = useSession();
  const valid = CODE.test(code);
  const look = useQuery({
    queryKey: ['venue-code', code],
    queryFn: ({ signal }) => api.getVenueByCode(code, signal),
    enabled: !!user && valid,
    retry: (n, e) => !(e instanceof ApiError && e.code === 'not_found') && n < 2,
    staleTime: 60_000,
  });
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (look.data) router.replace(`/venue/${look.data.id}`);
  }, [look.data]);

  if (!user) {
    if (valid) pendingTurfLink.set(code);
    return <Redirect href="/" />;
  }

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
            title="This turf link isn’t active"
            body="The turf may have been removed, or the link was mistyped."
            action="Explore turfs"
            onAction={() => router.replace('/explore')}
          />
        ) : look.error ? (
          <ErrorState message={look.error.message} onRetry={() => look.refetch()} />
        ) : (
          <View style={{ alignItems: 'center', gap: space[3] }}>
            <ActivityIndicator color={colors.text} />
            <Text variant="caption" color={colors.textMuted}>
              Opening turf…
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
