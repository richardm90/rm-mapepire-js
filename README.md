# rm-mapepire-js

A TypeScript wrapper over the IBM Mapepire DB2 client for Node.js, providing
connection pooling and management for IBM i databases.

## Installation

```bash
# TODO: Make available publicly

# Development branch
npm install git+ssh://git@bitbucket.org/richardm90/rm-mapepire-js.git#dev

# Stable/production branch
npm install git+ssh://git@bitbucket.org/richardm90/rm-mapepire-js.git#main
```

## Usage

### Basic Setup

```typescript
import { RmPools } from 'rm-mapepire-js';

const poolsConfig = {
  debug: true,
  activate: true,
  pools: [
    {
      id: 'myPool',
      PoolOptions: {
        creds: {
          host: 'your-host',
          user: 'your-user',
          password: 'your-password',
          rejectUnauthorized: false,
        },
        maxSize: 20,
        initialConnections: {
          size: 8,
          expiry: 30 // minutes
        },
        JDBCOptions: {
          libraries: "RMDATA"
        }
      }
    }
  ]
};

const pools = new RmPools(poolsConfig);
await pools.init();
```

### Using a Connection

#### Direct Pool Query (Recommended)

The simplest way to execute queries - the pool automatically handles connection lifecycle:

```typescript
// Get a pool
const pool = await pools.get('myPool');

// Execute a query directly on the pool (auto attach/detach)
const result = await pool.query('SELECT * FROM MY_TABLE');

// With query options
const result = await pool.query('SELECT * FROM MY_TABLE WHERE id = ?', {
  parameters: [123]
});
```

#### Manual Connection Management

For more control, you can manually attach and detach connections:

```typescript
// Get a pool
const pool = await pools.get('myPool');

// Attach a connection
const connection = await pool.attach();

// Execute a query
const result = await connection.query('SELECT * FROM MY_TABLE');

// Detach the connection (return to pool)
await pool.detach(connection);
```

### Configuration Options

#### Pool Options

- `creds`: Database credentials object - a standard Mapepire DaemonServer object
- `maxSize`: Maximum number of connections in the pool (default: 20)
- `initialConnections`: Initial connection settings
  - `size`: Number of connections to create on initialization (default: 8)
  - `expiry`: Connection expiry time in minutes (default: null). Set to `null` or omit for connections that never expire. A value of `0` is treated the same as `null` (no expiry). Only positive values start an expiry timer.
- `incrementConnections`: Settings for dynamically added connections
  - `size`: Number of connections to add when pool is exhausted (default: 8)
  - `expiry`: Expiry time for new connections in minutes (same rules as above)
- `dbConnectorDebug`: Enable debug logging (default: false)
- `JDBCOptions`: JDBC options object - a standard Mapepire JDBCOptions object
- `initCommands`: Array of commands to execute when each connection is initialized. Each entry is an object with `command` (string) and optional `type` (`'cl'` or `'sql'`, defaults to `'cl'`). CL commands are executed via `QCMDEXC` with parameterised input; SQL commands are executed directly via `job.execute()` without parameterisation. **Security note:** SQL-type init commands must be trusted, developer-supplied strings — never pass unsanitised user input as an init command.
- `healthCheck`: Health check settings
  - `onAttach`: Verify connections are alive before returning from `attach()` by executing a lightweight query (`VALUES 1`). Unhealthy connections are automatically retired and replaced. (default: `true`). Set to `false` to disable.
- `logger`: Custom logger object (per-pool override, see Logger below)

#### Pools Options

- `activate`: Auto-activate pools on registration (default: true)
- `debug`: Enable debug logging (default: false)
- `pools`: Array of pool configurations
- `logger`: Custom logger object implementing the `Logger` interface. Flows down to all pools and connections. Defaults to a built-in console logger.

#### Logger

All classes accept an optional `logger` that implements the `Logger` interface:

```typescript
interface Logger {
  log(level: string, message: string, meta?: any): void;
}
```

The logger flows down from `RmPools` → `RmPool` → `RmPoolConnection` → `RmConnection`. You can set it at the top level or per-pool:

```typescript
import { RmPools } from 'rm-mapepire-js';

// Custom logger (e.g. winston, pino, or any object with a log method)
const myLogger = {
  log(level, message, meta) {
    // Send to your logging infrastructure
    console.log(`[${level}] ${message}`, meta);
  }
};

const pools = new RmPools({
  logger: myLogger,  // All pools and connections use this logger
  pools: [{ id: 'myPool', PoolOptions: { creds: { ... } } }]
});
```

For standalone connections (without pools):

```typescript
import { RmConnection } from 'rm-mapepire-js';

const conn = new RmConnection(creds, jdbcOptions, [], false, myLogger);
await conn.init();
```

