import type { LucideIcon, LucideProps } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * Directions icon: a solid map pin standing on two rings. Drawn on Lucide's 24-unit grid (framed tightly, so it reads a little larger than a Lucide icon) and
 * takes the same props (size, color), so it drops in wherever a Lucide icon goes.
 */
function PinDropIcon({ size = 24, color = 'currentColor', strokeWidth = 2 }: LucideProps) {
  const ring = Math.max(1.4, Number(strokeWidth) * 0.8);
  return (
    <Svg width={size} height={size} viewBox="1.2 0.8 21.6 21.6" fill="none">
      {/* Pin with a hole */}
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        fill={color}
        d="M12 1.6c-3.1 0-5.5 2.4-5.5 5.4 0 1.2.4 2.3 1 3.4L11.1 16.6c.4.7 1.4.7 1.8 0L16.5 10.4c.6-1.1 1-2.2 1-3.4 0-3-2.4-5.4-5.5-5.4Zm0 3.3a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z"
      />
      {/* Inner ring, open where the pin meets it */}
      <Path d="M9.7 15.1C7.9 15.5 6.8 16.1 6.8 16.9c0 1.1 2.3 1.9 5.2 1.9s5.2-.8 5.2-1.9c0-.8-1.1-1.4-2.9-1.8" stroke={color} strokeWidth={ring} strokeLinecap="round" />
      {/* Outer ring, open at the top */}
      <Path d="M5 14.6c-1.9.7-3 1.6-3 2.6 0 2.1 4.5 3.8 10 3.8s10-1.7 10-3.8c0-1-1.1-1.9-3-2.6" stroke={color} strokeWidth={ring} strokeLinecap="round" />
    </Svg>
  );
}

export const PinDrop = PinDropIcon as unknown as LucideIcon;
