# Debugging and Monitoring Guide

This guide shows you how to use the built-in debug and monitoring features in `rm-mapepire-js`.

## Quick Start

```typescript
import { RmPools } from 'rm-mapepire-js';

const pools = new RmPools({
  debug: true,  // Enable debug logging
  pools: [{
    id: 'myPool',
    PoolOptions: {
      creds: { host: 'myhost', user: 'user', password: 'pass' },
      maxSize: 20,
      initialConnections: { size: 5 }
    }
  }]
});

await pools.init();

// Quick overview of all pools
pools.printStats();

// Detailed information
pools.printInfo();
```

## Available Methods

### Connection Level (`RmPoolConnection`)

#### `getInfo(): object`
Returns detailed connection information as an object.

```typescript
const pool = await pools.get('myPool');
const conn = await pool.attach();

const info = conn.getInfo();
console.log(info);
// {
//   poolId: 'myPool',
//   poolIndex: 1,
//   jobName: '123456/USER/QZDASOINIT',
//   available: false,
//   status: 'ready',
//   hasExpiryTimer: false,
//   expiry: null
// }
```

#### `printInfo(): void`
Prints connection information to the console.

```typescript
conn.printInfo();
// Connection Info: {
//   "poolId": "myPool",
//   "poolIndex": 1,
//   ...
// }
```

### Pool Level (`RmPool`)

#### `getInfo(): object`
Returns detailed pool information including all connections.

```typescript
const pool = await pools.get('myPool');
const info = pool.getInfo();
console.log(info);
// {
//   id: 'myPool',
//   totalConnections: 5,
//   availableConnections: 3,
//   busyConnections: 2,
//   maxSize: 20,
//   connections: [...]
// }
```

#### `getStats(): object`
Returns summary statistics about the pool.

```typescript
const stats = pool.getStats();
console.log(stats);
// {
//   id: 'myPool',
//   total: 5,
//   available: 3,
//   busy: 2,
//   maxSize: 20,
//   utilizationPercent: '25.0'
// }
```

#### `printInfo(): void`
Prints detailed pool information to the console.

```typescript
pool.printInfo();
//
// === Pool Info ===
// Pool ID: myPool
// Total Connections: 5/20
// Available: 3
// Busy: 2
//
// Connections:
//   [0] Job: 123456/USER/QZDASOINIT | Available: true | Status: ready
//   [1] Job: 123457/USER/QZDASOINIT | Available: false | Status: busy
//   ...
// =================
```

#### `printStats(): void`
Prints summary statistics to the console.

```typescript
pool.printStats();
//
// myPool:
//   Connections: 2/5 busy (25.0% utilized)
//   Available: 3
//   Max Size: 20
```

### Pools Level (`RmPools`)

#### `getInfo(): object`
Returns information about all registered pools.

```typescript
const info = pools.getInfo();
console.log(info);
// {
//   totalPools: 2,
//   activePools: 2,
//   pools: [
//     {
//       id: 'myPool',
//       active: true,
//       total: 5,
//       available: 3,
//       ...
//     },
//     ...
//   ]
// }
```

#### `printInfo(): void`
Prints detailed information about all pools.

```typescript
pools.printInfo();
//
// ╔════════════════════════════════════════╗
// ║         POOLS OVERVIEW                 ║
// ╚════════════════════════════════════════╝
//
// Total Pools: 2
// Active Pools: 2
//
// [0] Pool: myPool (ACTIVE)
// === Pool Info ===
// ...
```

#### `printStats(): void`
Prints summary statistics for all pools.

```typescript
pools.printStats();
//
// ┌─────────────────────────────────────────┐
// │         POOLS STATISTICS                │
// └─────────────────────────────────────────┘
//
// myPool:
//   Connections: 2/5 busy (25.0% utilized)
//   Available: 3
//   Max Size: 20
//
// secondaryPool:
//   Connections: 1/3 busy (15.0% utilized)
//   Available: 2
//   Max Size: 10
```

## Usage Patterns

### Monitor During Development

```typescript
// Setup
const pools = new RmPools({ debug: true, pools: [...] });
await pools.init();

// Before a critical operation
console.log('Before operation:');
pools.printStats();

// Perform operation
const pool = await pools.get('myPool');
const conn = await pool.attach();
await conn.query('SELECT * FROM LARGE_TABLE');
await pool.detach(conn);

// After operation
console.log('After operation:');
pools.printStats();
```

### Check Pool Health

```typescript
function checkPoolHealth(pool: RmPool): void {
  const stats = pool.getStats() as any;

  if (parseInt(stats.utilizationPercent) > 80) {
    console.warn(`⚠️  Pool ${stats.id} is ${stats.utilizationPercent}% utilized`);
  }

  if (stats.available === 0) {
    console.error(`❌ Pool ${stats.id} has no available connections!`);
  }
}

const pool = await pools.get('myPool');
checkPoolHealth(pool);
```

### Debug Connection Issues

```typescript
const pool = await pools.get('myPool');

try {
  const conn = await pool.attach();
  console.log('Got connection:', conn.getInfo());

  await conn.query('SELECT * FROM TEST');

  await pool.detach(conn);
  console.log('Connection detached');
} catch (error) {
  console.error('Error occurred');
  pool.printInfo(); // See current state
  throw error;
}
```

### Periodic Monitoring

```typescript
// Log stats every 30 seconds
setInterval(() => {
  console.clear();
  console.log(`[${new Date().toISOString()}]`);
  pools.printStats();
}, 30000);
```

### Export to Monitoring System

```typescript
// Get data in JSON format for external monitoring
function exportMetrics() {
  const poolsInfo = pools.getInfo() as any;

  return {
    timestamp: new Date().toISOString(),
    pools: poolsInfo.pools.map((p: any) => ({
      name: p.id,
      active: p.active,
      connections_total: p.total,
      connections_available: p.available,
      connections_busy: p.busy,
      utilization: parseFloat(p.utilizationPercent || '0'),
    }))
  };
}

// Send to monitoring service
const metrics = exportMetrics();
// await monitoringService.send(metrics);
```

## Tips

1. **Use `debug: true`** in development to see detailed logs
2. **Use `printStats()`** for quick checks during development
3. **Use `getInfo()`** to integrate with monitoring systems
4. **Check utilization** regularly to optimize pool sizes
5. **Monitor available connections** to prevent exhaustion

## Performance Impact

These debug methods are lightweight and safe to call frequently:
- `getInfo()` and `getStats()` - Very fast, just object creation
- `printInfo()` and `printStats()` - Console output may be slow in some environments
- Use sparingly in high-performance production code