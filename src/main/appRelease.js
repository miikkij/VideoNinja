const MAX_NOTES = 20;
const MAX_NOTE_LENGTH = 600;

function versionParts(value) {
  if (
    typeof value !== 'string' ||
    !/^(?:0|[1-9]\d{0,15})(?:\.(?:0|[1-9]\d{0,15})){2}$/u.test(value)
  )
    return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function isNewer(candidate, previous) {
  const current = versionParts(candidate),
    before = versionParts(previous);
  if (!current || !before) return false;
  for (let index = 0; index < current.length; index++)
    if (current[index] !== before[index]) return current[index] > before[index];
  return false;
}

function releaseNotes(document, version) {
  const empty = { en: [], fi: [] };
  if (document?.schemaVersion !== 1 || !Array.isArray(document.releases)) return empty;
  const entry = document.releases.slice(0, 100).find((release) => release?.version === version);
  for (const language of ['en', 'fi']) {
    if (!Array.isArray(entry?.notes?.[language])) continue;
    empty[language] = entry.notes[language]
      .slice(0, MAX_NOTES)
      .filter((note) => typeof note === 'string' && note.trim())
      .map((note) => note.trim().slice(0, MAX_NOTE_LENGTH));
  }
  return empty;
}

/** Track observed installed releases separately from preferences or update availability. */
function createAppRelease({
  version,
  installed = true,
  notes,
  load = () => null,
  save = () => {},
}) {
  if (!versionParts(version)) throw new Error('Invalid application release version.');
  const currentNotes = releaseNotes(notes, version);
  let state = { version, previousVersion: null, acknowledged: false };

  if (installed) {
    let previous;
    try {
      previous = load();
    } catch {
      // An optional release notice must not prevent application startup.
    }
    if (previous && typeof previous === 'object' && !Array.isArray(previous)) {
      if (previous.version === version) {
        state.previousVersion = isNewer(version, previous.previousVersion)
          ? previous.previousVersion
          : null;
        state.acknowledged = previous.acknowledged === true;
      } else if (isNewer(version, previous.version)) state.previousVersion = previous.version;
    }
    if (
      previous?.version !== state.version ||
      previous?.previousVersion !== state.previousVersion ||
      previous?.acknowledged !== state.acknowledged
    ) {
      try {
        save({ ...state });
      } catch {
        // Keep an unacknowledged notice in memory. Explicit acknowledgement must
        // still report a write failure instead of pretending it was remembered.
      }
    }
  }

  function getState() {
    return {
      version,
      previousVersion: state.previousVersion,
      showNotice: Boolean(installed && !state.acknowledged),
      notes: { en: [...currentNotes.en], fi: [...currentNotes.fi] },
    };
  }

  function acknowledge(requestedVersion) {
    if (!installed) throw new Error('Release acknowledgement requires an installed application.');
    if (requestedVersion !== version)
      throw new Error('Only the current release can be acknowledged.');
    if (!state.acknowledged) {
      const next = { ...state, acknowledged: true };
      save({ ...next });
      state = next;
    }
    return { acknowledged: true };
  }

  return { getState, acknowledge };
}

module.exports = { createAppRelease };
