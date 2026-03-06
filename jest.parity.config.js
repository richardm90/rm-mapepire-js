/**
 * Jest config for backend parity tests.
 *
 * These tests connect to a real IBM i system and compare output between
 * the mapepire and idb backends. They are NOT run as part of `npm test`.
 *
 * Usage:
 *   IBMI_HOST=myibmi.com IBMI_USER=MYUSER IBMI_PASSWORD=MYPASS npm run test:parity
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/backend-parity.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
};
