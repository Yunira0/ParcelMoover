// Run from rider/: node public/icons/generate-icons.mjs
// Uses macOS sips to resize the supplied artwork without redrawing it.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../../', import.meta.url))
const source = resolve(project, 'assets/icon.png')
const androidResources = resolve(project, 'android/app/src/main/res')

function resize(output, size, canvasSize = size, canvasWidth = canvasSize) {
  mkdirSync(dirname(output), { recursive: true })
  execFileSync('sips', ['--resampleHeightWidth', String(size), String(size), source, '--out', output], { stdio: 'pipe' })
  if (canvasSize !== size || canvasWidth !== size) {
    execFileSync('sips', ['--padToHeightWidth', String(canvasSize), String(canvasWidth), '--padColor', 'FFFFFF', output], { stdio: 'pipe' })
  }
}

// Logo size on the launch screen, in dp. Android 12+ draws the splash icon on a
// 240dp canvas and clips it to a 160dp circle, so 128dp keeps the rounded
// square's corners inside the mask.
const SPLASH_LOGO_DP = 128
// Legacy (pre-Android 12) full-screen splash canvases, in px per density.
const LEGACY_SPLASH = {
  mdpi: [480, 320],
  hdpi: [800, 480],
  xhdpi: [1280, 720],
  xxhdpi: [1600, 960],
  xxxhdpi: [1920, 1280],
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

    // Android 12+ system splash icon (styles.xml windowSplashScreenAnimatedIcon).
    resize(resolve(androidResources, `drawable-${density}/splash_icon.png`), SPLASH_LOGO_DP * scale, 240 * scale)

    // Pre-Android 12 splash and the launch theme's window background.
    const [long, short] = LEGACY_SPLASH[density]
    const logo = SPLASH_LOGO_DP * scale
    resize(resolve(androidResources, `drawable-port-${density}/splash.png`), logo, long, short)
    resize(resolve(androidResources, `drawable-land-${density}/splash.png`), logo, short, long)
  }
  resize(resolve(androidResources, 'drawable/splash.png'), SPLASH_LOGO_DP, 320, 480)
}

console.log('Updated PWA icons and all available Android launcher icon and splash densities.')
