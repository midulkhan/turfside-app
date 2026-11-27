import { Redirect } from 'expo-router';

import { useSession } from '@/features/session/session';

/**
 * Entry point: the intro slides on the very first open, then straight into the app. No sign-in
 * here: guests browse turfs and slots, and sign in when they book (see auth-gate).
 */
export default function Index() {
  const { onboarded } = useSession();
  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/explore" />;
}
