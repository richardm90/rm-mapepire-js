// Mock the logger
jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
  },
}));