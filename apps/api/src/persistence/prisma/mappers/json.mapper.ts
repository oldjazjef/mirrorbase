/** JSON text columns ↔ domain values. The only place that parses them. */
export function parseObject<T extends object>(text: string): T {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as T)
      : ({} as T);
  } catch {
    return {} as T;
  }
}

export function parseArray<T>(text: string): T[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null): string | null =>
  date ? date.toISOString() : null;
