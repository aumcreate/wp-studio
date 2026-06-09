// Computes SHA-256 checksums for the built Windows installers.
//
// Run after packaging (`npm run build` / `npm run release`). Prints each
// installer's SHA-256 and writes dist-electron/checksums.txt — paste these
// values into the GitHub Release notes so users can verify their download.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const OUT_DIR = path.join(__dirname, '..', 'dist-electron')

function sha256(filePath) {
  const buf = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function main() {
  if (!fs.existsSync(OUT_DIR)) {
    console.error(`[checksums] Output directory not found: ${OUT_DIR}`)
    console.error('[checksums] Build the app first (npm run build).')
    process.exit(1)
  }

  // Hash the user-facing installers only.
  const targets = fs.readdirSync(OUT_DIR).filter(f => /\.(exe|msi|zip)$/i.test(f))
  if (targets.length === 0) {
    console.error('[checksums] No .exe/.msi/.zip artifacts found in dist-electron/.')
    process.exit(1)
  }

  const lines = []
  for (const file of targets) {
    const hash = sha256(path.join(OUT_DIR, file))
    const line = `${hash}  ${file}`
    console.log(line)
    lines.push(line)
  }

  const outFile = path.join(OUT_DIR, 'checksums.txt')
  fs.writeFileSync(outFile, lines.join('\n') + '\n')
  console.log(`\n[checksums] Written to ${outFile}`)
}

main()
