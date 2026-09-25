import { BACKGROUNDS, needsBorder, textColorOn, type Uniform } from "@/lib/events/game-display";

/**
 * The borders a fill needs, per theme, as classes and data attributes. The
 * attributes state the decision plainly for tests; the classes apply it.
 */
function borderFor(fill: string, surface: { light: string; dark: string }) {
  const light = needsBorder(fill, surface.light);
  const dark = needsBorder(fill, surface.dark);
  return {
    className: `${light ? "border" : "border-0"} ${dark ? "dark:border" : "dark:border-0"} border-foreground/30`,
    data: { "data-border-light": String(light), "data-border-dark": String(dark) },
  };
}

/**
 * A game's uniform, by name: on a pill filled with its color when it has one,
 * as plain text when it doesn't. Renders nothing for a game with no uniform.
 */
export function UniformLabel({ uniform, className = "" }: { uniform: Uniform | null; className?: string }) {
  if (!uniform) return null;
  if (!uniform.color) {
    return (
      <span aria-label={`Uniform: ${uniform.name}`} className={className}>
        {uniform.name}
      </span>
    );
  }
  const border = borderFor(uniform.color, BACKGROUNDS.page);
  return (
    <span
      aria-label={`Uniform: ${uniform.name}`}
      {...border.data}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${border.className} ${className}`}
      style={{ backgroundColor: uniform.color, color: textColorOn(uniform.color) }}
    >
      {uniform.name}
    </span>
  );
}

/** The calendar chip's uniform dot. Renders nothing without a color. */
export function UniformDot({ uniform }: { uniform: Uniform | null }) {
  if (!uniform?.color) return null;
  const border = borderFor(uniform.color, BACKGROUNDS.gameChip);
  return (
    <span
      aria-label={`Uniform: ${uniform.name}`}
      {...border.data}
      className={`inline-block size-2 shrink-0 rounded-full ${border.className}`}
      style={{ backgroundColor: uniform.color }}
    />
  );
}
