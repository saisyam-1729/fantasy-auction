import { cleanupE2e } from './users'

export default async function globalTeardown() {
  await cleanupE2e()
}
