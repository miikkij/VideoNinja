const fs = require('node:fs/promises');
const path = require('node:path');

function desktopQuote(value) {
  if (
    typeof value !== 'string' ||
    !path.posix.isAbsolute(value) ||
    value.includes('=') ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    throw new Error('An absolute application path without control characters or = is required.');
  }
  // Desktop strings are unescaped first; Exec argument quoting is a second layer.
  const quoted = value.replace(/([\\"`$])/g, '\\$1').replace(/%/g, '%%');
  return `"${quoted.replace(/\\/g, '\\\\')}"`;
}

function desktopEntry(source) {
  const values = Object.create(null);
  let selected = false;
  for (const line of source.split(/\r?\n/)) {
    const text = line.trim();
    if (text.startsWith('[')) {
      selected = text === '[Desktop Entry]';
      continue;
    }
    if (!selected || !text || text.startsWith('#')) continue;
    const separator = text.indexOf('=');
    if (separator > 0) values[text.slice(0, separator).trim()] = text.slice(separator + 1).trim();
  }
  return values;
}

function createStartup(
  app,
  { platform = process.platform, env = process.env, filesystem = fs } = {},
) {
  const configRoot =
    env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : path.join(app.getPath('home'), '.config');
  const desktopFile = path.join(configRoot, 'autostart', 'videoninja.desktop');
  const executable = env.APPIMAGE || app.getPath('exe');
  const loginOptions = () => {
    const options = { name: 'VideoNinja' };
    if (platform === 'win32') {
      const portablePath = env.PORTABLE_EXECUTABLE_FILE;
      if (
        portablePath !== undefined &&
        (typeof portablePath !== 'string' ||
          !path.win32.isAbsolute(portablePath) ||
          path.win32.parse(portablePath).root.length < 3 ||
          portablePath.includes('"') ||
          [...portablePath].some(
            (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          ))
      ) {
        throw new Error('The portable application requires an absolute executable path.');
      }
      // The portable app's process executable lives in a temporary extraction folder.
      options.path = portablePath || app.getPath('exe');
      options.args = [];
    }
    return options;
  };
  return {
    async isEnabled() {
      if (!app.isPackaged) return false;
      if (platform !== 'linux')
        return Boolean(app.getLoginItemSettings(loginOptions()).openAtLogin);
      try {
        const entry = desktopEntry(await filesystem.readFile(desktopFile, 'utf8'));
        return (
          entry['X-VideoNinja'] === 'true' &&
          entry.Type === 'Application' &&
          Boolean(entry.Exec) &&
          entry.Hidden !== 'true' &&
          entry['X-GNOME-Autostart-enabled'] !== 'false'
        );
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    },
    async setEnabled(enabled) {
      if (!app.isPackaged) throw new Error('Start at login requires an installed application.');
      if (platform !== 'linux') {
        const options = loginOptions();
        app.setLoginItemSettings({
          path: app.getPath('exe'),
          ...options,
          openAtLogin: enabled,
        });
        const actual = Boolean(app.getLoginItemSettings(options).openAtLogin);
        if (actual !== enabled)
          throw new Error('The operating system did not change start at login.');
        return actual;
      }
      if (enabled) {
        const command = desktopQuote(executable);
        try {
          if (
            desktopEntry(await filesystem.readFile(desktopFile, 'utf8'))['X-VideoNinja'] !== 'true'
          ) {
            throw new Error('The existing autostart entry belongs to another application.');
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await filesystem.mkdir(path.dirname(desktopFile), { recursive: true });
        await filesystem.writeFile(
          desktopFile,
          `[Desktop Entry]\nType=Application\nName=VideoNinja\nExec=${command}\nTerminal=false\nX-VideoNinja=true\n`,
          { mode: 0o600 },
        );
      } else {
        try {
          // Only remove the autostart entry created by this application.
          if (
            desktopEntry(await filesystem.readFile(desktopFile, 'utf8'))['X-VideoNinja'] === 'true'
          ) {
            await filesystem.unlink(desktopFile);
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      return enabled;
    },
  };
}

module.exports = { createStartup, desktopQuote };
