# TurfSides — player app (UI build)

Expo SDK 58 · React Native 0.88 · Expo Router · Reanimated 4 · React Query.
This build is the **player-side UI plus shared onboarding/auth**, running on an in-memory mock API. No backend yet.

## Run

```bash
npm install
npx expo start          # press i / a, or scan with a development build
```

Native modules used (expo-video, expo-location, expo-secure-store, react-native-svg, FlashList) are all in Expo Go, so Expo Go works for UI review. Use a development build for production testing.

Demo OTP code on the verify screen: `123456`.

## Structure

```
src/app/                 routes (Expo Router)
  index.tsx              entry redirect (onboarding → sign-in → explore)
  onboarding.tsx
  (auth)/                sign-in, sign-up, owner-sign-up, verify, forgot-password
  (tabs)/                explore, bookings, saved, profile  (custom floating tab bar)
  venue/[id].tsx         details + ticket-style slot picker
  checkout.tsx           hold timer, server quote, bKash, slide-to-pay
  booking/[id].tsx       confirmation / entry pass with QR
  search.tsx, notifications.tsx, owner.tsx (placeholder)
src/theme/tokens.ts      THE design system: colours, radii, borders, spacing, type
src/components/          ui/, ticket/, venue/, auth/, navigation/, brand/, splash/
src/features/api/        types.ts (contracts), client.ts (mock), queries.ts (cache policy)
src/features/session/    auth/onboarding state, GPS → area
src/lib/                 money (poisha), time (Asia/Dhaka), schedule, images, storage…
assets/brand/            vector logo, icon and wordmark (SVG, traced from the supplied logo)
assets/video/splash.mp4  logo reveal, re-encoded on pure white (140 KB)
assets/fonts/Taka-*.ttf  1.4 KB subsets of Noto Sans Bengali containing only "৳" (OFL)
```

## Design-system rules

- Never hard-code colours, radii or font sizes — import from `src/theme/tokens.ts`.
- Controls (buttons, inputs, chips, search) are pill-shaped; cards/sheets use `radius.lg`; images inside cards use `radius.md`.
- Borders are always 1 px (`colors.border` on light, `colors.borderOnDark` on dark).
- Lime = primary action / active state. Orange = brand accent only.
- All text goes through `components/ui/text.tsx` (type scale + automatic ৳ glyph).

## Performance built in

- React Query cache with per-resource staleness; venue/booking data persisted to disk for instant start; slot availability never persisted and refetched every 30 s.
- Prefetch venue details on card press-in; optimistic favourites with rollback.
- Search debounced 300 ms; superseded requests are aborted.
- FlashList for long lists, memoised rows, React Compiler enabled.
- expo-image memory+disk cache, CDN width buckets (`lib/images.ts`), WebP compression and a bounded-concurrency, retrying upload queue for owner photos.
- Gestures/animations run on the UI thread (Reanimated/Gesture Handler).

## Security contract for the backend (to implement server-side)

- The app sends **ids only**; the server computes every price, fee and total.
- A booking is confirmed **only** after server-side bKash verification. Redirects, deep links or typed transaction IDs never confirm anything.
- Booking/payment requests carry an idempotency key (`lib/ids.ts`); payments are polled, never assumed.
- Tokens live in SecureStore (Keychain/Keystore); AsyncStorage holds only non-sensitive data.
- QR passes encode an opaque signed token, never raw booking ids.
- OTP: expiry, attempt limits and rate limits enforced server-side (UI mirrors them).

## Swap the mock for the real API

Replace the function bodies in `src/features/api/client.ts` with HTTP calls — signatures, types and the query layer stay the same.
