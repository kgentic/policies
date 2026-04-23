export function exitError(message: string): never {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function outputText(text: string): void {
  console.log(text);
}
