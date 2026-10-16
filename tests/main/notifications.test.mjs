import { describe, it, expect, vi } from 'vitest';
import notificationModule from '../../src/main/notifications.js';

describe('grouped native notifications', () => {
  it('groups completions/failures without leaking titles and skips private jobs', () => {
    const shown = [],
      callbacks = [];
    class Notice {
      static isSupported() {
        return true;
      }
      constructor(options) {
        this.options = options;
      }
      on() {}
      show() {
        shown.push(this.options);
      }
    }
    const service = notificationModule.createNotifications({
      Notification: Notice,
      getSettings: () => ({ notifications: true, language: 'fi' }),
      showWindow: vi.fn(),
      setTimer: (fn) => {
        callbacks.push(fn);
        return 1;
      },
      clearTimer: vi.fn(),
    });
    service.record('completed', { title: 'private title' });
    service.record('failed', {});
    service.record('completed', { private: true });
    expect(callbacks).toHaveLength(1);
    callbacks[0]();
    expect(shown).toHaveLength(1);
    expect(shown[0].body).toBe('1 latausta valmistui, 1 epäonnistui.');
  });
});
