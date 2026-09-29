/** Load scripts/update-data.config.json as defaults for the updater process.
 * Existing nonblank environment variables always win, so local CLI overrides work.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const configPath = fileURLToPath(new URL('./update-data.config.json', import.meta.url));
const defaults = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
for (const [key, value] of Object.entries(defaults)) {
  const current = process.env[key];
  if ((current === undefined || current.trim() === '') && value !== null && value !== undefined) {
    process.env[key] = String(value);
  }
}
