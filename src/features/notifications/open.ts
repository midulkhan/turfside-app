import { router } from 'expo-router';

/** What a notification carries (in-app list item `data`, or a push's `data`). */
export type NotificationData = { type?: string; matchId?: string; kind?: string };

/**
 * Where a notification leads (same for a tap in the list and a tap on a push):
 * accepted → pay your share; a request or a payment → manage; other squad news → find a squad;
 * anything else → the notifications list.
 */
export function notificationTarget(d: NotificationData | undefined): (() => void) | null {
  const id = d?.matchId;
  if (!id) return null;
  switch (d?.type) {
    case 'match_accepted':
      return () => router.push({ pathname: '/checkout', params: { match: id } });
    case 'match_request':
    case 'match_member_paid':
      return () => router.push({ pathname: '/match/[id]', params: { id } });
    default:
      return () => router.push('/join');
  }
}
