function createNotifications({
  Notification,
  getSettings,
  showWindow,
  delayMs = 5000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null,
    completed = 0,
    failed = 0;
  function flush() {
    timer = null;
    const counts = { completed, failed };
    completed = 0;
    failed = 0;
    const settings = getSettings();
    if (
      !settings.notifications ||
      !Notification.isSupported() ||
      (!counts.completed && !counts.failed)
    )
      return;
    const fi = settings.language === 'fi';
    const body = fi
      ? `${counts.completed} latausta valmistui, ${counts.failed} epäonnistui.`
      : `${counts.completed} downloads completed, ${counts.failed} failed.`;
    try {
      const notification = new Notification({ title: 'VideoNinja', body, silent: true });
      notification.on('click', showWindow);
      notification.show();
    } catch {
      /* OS notification settings must not affect downloads. */
    }
  }
  return {
    record(kind, job) {
      if (!getSettings().notifications || job?.private) return;
      if (kind === 'completed') completed++;
      else if (kind === 'failed') failed++;
      else return;
      if (!timer) {
        timer = setTimer(flush, delayMs);
        timer?.unref?.();
      }
    },
    dispose() {
      if (timer) clearTimer(timer);
      timer = null;
      completed = 0;
      failed = 0;
    },
  };
}
module.exports = { createNotifications };
