import * as claude from './claude.js';

export type ClientName = 'claude' | 'cursor' | 'windsurf';

export type Adapter = typeof claude;

const CLIENT_NAMES: ReadonlySet<string> = new Set<ClientName>(['claude', 'cursor', 'windsurf']);

export function isClientName(value: string): value is ClientName {
  return CLIENT_NAMES.has(value);
}

export function getAdapter(client: ClientName): Adapter {
  switch (client) {
    case 'claude':
      return claude;
    case 'cursor':
    case 'windsurf':
      throw new Error(`Client "${client}" is not yet supported. Currently supported: claude`);
  }
}
