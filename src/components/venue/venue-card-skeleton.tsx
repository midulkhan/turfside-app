import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { radius, space } from '@/theme/tokens';

export function VenueCardSkeleton() {
  return (
    <Card padded={false} style={styles.card}>
      <Skeleton height={160} r={radius.md} />
      <View style={styles.body}>
        <Skeleton width="60%" height={20} />
        <Skeleton width="35%" height={14} />
        <Skeleton width="50%" height={14} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 6 },
  body: { padding: space[3], gap: space[3] },
});
