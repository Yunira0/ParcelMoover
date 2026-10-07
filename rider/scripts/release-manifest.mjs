#!/usr/bin/env node
// Release helper for the PM Rider APK, used by .github/workflows/rider-release.yml
// (and runnable locally to preview a release).
//
//   node scripts/release-manifest.mjs check rider-v1.4.0
//     Fails unless the tag matches package.json "version" and CHANGELOG.md has
//     a section with at least one bullet for that version.
//
//   node scripts/release-manifest.mjs build --apk <file> --tag rider-v1.4.0 \
//        --repo Yunira0/ParcelMoover --out <dir>
//     Writes <dir>/update.json (read by the app, see src/lib/appUpdater.ts)
//     and <dir>/release-notes.md (the GitHub Release body).
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

function fail(msg) {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

// Must match android/app/build.gradle.
export function versionCodeOf(v) {
  const parts = String(v).split('.').map(Number)
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 99)) {
    fail(`Version must be MAJOR.MINOR.PATCH with each part 0-99, got "${v}"`)
  }
  return parts[0] * 10000 + parts[1] * 100 + parts[2]
}

function parseChangelog() {
  const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  const sections = []
  let current = null
  let inFence = false
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) { inFence = !inFence; continue }
    if (inFence) continue
    const h = line.match(/^##\s+(\d+\.\d+\.\d+)\b(.*)$/)
    if (h) {
      current = { version: h[1], required: /\(required\)/i.test(h[2]), date: (h[2].match(/\d{4}-\d{2}-\d{2}/) ?? [''])[0], notes: [] }
      sections.push(current)
      continue
    }
    if (!current) continue
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) current.notes.push(bullet[1].trim())
    else if (/^\s{2,}\S/.test(line) && current.notes.length) {
      current.notes[current.notes.length - 1] += ` ${line.trim()}` // wrapped bullet
    }
  }
  return sections
}

// Riders see these as plain text - drop markdown emphasis/code markers.
const plain = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[(.+?)\]\(.+?\)/g, '$1')

function sectionFor(v) {
  const s = parseChangelog().find((x) => x.version === v)
  if (!s) fail(`CHANGELOG.md has no "## ${v}" section - add one with the rider-facing changes`)
  if (s.notes.length === 0) fail(`CHANGELOG.md section ${v} has no "- " bullets`)
  return s
}

function check(tag) {
  if (!tag) fail('Usage: release-manifest.mjs check <tag>')
  if (tag !== `rider-v${version}`) {
    fail(`Tag "${tag}" does not match rider/package.json version ${version} (expected rider-v${version})`)
  }
  versionCodeOf(version)
  sectionFor(version)
  console.log(`✔ rider-v${version} (versionCode ${versionCodeOf(version)}) is ready to release`)
}

function build(args) {
  const opt = (name) => {
    const i = args.indexOf(`--${name}`)
    if (i === -1 || !args[i + 1]) fail(`Missing --${name}`)
    return args[i + 1]
  }
  const apk = opt('apk'), tag = opt('tag'), repo = opt('repo'), out = opt('out')
  check(tag)
  const section = sectionFor(version)
  const versionCode = versionCodeOf(version)

  // Lowest version still allowed to run = newest "(required)" release so far.
  const requiredCodes = parseChangelog()
    .filter((s) => s.required && versionCodeOf(s.version) <= versionCode)
    .map((s) => versionCodeOf(s.version))
  const minSupportedVersionCode = requiredCodes.length ? Math.max(...requiredCodes) : 0

  const bytes = readFileSync(apk)
  const assetName = `pm-rider-${version}.apk`
  const manifest = {
    versionName: version,
    versionCode,
    minSupportedVersionCode,
    publishedAt: new Date().toISOString(),
    // Pinned to this tag (not "latest") so the manifest and APK always match.
    apkUrl: `https://github.com/${repo}/releases/download/${tag}/${assetName}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: statSync(apk).size,
    notes: section.notes.map(plain),
  }

  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'update.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(out, 'release-notes.md'), [
    `## What's new in PM Rider ${version}`,
    '',
    ...section.notes.map((n) => `- ${n}`),
    '',
    ...(section.required ? ['**Required update** — older versions must update to keep working.', ''] : []),
    '### Install',
    `Riders with PM Rider 1.4.0 or newer get this automatically from the in-app popup.`,
    `First install: download \`${assetName}\` below on the phone and open it.`,
    '',
    `SHA-256: \`${manifest.sha256}\``,
    '',
  ].join('\n'))
  console.log(JSON.stringify(manifest, null, 2))
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'check') check(rest[0])
else if (cmd === 'build') build(rest)
else fail('Usage: release-manifest.mjs check <tag> | build --apk <file> --tag <tag> --repo <owner/name> --out <dir>')
