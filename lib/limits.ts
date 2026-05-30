export const MAX_SCRIPT_CHARACTERS = 100_000;
export const MAX_SCRIPT_FILE_BYTES = 512_000;

export function formatCharacterLimit(limit = MAX_SCRIPT_CHARACTERS) {
  return limit.toLocaleString();
}
