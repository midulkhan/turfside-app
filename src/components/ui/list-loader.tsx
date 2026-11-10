import { ActivityIndicator, View } from 'react-native';

import { colors, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

/** Bottom of a paged list: a spinner while the next 10 load (keeps its height so nothing jumps). */
export function ListLoader({ loading }: { loading: boolean }) {
  return <View style={styles.root}>{loading ? <ActivityIndicator color={colors.ink} /> : null}</View>;
}

/** Ask for the next page when the list is within ~60% of a screen of its end. */
export const END_THRESHOLD = 0.6;

const styles = createStyles(() => ({
  root: { height: 56, alignItems: 'center', justifyContent: 'center', paddingVertical: space[2] },
}));
