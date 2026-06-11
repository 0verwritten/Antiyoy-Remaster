// Reusable menu controls in the original Antiyoy cream/olive style.

import type { ComponentChildren } from "preact";

/** Big cream rounded button like the original menus. */
export function MenuButton({
  children,
  onClick,
  className = "",
}: {
  children: ComponentChildren;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[56px] rounded-2xl bg-[#f0eee3] px-6 text-lg font-bold text-[#3a3a33] shadow-[0_3px_0_rgba(0,0,0,0.25)] transition active:translate-y-[2px] active:shadow-none ${className}`}
    >
      {children}
    </button>
  );
}

/** Small option chip in the original cream/olive style. */
export function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[44px] min-w-[44px] rounded-xl px-3 text-sm font-bold capitalize transition shadow-[0_2px_0_rgba(0,0,0,0.2)] active:translate-y-[1px] active:shadow-none ${
        selected ? "bg-[#3a3a33] text-[#f0eee3]" : "bg-[#f0eee3] text-[#3a3a33]"
      }`}
    >
      {children}
    </button>
  );
}
