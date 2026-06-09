const fs   = require('fs-extra')
const os   = require('os')

const HOSTS_PATH = process.platform === 'win32'
  ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
  : '/etc/hosts'

const SECTION_START = '# --- WP Studio ---'
const SECTION_END   = '# --- End WP Studio ---'

async function readHosts() {
  try {
    return await fs.readFile(HOSTS_PATH, 'utf8')
  } catch (err) {
    throw new Error(`Cannot read hosts file at ${HOSTS_PATH}: ${err.message}`)
  }
}

async function writeHosts(content) {
  try {
    await fs.writeFile(HOSTS_PATH, content, 'utf8')
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      throw new Error(
        'Cannot write to hosts file — administrator privileges required. ' +
        'Ensure WP Studio is running as administrator.'
      )
    }
    throw new Error(`Cannot write hosts file: ${err.message}`)
  }
}

// Returns the lines inside the WP Studio section, or [] if section doesn't exist
function parseSectionLines(content) {
  const start = content.indexOf(SECTION_START)
  const end   = content.indexOf(SECTION_END)
  if (start === -1 || end === -1) return []
  return content
    .slice(start + SECTION_START.length, end)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
}

// Rebuilds hosts file with an updated set of WP Studio entries
async function setEntries(entries) {
  let content = await readHosts()

  // Strip existing WP Studio section
  const start = content.indexOf(SECTION_START)
  const end   = content.indexOf(SECTION_END)
  if (start !== -1 && end !== -1) {
    content = content.slice(0, start).trimEnd() + '\n' + content.slice(end + SECTION_END.length)
  }

  if (entries.length === 0) {
    await writeHosts(content.trimEnd() + '\n')
    return
  }

  const section = [
    '',
    SECTION_START,
    ...entries.map(({ ip, domain }) => `${ip}\t${domain}`),
    SECTION_END,
    '',
  ].join('\n')

  await writeHosts(content.trimEnd() + section)
}

async function addEntry(domain, ip = '127.0.0.1') {
  const content = await readHosts()
  const lines   = parseSectionLines(content)

  // Deduplicate
  const filtered = lines.filter(l => !l.includes(domain))
  filtered.push(`${ip}\t${domain}`)

  const allEntries = filtered.map(l => {
    const [entryIp, entryDomain] = l.split(/\s+/)
    return { ip: entryIp, domain: entryDomain }
  })

  await setEntries(allEntries)
  console.log(`[Hosts] Added ${ip} → ${domain}`)
}

async function removeEntry(domain) {
  const content = await readHosts()
  const lines   = parseSectionLines(content)

  const remaining = lines
    .filter(l => !l.includes(domain))
    .map(l => {
      const [ip, d] = l.split(/\s+/)
      return { ip, domain: d }
    })
    .filter(e => e.ip && e.domain)

  await setEntries(remaining)
  console.log(`[Hosts] Removed ${domain}`)
}

async function hasEntry(domain) {
  try {
    const content = await readHosts()
    return content.includes(domain)
  } catch {
    return false
  }
}

module.exports = { addEntry, removeEntry, hasEntry }
