"use client";

import { Check } from "lucide-react";
import { UNIFORM_PALETTE, isHexColor, textColorOn } from "@/lib/events/game-display";

/**
 * An optional uniform color: one of the kit colors, a custom color, or none
 * (spec: docs/specs/game-display-and-uniform-colors.md). Values are #rrggbb.
 */
export function UniformColorPicker({
  label,
  value,
  onChange,
}: {
  /** Names the group for assistive technology, e.g. "Home uniform color". */
  label: string;
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const inPalette = UNIFORM_PALETTE.some((c) => c.hex === value);

  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {UNIFORM_PALETTE.map((c) => {
        const selected = c.hex === value;
        return (
          <button
            key={c.hex}
            type="button"
            title={c.name}
            aria-label={c.name}
            aria-pressed={selected}
            onClick={() => onChange(c.hex)}
            className={`flex size-6 items-center justify-center rounded-full border border-foreground/20 ${
              selected ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
            }`}
            style={{ backgroundColor: c.hex }}
          >
            {selected && <Check className="size-3.5" style={{ color: textColorOn(c.hex) }} />}
          </button>
        );
      })}

      <label
        className={`relative flex h-6 cursor-pointer items-center rounded-full border px-2 text-xs ${
          value && !inPalette ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
        }`}
      >
        {value && !inPalette && (
          <span className="mr-1 inline-block size-3 rounded-full border border-foreground/20" style={{ backgroundColor: value }} />
        )}
        Custom
        <input
          type="color"
          aria-label="Custom color"
          value={isHexColor(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>

      {value && (
        <button type="button" onClick={() => onChange(null)} className="text-xs text-muted-foreground underline">
          Clear color
        </button>
      )}
    </div>
  );
}
