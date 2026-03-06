// Mock idb-pconnector (used by idb backend on IBM i)
jest.mock('idb-pconnector');

// Mock the logger
jest.mock('../src/logger', () => {
  const actual = jest.requireActual('../src/logger');
  return {
    __esModule: true,
    default: {
      log: jest.fn(),
    },
    RmLogger: actual.RmLogger,
  };
});
