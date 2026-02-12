# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-02-12

### Added

- `RmQueryResult<T>` type that extends `QueryResult<T>` with a `job` property containing the IBM i job name
- `execute()` and `query()` on `RmConnection`, `RmPoolConnection`, and `RmPool` now return typed `RmQueryResult<any>` instead of `Promise<any>`

## [0.1.0] - 2025-02-10

### Added

- `RmConnection` class wrapping `SQLJob` from `@ibm/mapepire-js`
- `RmPool` class with connection pooling, auto-scaling, health checks, and expiry timers
- `RmPoolConnection` class for managed pooled connections
- `RmPools` multi-pool manager
- Injectable logger support with configurable flow through class hierarchy
- `EventEmitter` events on `RmPool` for lifecycle hooks
- `initCommands` for flexible connection setup (SQL and CL commands)
- Pool health check on attach
- Pool shutdown (`close`) support
- Examples for basic queries, stored procedures, and pool usage