## API Reference

### RmPools

Main class for managing multiple connection pools.

#### Methods

- `init()`: Initialize all registered pools
- `register(poolConfig)`: Register a new pool configuration
- `get(poolId?)`: Get a pool by ID (returns first pool if ID not provided)
- `attach(pool)`: Attach a connection from the pool
- `close()`: Close all active pools and mark them inactive
- `connectionDiag(poolId, connection, sql)`: Log connection diagnostics
- `getInfo()`: Get information about all pools for debugging
- `printInfo()`: Print all pools info to console
- `printStats()`: Print summary statistics for all pools

### RmPool

Manages a pool of database connections. Extends `EventEmitter`.

#### Methods

- `init()`: Initialize the pool with initial connections
- `query(sql, opts?)`: Execute a SQL query using a connection from the pool (automatically handles attach/detach)
- `attach()`: Get an available connection from the pool
- `detach(connection)`: Return a connection to the pool
- `retire(connection)`: Remove a connection from the pool permanently
- `detachAll()`: Return all connections to the pool
- `retireAll()`: Remove all connections from the pool
- `close()`: Close all connections in the pool (alias for `retireAll()`)
- `getInfo()`: Get detailed pool information for debugging
- `getStats()`: Get pool statistics summary
- `printInfo()`: Print detailed pool information to console
- `printStats()`: Print pool statistics to console

#### Events

- `pool:initialized` — Pool init complete. Payload: `{ poolId, connections }`
- `connection:created` — New connection added. Payload: `{ poolId, poolIndex, jobName }`
- `connection:attached` — Connection handed to consumer. Payload: `{ poolId, poolIndex }`
- `connection:detached` — Connection returned to pool. Payload: `{ poolId, poolIndex }`
- `connection:retired` — Connection removed from pool. Payload: `{ poolId, poolIndex }`
- `connection:expired` — Expiry timer fired. Payload: `{ poolId, poolIndex }`
- `connection:healthCheckFailed` — Health check failed before retire. Payload: `{ poolId, poolIndex }`
- `pool:exhausted` — Max connections reached. Payload: `{ poolId, maxSize }`

```typescript
const pool = await pools.get('myPool');
pool.on('connection:created', ({ poolId, poolIndex, jobName }) => {
  console.log(`New connection ${poolIndex} created (job: ${jobName})`);
});
pool.on('pool:exhausted', ({ poolId, maxSize }) => {
  console.warn(`Pool ${poolId} exhausted at ${maxSize} connections`);
});
```

### RmPoolConnection

Represents a single pooled database connection.

#### Methods

- `query(sql, opts?)`: Execute a SQL query
- `detach()`: Mark the connection as available and return it
- `retire()`: Close and retire the connection
- `isAvailable()`: Check if the connection is available
- `isHealthy()`: Check if the underlying connection is still alive (executes `VALUES 1`)
- `getStatus()`: Get the current status of the underlying job
- `getInfo()`: Get connection information for debugging
- `printInfo()`: Print connection info to console

### RmConnection

Represents a standalone database connection (not pooled).

#### Methods

- `init()`: Initialize the connection and connect to the database
- `execute(sql, opts?)`: Execute a SQL statement
- `query(sql, opts?)`: Execute a SQL query (alias for `execute`)
- `close()`: Close the connection
- `getStatus()`: Get the current status of the underlying job
- `getInfo()`: Get connection information for debugging
- `printInfo()`: Print connection info to console

## License

ISC

## Author

Richard Moulton

## Updating to the latest version:

```bash
# In your rm-mapepire-js directory
npm update rm-mapepire-js
```

## Workflow for Updates

When you make changes to your package:

1. Make your code changes
1. Update version in package.json
1. Run tests: `npm test`
1. Build: `npm run build`
1. Commit and push
1. Tag the release: `git tag v1.0.1 && git push origin v1.0.1`
1. Update in consuming projects: `npm update rm-mapepire-js`

## Use `npm link` for Active Development

If you're making frequent changes, npm link is faster:

```bash
# In your rm-mapepire-js directory
npm link

# In your consuming project
npm link rm-mapepire-js
```

Now any changes you make and build in `rm-mapepire-js` are immediately
available.

When done:

```bash
# 1. In your consuming project - removes the symlink
npm unlink rm-mapepire-js

# 2. In your rm-mapepire-js directory - removes the global link
npm unlink

# 3. In your consuming project - reinstall normally
npm install git+ssh://git@bitbucket.org/your-username/rm-mapepire-js.git#dev
```

```bash
# Check if something is linked, in the consuming project
cd test-rm-mapepire-js
ls -l node_modules/ | grep "^l"
```
