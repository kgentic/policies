/** Convert a glob pattern to a RegExp for policy path matching. Returns a case-sensitive RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let result = '^';

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];
    const afterNext = pattern[i + 2];

    if (char === '*' && next === '*') {
      if (afterNext === '/') {
        // `**/` — match zero or more path segments (including none)
        result += '(.*/)?';
        i += 2; // skip both '*' and '/'
      } else {
        // `**` at end of pattern — match anything
        result += '.*';
        i += 1; // skip second '*'
      }
      continue;
    }

    if (char === '*') {
      result += '[^/]*';
      continue;
    }

    if (char !== undefined) {
      result += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }

  result += '$';
  return new RegExp(result);
}

/** Test whether a value matches a glob pattern. */
export function matchesGlob(value: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }

  return globToRegExp(pattern).test(value);
}
