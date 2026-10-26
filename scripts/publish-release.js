#!/usr/bin/env node
'use strict';

/**
 * Sends release-notes.json to the release server so the Update page and the
 * mobile app show it. Run by the GitHub Action on a version tag, or by hand:
 *
 *   HUB_URL=https://your-server.onrender.com node scripts/publish-release.js [--draft]
 *
 * Checks that package.json and release-notes.json name the same version, and
 * (when GITHUB_REF_NAME is set) that the tag is <prefix><version>.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const notes = JSON.parse(fs.readFileSync(path.join(root, 'release-notes.json'), 'utf8'));
const prefix = process.env.UPDATE_TAG_PREFIX || 'v';
const draft = process.argv.includes('--draft');

function fail(msg) {
  console.error(`publish-release: ${msg}`);
  process.exit(1);
}

if (notes.version !== pkg.version) fail(`release-notes.json is for ${notes.version} but package.json says ${pkg.version}`);
const tag = process.env.GITHUB_REF_NAME || `${prefix}${pkg.version}`;
if (tag !== `${prefix}${pkg.version}`) fail(`tag ${tag} does not match version ${pkg.version} (expected ${prefix}${pkg.version})`);

const { HUB_URL } = process.env;
if (!HUB_URL) fail('set HUB_URL');

const body = {
  ...notes,
  tag,
  commit: process.env.GITHUB_SHA || undefined,
  status: draft ? 'draft' : 'published',
  publishedBy: process.env.GITHUB_ACTOR || process.env.USER || 'release script',
};

fetch(`${HUB_URL.replace(/\/+$/, '')}/api/v1/apps/${notes.appId || 'nextup_react'}/releases/${pkg.version}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'X-User-Name': body.publishedBy },
  body: JSON.stringify(body),
}).then(async (res) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) fail(`server answered ${res.status}: ${data.error || ''}`);
  console.log(`Published ${notes.appId} ${pkg.version} (${body.status}).${data.linkedBugs?.length ? ` Marked fixed: ${data.linkedBugs.join(', ')}` : ''}`);
}).catch((err) => fail(err.message));
