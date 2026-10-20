import type { Site } from '../config/site.mjs';

export interface BuildResult extends Site {
  appHashes: Record<string, string>;
  version: string;
}

export function assembleSite(options: {
  appDir: string;
  landingDir: string;
  output: string;
  site?: Site;
}): Promise<BuildResult>;

export function validatePublic(directory?: string): Promise<void>;

export function buildSite(options?: {
  output?: string;
  landingDir?: string;
  site?: Site;
}): Promise<BuildResult>;
