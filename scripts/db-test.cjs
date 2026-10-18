/** Run every database rule test in sequence. Fails if any test file fails. */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, 'db-tests')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cjs')).sort()
let failed = 0
for (const f of files) {
  console.log('\n=== ' + f)
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' })
  if (r.status !== 0) failed++
}
console.log(failed ? '\n' + failed + ' test file(s) FAILED' : '\nall database tests passed')
process.exit(failed ? 1 : 0)
