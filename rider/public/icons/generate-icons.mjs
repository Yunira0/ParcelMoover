// Run from rider/: node public/icons/generate-icons.mjs
// Uses macOS sips to resize the supplied artwork without redrawing it.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../../', import.meta.url))
const source = resolve(project, 'assets/icon.png')
const androidResources = resolve(project, 'android/app/src/main/res')

function resize(output, size, canvasSize = size) {
  mkdirSync(dirname(output), { recursive: true })
  execFileSync('sips', ['--resampleHeightWidth', String(size), String(size), source, '--out', output], { stdio: 'pipe' })
  if (canvasSize !== size) {
    execFileSync('sips', ['--padToHeightWidth', String(canvasSize), String(canvasSize), '--padColor', 'FFFFFF', output], { stdio: 'pipe' })
  }
}

for (const size of [192, 512]) {
  resize(resolve(project, `public/icons/icon-${size}.png`), size)
}

if (existsSync(androidResources)) {
  for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    const folder = resolve(androidResources, `mipmap-${density}`)
    resize(resolve(folder, 'ic_launcher.png'), 48 * scale)
    resize(resolve(folder, 'ic_launcher_round.png'), 48 * scale)
    // Keep the rider artwork inside the adaptive icon's central safe zone.
    // Android applies the launcher's circle or rounded-square mask itself.
    resize(resolve(folder, 'ic_launcher_foreground.png'), 72 * scale, 108 * scale)
  }
}

console.log('Updated PWA icons and all available Android launcher icon densities.')
