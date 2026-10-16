// Shared read/write limits keep every successfully saved profile loadable.
const MAX_CONFIG_BYTES = 32 * 1024 * 1024;
const MAX_PRIVATE_PAYLOAD_BYTES = 20 * 1024 * 1024;

module.exports = { MAX_CONFIG_BYTES, MAX_PRIVATE_PAYLOAD_BYTES };
