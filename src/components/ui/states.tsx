import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';

import { Button } from './button';
import { Text } from './text';

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.icon}>
        <Icon size={28} color={colors.ink} strokeWidth={1.8} />
      </View>
      <Text variant="h3" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" color={colors.textMuted} align="center">
          {body}
        </Text>
      ) : null}
      {action ? <Button label={action} onPress={onAction} variant="dark" small style={styles.btn} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.wrap}>
      <Text variant="title" align="center">
        Something went wrong
      </Text>
      <Text variant="label" color={colors.textMuted} align="center">
        {message}
      </Text>
      <Button label="Try again" onPress={onRetry} variant="outline" small style={styles.btn} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space[2], paddingVertical: space[8], paddingHorizontal: space[6] },
  icon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.limeSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[2],
  },
  btn: { marginTop: space[3] },
});
