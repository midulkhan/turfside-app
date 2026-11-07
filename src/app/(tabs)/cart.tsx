import { router } from 'expo-router';
import { ShoppingBag } from 'lucide-react-native';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTabBarSpace } from '@/components/navigation/tab-bar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useCart } from '@/features/api/use-cart';
import { colors, gutter, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

/**
 * Cart tab. With a slot held, tapping the tab goes straight to checkout (see the
 * tab bar), so this screen is normally only seen when the cart is empty.
 */
export default function Cart() {
  const insets = useSafeAreaInsets();
  const bottom = useTabBarSpace();
  const cart = useCart();
  return (
    <View style={[styles.root, { paddingTop: insets.top + space[4], paddingBottom: bottom }]}>
      <View style={styles.header}>
        <Text variant="pageTitle">Cart</Text>
      </View>
      {cart.hold ? (
        <View style={styles.held}>
          <Text variant="body" color={colors.textMuted}>
            {`You're holding a slot at ${cart.hold.venue.name}.`}
          </Text>
          <Button label="Continue to checkout" onPress={cart.open} />
        </View>
      ) : (
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          body="Pick a slot on any turf. It's held for you for 5 minutes while you pay."
          action="Find a turf"
          onAction={() => router.navigate('/explore')}
        />
      )}
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: gutter, paddingBottom: space[5] },
  held: { paddingHorizontal: gutter, gap: space[4] },
}));
