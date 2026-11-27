// Runs with the packaged Electron executable in Node mode; no app/profile/credential access.
const path = require('node:path')
const file = process.argv[2]
;(async () => {
  const probe = require(path.join(file, 'dist/main/integrations/pi/piSdk.js'))
  const report = await probe.inspectPiSdkSurface()
  console.log(JSON.stringify({ packagedAsar: file, ...report }))
  process.exitCode = report.loaded ? 0 : 1
})().catch(error => { console.error(error.stack); process.exitCode = 1 })
