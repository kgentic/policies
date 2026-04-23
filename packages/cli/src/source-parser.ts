export interface ParsedSource {
  type: 'github';
  source: string;
  ref: string;
}

export function parseSource(input: string): ParsedSource {
  const hashIndex = input.indexOf('#');
  if (hashIndex !== -1) {
    return {
      type: 'github',
      source: input.slice(0, hashIndex),
      ref: input.slice(hashIndex + 1),
    };
  }
  return { type: 'github', source: input, ref: 'main' };
}
