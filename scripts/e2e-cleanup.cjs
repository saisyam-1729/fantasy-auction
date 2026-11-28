/**
 * Remove every end-to-end test user (@e2e.invalid) and the rooms they own. Run this if an
 * e2e run was interrupted: npm run e2e:cleanup
 */
const jiti = require('jiti')(__filename)
const { cleanupE2e } = jiti('../e2e/users.ts')

cleanupE2e()
  .then(() => console.log('e2e users and rooms removed'))
  .catch((e) => {
    console.error('FAILED:', String(e.message || e))
    process.exit(1)
  })
