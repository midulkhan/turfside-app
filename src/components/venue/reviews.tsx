import { MessageSquareText, Star } from 'lucide-react-native';
import { memo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useSaveReview } from '@/features/api/queries';
import type { ReviewSummary } from '@/features/api/types';
import { haptic } from '@/lib/haptics';
import { colors, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

const GOLD = '#F5B301';
const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

function ago(at: number, now: number) {
  const d = Math.floor((now - at) / 86400_000);
  if (d < 1) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`;
  const m = Math.floor(d / 30);
  return m < 12 ? `${m} month${m === 1 ? '' : 's'} ago` : `${Math.floor(m / 12)} year${m < 24 ? '' : 's'} ago`;
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} color={GOLD} fill={i <= Math.round(value) ? GOLD : 'transparent'} strokeWidth={1.8} />
      ))}
    </View>
  );
}

/**
 * The turf's Reviews tab: real ratings only (from players who booked and played), a prompt to
 * rate it if you've played there, your own review (final once posted), and everyone's reviews.
 */
export const ReviewsTab = memo(function ReviewsTab({
  venueId,
  data,
  loading,
}: {
  venueId: string;
  data?: ReviewSummary;
  loading: boolean;
}) {
  const [now] = useState(() => Date.now());
  const [writing, setWriting] = useState(false);
  if (loading || !data) return <Skeleton height={180} r={radius.lg} />;
  const max = Math.max(...Object.values(data.histogram), 1);
  const others = data.items.filter((r) => !data.mine || r.id !== data.mine.id);

  return (
    <View style={styles.gap}>
      {data.count > 0 ? (
        <Card style={styles.summary}>
          <View style={styles.summaryLeft}>
            <Text variant="number" style={styles.big}>
              {data.average.toFixed(1)}
            </Text>
            <Stars value={data.average} />
            <Text variant="caption" color={colors.textMuted}>
              {data.count === 1 ? '1 review' : `${data.count} reviews`}
            </Text>
          </View>
          <View style={styles.flex}>
            {([5, 4, 3, 2, 1] as const).map((n) => (
              <View key={n} style={styles.histRow}>
                <Text variant="caption" color={colors.textMuted} style={styles.histLabel}>
                  {n}
                </Text>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${(data.histogram[n] / max) * 100}%` }]} />
                </View>
              </View>
            ))}
          </View>
        </Card>
      ) : (
        <Card style={styles.empty}>
          <View style={styles.emptyIcon}>
            <MessageSquareText size={22} color={colors.ink} strokeWidth={1.8} />
          </View>
          <Text variant="title">No reviews yet</Text>
          <Text variant="label" color={colors.textMuted} align="center">
            {data.canReview ? 'You’ve played here. Be the first to rate it.' : 'Players who book and play here can rate it.'}
          </Text>
        </Card>
      )}

      {data.mine ? (
        <Card style={styles.mine}>
          <Text variant="labelStrong">Your review</Text>
          <Stars value={data.mine.rating} size={16} />
          {data.mine.text ? (
            <Text variant="label" color={colors.textMuted}>
              {data.mine.text}
            </Text>
          ) : null}
        </Card>
      ) : data.canReview ? (
        <Card style={styles.prompt}>
          <View style={styles.flex}>
            <Text variant="labelStrong">How was your game here?</Text>
            <Text variant="caption" color={colors.textMuted}>
              Rate the turf for other players.
            </Text>
          </View>
          <Button label="Rate this turf" icon={Star} small onPress={() => setWriting(true)} />
        </Card>
      ) : null}

      {others.map((r) => (
        <Card key={r.id} style={styles.item}>
          <View style={styles.row}>
            <Avatar name={r.author} size={36} />
            <View style={styles.flex}>
              <Text variant="labelStrong">{r.author}</Text>
              <Text variant="caption" color={colors.textMuted}>
                {ago(r.at, now)} · played here
              </Text>
            </View>
            <Stars value={r.rating} size={13} />
          </View>
          {r.text ? (
            <Text variant="label" color={colors.textMuted}>
              {r.text}
            </Text>
          ) : null}
        </Card>
      ))}

      {!data.canReview && !data.mine && data.count > 0 ? (
        <Text variant="caption" color={colors.textMuted} align="center">
          Only players who booked and played here can leave a review.
        </Text>
      ) : null}

      <ReviewSheet venueId={venueId} visible={writing} onClose={() => setWriting(false)} />
    </View>
  );
});

function ReviewSheet({ venueId, visible, onClose }: { venueId: string; visible: boolean; onClose: () => void }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  // Each time it opens: blank.
  const [openedFor, setOpenedFor] = useState(false);
  if (visible !== openedFor) {
    setOpenedFor(visible);
    if (visible) {
      setRating(0);
      setText('');
    }
  }
  const save = useSaveReview(venueId);
  const submit = () =>
    save.mutate(
      { rating, text: text.trim() },
      {
        onSuccess: () => {
          haptic.success();
          onClose();
        },
        onError: (e) => {
          haptic.error();
          Alert.alert('Review not posted', e.message);
        },
      },
    );

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text variant="h2">Rate this turf</Text>
          <Text variant="label" color={colors.textMuted}>
            Shown with your first name and initial. Once posted, a review can’t be changed.
          </Text>
        </View>
        <View style={styles.pick} accessibilityRole="adjustable" accessibilityLabel={`Rating, ${rating} of 5`}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={`${i} star${i === 1 ? '' : 's'}`}
              hitSlop={4}
              onPress={() => {
                haptic.select();
                setRating(i);
              }}>
              <Star size={36} color={GOLD} fill={i <= rating ? GOLD : 'transparent'} strokeWidth={1.6} />
            </Pressable>
          ))}
        </View>
        <Text variant="labelStrong" align="center" color={rating ? colors.ink : colors.textMuted}>
          {rating ? WORDS[rating] : 'Tap a star'}
        </Text>
        <Input
          label="Tell other players (optional)"
          value={text}
          onChangeText={setText}
          placeholder="The surface, lights, staff, parking…"
          multiline
          maxLength={1000}
        />
        <Button label="Post review" onPress={submit} loading={save.isPending} disabled={!rating} />
      </View>
    </Sheet>
  );
}

const styles = createStyles(() => ({
  gap: { gap: space[3] },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  stars: { flexDirection: 'row', gap: 2 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space[5] },
  summaryLeft: { alignItems: 'center', gap: space[1], minWidth: 96 },
  big: { fontSize: 44, lineHeight: 50 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], height: 18 },
  histLabel: { width: 10 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: GOLD },
  empty: { alignItems: 'center', gap: space[2], paddingVertical: space[6] },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.limeSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[1],
  },
  prompt: { flexDirection: 'row', alignItems: 'center', gap: space[3], borderColor: colors.lime, backgroundColor: colors.limeSoft },
  mine: { gap: space[2], borderColor: colors.lime },
  item: { gap: space[2] },
  sheet: { padding: space[5], gap: space[3] },
  sheetHead: { gap: space[1], marginBottom: space[1] },
  pick: { flexDirection: 'row', justifyContent: 'center', gap: space[3], paddingTop: space[2] },
}));
