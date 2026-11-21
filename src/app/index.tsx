import { Redirect } from 'expo-router';

import { pendingTurfLink } from '@/features/session/pending-link';
import { useSession } from '@/features/session/session';

/** Entry point: send people to onboarding, sign in, or straight into the app. */
export default function Index() {
  const { onboarded, user } = useSession();
  if (user) {
    // A turf link opened before signing in: open that turf now.
    const code = pendingTurfLink.take();
    return <Redirect href={code ? `/t/${code}` : '/explore'} />;
  }
  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/sign-in" />;
}
