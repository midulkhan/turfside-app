import { Redirect } from 'expo-router';

import { useSession } from '@/features/session/session';

/** Entry point: send people to onboarding, sign in, or straight into the app. */
export default function Index() {
  const { onboarded, user } = useSession();
  if (user) return <Redirect href="/explore" />;
  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/sign-in" />;
}
