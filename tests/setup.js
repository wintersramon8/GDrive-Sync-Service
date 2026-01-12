// suppress logs during tests
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// increase timeout for integration tests
jest.setTimeout(10000);
