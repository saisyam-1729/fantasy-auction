/**
 * The database URL for scripts and DB tests: the SUPABASE_DB_URL environment
 * variable (CI), else the same name in .env.local (your machine). Never printed.
 */
const fs = require('fs')
const path = require('path')

module.exports = function dbUrl() {
  const fromEnv = process.env.SUPABASE_DB_URL?.trim()
  if (fromEnv) return fromEnv
  const file = path.join(__dirname, '..', '.env.local')
  const m = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m) : null
  if (!m) throw new Error('SUPABASE_DB_URL is not set (environment or .env.local)')
  return m[1].trim().replace(/^["']|["']$/g, '')
}
