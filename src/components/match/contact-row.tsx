import { Phone } from 'lucide-react-native';
import { Linking, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

/** "+8801762345908" → "+880 1762 345 908" (readable; other formats are shown as they are). */
export function formatPhone(p: string) {
  const m = /^\+880(\d{4})(\d{3})(\d{3})$/.exec(p);
  return m ? `+880 ${m[1]} ${m[2]} ${m[3]}` : p;
}

/** A squad contact: who, their number, and a call button. */
export function ContactRow({ name, phone, avatar, caption }: { name: string; phone: string; avatar?: string | null; caption?: string }) {
  return (
    <View style={styles.row}>
      <Avatar name={name} uri={avatar ?? null} size={44} />
      <View style={styles.text}>
        {caption ? (
          <Text variant="caption" color={colors.textMuted}>
            {caption}
          </Text>
        ) : null}
        <Text variant="bodyStrong" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="label" color={colors.textMuted} selectable>
          {formatPhone(phone)}
        </Text>
      </View>
      <IconButton icon={Phone} label={`Call ${name}`} variant="lime" size={44} onPress={() => Linking.openURL(`tel:${phone}`)} />
    </View>
  );
}

const styles = createStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  text: { flex: 1, minWidth: 0, gap: 1 },
}));
