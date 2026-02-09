# rm-mapepire-js - Issues & Enhancements

## Security Issues

### 1. SQL Injection vulnerability (Critical)
- **File:** `src/rmPoolConnection.ts:57`
- **Status:** Resolved
- **Description:** The `message` variable is interpolated directly into an SQL string:
  ```ts
  await this.connection.execute(`CALL SYSTOOLS.LPRINTF('${message}')`);
  ```
  `message` includes `process.env.PROJECT_NAME` and `this.poolId`, both of which come from external input. If either contains a single quote, this breaks the query — and a crafted value could execute arbitrary SQL. The same issue exists on line 63 where `envvar` and `value` are interpolated into a `QCMDEXC` call.

### 2. No input validation on envvar/value (High)
- **File:** `src/rmPoolConnection.ts:63`
- **Status:** Open
- **Description:** Environment variable names and values are passed directly into a `QCMDEXC` call with no sanitization. A malicious value could inject arbitrary IBM i commands.

---

## Bugs

### 3. retire() does not actually close the connection (High)
- **File:** `src/rmPoolConnection.ts:101-115`
- **Status:** Open
- **Description:** The `retire()` method is essentially a no-op. The `close()` call is commented out. Connections are removed from the pool array but never actually closed on the server, leading to leaked IBM i jobs that accumulate until the daemon or system limit is hit.

### 4. Off-by-one in MAX_POOLS check (Medium)
- **File:** `src/rmPools.ts:56`
- **Status:** Open
- **Description:** The condition is `poolsLength >= MAX_POOLS - 1`, which means only 7 pools can ever be registered instead of the intended 8. Should be `>= MAX_POOLS`.

### 5. setExpired() does not await the retire() call (Medium)
- **File:** `src/rmPool.ts:255`
- **Status:** Open
- **Description:** `this.retire(conn)` is async but is called without `await`. If `retire()` throws, the error is silently swallowed as an unhandled promise rejection, and the connection may be left in an inconsistent state.

### 6. attach() can return undefined (Medium)
- **File:** `src/rmPool.ts:221`
- **Status:** Open
- **Description:** If the `while` loop exits without finding a connection (which can happen if all newly created connections are somehow unavailable), the method returns `connection!` where `connection` could still be `undefined`. The non-null assertion hides the problem.

### 7. process.env.PROJECT_NAME is always undefined (Low)
- **File:** `src/rmPoolConnection.ts:56`
- **Status:** Open
- **Description:** Marked with a TODO. The env var is never defined or documented, so every joblog entry will read `undefined: PoolId=...`.

---

## Design / Robustness Issues

### 8. No concurrency safety on attach() (High)
- **File:** `src/rmPool.ts:177-222`
- **Status:** Open
- **Description:** If two callers `await pool.attach()` concurrently, both can find the same connection `isAvailable() === true` before either sets it to `false`. This leads to two consumers sharing one connection with unpredictable results. A mutex or atomic claim mechanism is needed.

### 9. Pool index is stale after retire() splices the array (Medium)
- **File:** `src/rmPool.ts:158-160`
- **Status:** Open
- **Description:** `splice()` re-indexes the `connections` array, but every `rmPoolConnection` still holds its original `poolIndex`. After a retirement, log messages and diagnostics reference wrong indices. Using a `Map` or not relying on array position would fix this.

### 10. No graceful shutdown or health checking (Medium)
- **File:** `src/rmPool.ts`, `src/rmPools.ts`
- **Status:** Open
- **Description:** There is no way to drain the pool (wait for active connections to finish, then close). There is also no periodic health check — a connection could go stale or the IBM i job could die, and the pool would hand it out as if healthy.

### 11. RegisteredPool.rmPool is typed as any (Low)
- **File:** `src/types.ts:39`
- **Status:** Open
- **Description:** This loses all type safety on the pool instance stored inside a registered pool. A forward-reference or import would preserve types.

---

## Suggestions / Enhancements

### 12. Use parameterized queries
- **File:** `src/rmPoolConnection.ts`
- **Status:** Open
- **Description:** Replace string interpolation in SQL calls with parameterized execution (if `mapepire-js` supports it) to eliminate injection risks entirely.

### 13. Connection health check on attach()
- **File:** `src/rmPool.ts`
- **Status:** Open
- **Description:** Before returning a connection, verify it is still alive (e.g., execute a lightweight query like `VALUES 1`). If dead, retire it and try the next one.

### 14. Add EventEmitter or callback hooks
- **File:** `src/rmPool.ts`, `src/rmPools.ts`
- **Status:** Open
- **Description:** Consumers often need to react to pool events (connection created, retired, pool exhausted, error). Emitting events would make the library more flexible.

### 15. Expose a close() / shutdown() method on rmPools
- **File:** `src/rmPools.ts`
- **Status:** Open
- **Description:** Allow consumers to gracefully shut down all pools — wait for active connections to finish, then close everything. Important for clean process exits.

### 16. Logger injection
- **File:** `src/logger.ts`, `src/rmPools.ts`
- **Status:** Open
- **Description:** The logger is hardcoded as a module import. Consider accepting a logger instance via the constructor config (the `Logger` interface is already defined in types but unused for injection).

### 17. Naming conventions
- **File:** All source files
- **Status:** Open
- **Description:** TypeScript convention is PascalCase for classes (`RmPool`, `RmPoolConnection`, `RmPools`). The current lowercase names look like variable names and can be confusing.
