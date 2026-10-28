/** Limitador en memoria con ventana fija, equivalente al binding de Workers para pruebas. */
export const fakeRateLimiter = (limit: number): RateLimit & { keys: string[] } => {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    limit: async ({ key }) => {
      keys.push(key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    },
  };
};
