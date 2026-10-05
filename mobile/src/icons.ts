/** Maps backend scene icon slugs onto glyphs. */
export const sceneIconGlyph: Record<string, string> = {
  film: '🎬',
  sunrise: '🌅',
  moon: '🌙',
  shield: '🛡',
  target: '🎯',
  leaf: '🌿',
  music: '🎵',
  dinner: '🍽',
  bath: '🛁',
  work: '💻',
  away: '🚗',
  party: '🎉',
  relax: '🧘',
};

export function glyphForScene(icon: string): string {
  return sceneIconGlyph[icon] ?? '✦';
}