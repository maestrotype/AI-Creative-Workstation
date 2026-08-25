/**
 * Joins conditional class names, filtering falsy values.
 * Lightweight alternative to `clsx` — no dependencies needed.
 */
export function cx(
  ...classes: ReadonlyArray<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(' ');
}
