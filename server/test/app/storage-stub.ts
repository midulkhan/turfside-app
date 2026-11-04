const mem = new Map<string, string>();
const store = {
  get: async (k: string) => mem.get(k) ?? null,
  set: async (k: string, v: string) => void mem.set(k, v),
  remove: async (k: string) => void mem.delete(k),
};
export const secure = store;
export const prefs = store;
export const _mem = mem;
