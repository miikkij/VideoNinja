import { describe, it, expect, vi } from 'vitest';
import startup from '../../src/main/startup.js';
const { createStartup, desktopQuote } = startup;

describe('start at login', () => {
  it('does not register a development Electron executable', async () => {
    const app = { isPackaged: false, getPath: () => '/home/user', setLoginItemSettings: vi.fn() };
    const service = createStartup(app, { platform: 'win32', env: {} });
    expect(await service.isEnabled()).toBe(false);
    await expect(service.setEnabled(true)).rejects.toThrow('installed');
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });
  it('surfaces a native registration failure', async () => {
    const app = {
      isPackaged: true,
      getPath: () => '/app',
      setLoginItemSettings: vi.fn(),
      getLoginItemSettings: () => ({ openAtLogin: false }),
    };
    await expect(
      createStartup(app, { platform: 'win32', env: {} }).setEnabled(true),
    ).rejects.toThrow();
  });
  it('registers and queries the stable Windows portable executable with identical arguments', async () => {
    let enabled = false;
    const app = {
      isPackaged: true,
      getPath: () => 'C:\\Temp\\portable-extract\\VideoNinja.exe',
      setLoginItemSettings: vi.fn((options) => {
        enabled = options.openAtLogin;
      }),
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: enabled })),
    };
    const executable = 'C:\\My Apps\\VideoNinja 1.1.0.exe';
    const service = createStartup(app, {
      platform: 'win32',
      env: { PORTABLE_EXECUTABLE_FILE: executable },
    });
    expect(await service.isEnabled()).toBe(false);
    expect(await service.setEnabled(true)).toBe(true);
    expect(await service.setEnabled(false)).toBe(false);
    for (const [options] of app.getLoginItemSettings.mock.calls)
      expect(options).toEqual({ name: 'VideoNinja', path: executable, args: [] });
    expect(app.setLoginItemSettings.mock.calls.map(([options]) => options)).toEqual([
      { name: 'VideoNinja', path: executable, args: [], openAtLogin: true },
      { name: 'VideoNinja', path: executable, args: [], openAtLogin: false },
    ]);
  });
  it('uses the installed Windows executable when no portable launcher is present', async () => {
    const executable = 'C:\\Program Files\\VideoNinja\\VideoNinja.exe';
    const app = {
      isPackaged: true,
      getPath: () => executable,
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: true })),
    };
    expect(await createStartup(app, { platform: 'win32', env: {} }).isEnabled()).toBe(true);
    expect(app.getLoginItemSettings).toHaveBeenCalledWith({
      name: 'VideoNinja',
      path: executable,
      args: [],
    });
  });
  it.each(['relative.exe', 'C:relative.exe', '\\relative.exe', '', 'C:\\bad\npath.exe'])(
    'refuses invalid portable launcher paths instead of registering a temporary executable: %s',
    async (executable) => {
      const app = {
        isPackaged: true,
        getPath: () => 'C:\\Temp\\VideoNinja.exe',
        setLoginItemSettings: vi.fn(),
        getLoginItemSettings: vi.fn(),
      };
      const service = createStartup(app, {
        platform: 'win32',
        env: { PORTABLE_EXECUTABLE_FILE: executable },
      });
      await expect(service.isEnabled()).rejects.toThrow('absolute');
      await expect(service.setEnabled(true)).rejects.toThrow('absolute');
      expect(app.setLoginItemSettings).not.toHaveBeenCalled();
      expect(app.getLoginItemSettings).not.toHaveBeenCalled();
    },
  );
  it('quotes Linux desktop file arguments without allowing directives', () => {
    expect(desktopQuote('/opt/My App/$test%/app')).toBe('"/opt/My App/\\\\$test%%/app"');
    expect(desktopQuote('/opt/back\\slash/"app"')).toBe('"/opt/back\\\\\\\\slash/\\\\"app\\\\""');
    expect(() => desktopQuote('/app\nHidden=true')).toThrow();
    expect(() => desktopQuote('/app=other')).toThrow();
    expect(() => desktopQuote('relative/app')).toThrow();
  });
  it('only removes its own Linux autostart entry', async () => {
    const filesystem = {
      readFile: vi.fn(async () => '[Desktop Entry]\nName=Other'),
      unlink: vi.fn(),
    };
    const app = { isPackaged: true, getPath: () => '/home/user' };
    await createStartup(app, { platform: 'linux', env: {}, filesystem }).setEnabled(false);
    expect(filesystem.unlink).not.toHaveBeenCalled();
  });
  it.each(['Hidden=true', 'X-GNOME-Autostart-enabled=false'])(
    'recognizes a desktop entry disabled by the OS: %s',
    async (setting) => {
      const filesystem = {
        readFile: vi.fn(
          async () =>
            `[Desktop Entry]\nType=Application\nExec="/app"\nX-VideoNinja=true\n${setting}\n`,
        ),
      };
      const app = { isPackaged: true, getPath: () => '/home/user' };
      expect(await createStartup(app, { platform: 'linux', env: {}, filesystem }).isEnabled()).toBe(
        false,
      );
    },
  );
  it('recognizes an enabled entry and ignores ownership markers outside its section', async () => {
    const filesystem = {
      readFile: vi
        .fn()
        .mockResolvedValueOnce(
          '[Desktop Entry]\nType=Application\nExec="/app"\nX-VideoNinja=true\n',
        )
        .mockResolvedValueOnce(
          '[Desktop Entry]\nType=Application\nExec="/app"\n[Other]\nX-VideoNinja=true\n',
        ),
      unlink: vi.fn(),
    };
    const app = { isPackaged: true, getPath: () => '/home/user' };
    const service = createStartup(app, { platform: 'linux', env: {}, filesystem });
    expect(await service.isEnabled()).toBe(true);
    expect(await service.isEnabled()).toBe(false);
  });
  it('rejects relative APPIMAGE paths before writing an autostart entry', async () => {
    const filesystem = { mkdir: vi.fn(), writeFile: vi.fn() };
    const app = { isPackaged: true, getPath: () => '/home/user' };
    await expect(
      createStartup(app, {
        platform: 'linux',
        env: { APPIMAGE: 'relative.AppImage' },
        filesystem,
      }).setEnabled(true),
    ).rejects.toThrow('absolute');
    expect(filesystem.writeFile).not.toHaveBeenCalled();
  });
  it('does not overwrite an unrelated autostart file when enabling', async () => {
    const filesystem = {
      readFile: vi.fn(async () => '[Desktop Entry]\nName=Other'),
      mkdir: vi.fn(),
      writeFile: vi.fn(),
    };
    const app = { isPackaged: true, getPath: () => '/home/user' };
    await expect(
      createStartup(app, { platform: 'linux', env: {}, filesystem }).setEnabled(true),
    ).rejects.toThrow('another application');
    expect(filesystem.writeFile).not.toHaveBeenCalled();
  });
});
