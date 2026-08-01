/**
 * Loads the monorepo-root .env BEFORE any other module reads process.env.
 *
 * ESM evaluates imports in order, and several modules build their config at
 * import time (tools -> aristotle, tokengate, xbot). Import this module first in
 * the entrypoint so those see .env values. Real environment variables (Railway)
 * always win — dotenv does not override them.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../.env") });

export const ROOT = resolve(here, "../../../");
