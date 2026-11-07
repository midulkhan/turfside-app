import { StyleSheet } from 'react-native';

import { themeVersion } from './tokens';

/**
 * `StyleSheet.create` for themed styles. The factory runs lazily and again after every theme
 * switch, so styles that use `colors.*` always match the active palette.
 *
 *   const styles = createStyles(() => ({ card: { backgroundColor: colors.surface } }));
 */
type Styles = Parameters<typeof StyleSheet.create>[0];

export function createStyles<T extends Styles>(factory: () => T & Styles): Readonly<T> {
  let cached: T | null = null;
  let builtFor = -1;
  const get = () => {
    if (builtFor !== themeVersion() || !cached) {
      cached = StyleSheet.create(factory()) as T;
      builtFor = themeVersion();
    }
    return cached as Record<string | symbol, unknown>;
  };
  return new Proxy({} as T, {
    get: (_, k) => get()[k],
    has: (_, k) => k in get(),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_, k) => ({ value: get()[k], enumerable: true, configurable: true }),
  });
}
