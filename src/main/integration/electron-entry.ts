import path from 'path'
import { app } from 'electron'
import { runWD14TaskIntegration } from './wd14-task.integration'

const userData = process.env.GRIMOIRE_INTEGRATION_USER_DATA
if (!userData) throw new Error('GRIMOIRE_INTEGRATION_USER_DATA is required')
app.setPath('userData', path.resolve(userData))
void app.whenReady().then(() => runWD14TaskIntegration())
