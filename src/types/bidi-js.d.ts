declare module 'bidi-js' {
  type Levels = { levels: Uint8Array; paragraphs: { start: number; end: number; level: number }[] }
  export default function bidiFactory(): {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): Levels
    getReorderedIndices(text: string, levels: Levels, start?: number, end?: number): number[]
    getMirroredCharactersMap(text: string, levels: Uint8Array, start?: number, end?: number): Map<number, string>
    getMirroredCharacter(ch: string): string | null
  }
}
