export interface GitHubSource {
  type: 'github';
  source: string;
  ref: string;
}

export interface LocalSource {
  type: 'local';
  path: string;
}

export type ParsedSource = GitHubSource | LocalSource;

function isLocalPath(input: string): boolean {
  return input.startsWith('/') || input.startsWith('./') || input.startsWith('../') || input.startsWith('~');
}

export function parseSource(input: string): ParsedSource {
  if (isLocalPath(input)) {
    return { type: 'local', path: input };
  }

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
