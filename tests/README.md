# Tests

This directory contains the test suite for rm-mapepire-js.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Structure

- `setup.ts` - Test setup and mocks for external dependencies
- `rmPoolConnection.test.ts` - Unit tests for connection management
- `rmPool.test.ts` - Unit tests for pool management
- `rmPools.test.ts` - Unit tests for multi-pool management
- `integration.test.ts` - Integration tests for full workflows

## Test Coverage Goals

- Aim for >80% code coverage
- All public methods should have unit tests
- Integration tests should cover common workflows
- Error cases should be tested

## Mocking Strategy

The tests mock `@ibm/mapepire-js` since we don't have an actual IBM i database connection during testing. This allows us to test the pool management logic without requiring a real database.

For true integration testing with a real IBM i system, you would need to:
1. Set up a test IBM i environment
2. Create separate integration tests that skip the mocks
3. Use environment variables to configure real credentials