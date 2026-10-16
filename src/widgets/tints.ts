// Card tints (C4): the frost glass of a widget's card takes a hue the user picks, so a project is known by its colour at a
// glance. The tint is a low-alpha wash over the shared glass plus a tinted edge: text contrast stays the glass's own.
// Ids are stored on the widget record (`appearance.tint`, records.ts); an id this build doesn't list shows the default
// glass, so a tint added later never breaks an older build.

export interface Tint { id: string; name: string; rgb: string }

/** Hues chosen to read on the warm cloth backdrop without fighting it. `rgb` is space-separated channels. */
export const TINTS: readonly Tint[] = [
  { id: 'sky', name: 'Sky', rgb: '120 170 225' },
  { id: 'teal', name: 'Teal', rgb: '90 185 170' },
  { id: 'moss', name: 'Moss', rgb: '145 180 100' },
  { id: 'amber', name: 'Amber', rgb: '235 175 80' },
  { id: 'rose', name: 'Rose', rgb: '230 120 135' },
  { id: 'violet', name: 'Violet', rgb: '170 140 220' },
]

export const tintOf = (id: string | null | undefined): Tint | null => TINTS.find((t) => t.id === id) ?? null

/** A card root's tint binding (`v-bind`): `data-tint` + `--tint` for a known id, nothing for the default glass. */
export const cardTint = (id: string | null | undefined): Record<string, unknown> => {
  const t = tintOf(id)
  return t ? { 'data-tint': t.id, style: { '--tint': t.rgb } } : {}
}

/**
 * Which other widgets already wear each tint, for the menu's soft duplicate marking: a taken tint stays selectable, the
 * menu just names who has it. `self` is left out.
 */
export function tintOwners(widgets: readonly { id: string; name: string; tint: string | null }[], self: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const w of widgets) {
    if (w.id === self || !tintOf(w.tint)) continue
    out.set(w.tint!, [...(out.get(w.tint!) ?? []), w.name])
  }
  return out
}
