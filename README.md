# rm-mapepire-js

A TypeScript wrapper over the IBM Mapepire DB2 client for Node.js, providing
connection pooling and management for IBM i databases.

## Installation

```bash
npm install rm-mapepire-js
```

## Usage

### Basic Setup

```typescript
import { rmPools } from 'rm-mapepire-js';

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
          password: 'your-password'
        },
        maxSize: 20,
        initialConnections: {
          size: 8,
          expiry: 30 // minutes
        }
      }
    }
  ]
};

const pools = new rmPools(poolsConfig);
await pools.init();
```

### Using a Connection

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
  - `expiry`: Connection expiry time in minutes (default: null)
- `incrementConnections`: Settings for dynamically added connections
  - `size`: Number of connections to add when pool is exhausted (default: 8)
  - `expiry`: Expiry time for new connections in minutes
- `dbConnectorDebug`: Enable debug logging (default: false)
- `JDBCOptions`: JDBC options object - a standard Mapepire JDBCOptions object
- `envvars`: Array of environment variables to set for each connection

## API Reference

### rmPools

Main class for managing multiple connection pools.

#### Methods

- `init()`: Initialize all registered pools
- `register(poolConfig)`: Register a new pool configuration
- `get(poolId?)`: Get a pool by ID (returns first pool if ID not provided)
- `attach(pool)`: Attach a connection from the pool
- `connectionDiag(poolId, connection, sql)`: Log connection diagnostics

### rmPool

Manages a pool of database connections.

#### Methods

- `init()`: Initialize the pool with initial connections
- `attach()`: Get an available connection from the pool
- `detach(connection)`: Return a connection to the pool
- `retire(connection)`: Remove a connection from the pool permanently
- `detachAll()`: Return all connections to the pool
- `retireAll()`: Remove all connections from the pool

### rmPoolConnection

Represents a single database connection.

#### Methods

- `query(sql, opts?)`: Execute a SQL query
- `detach()`: Mark the connection as available
- `retire()`: Close and retire the connection
- `isAvailable()`: Check if the connection is available

## License

ISC

## Author

Richard Moulton