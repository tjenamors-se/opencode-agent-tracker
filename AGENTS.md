# AGENTS.md - Coding Agent Guidelines

This file contains development guidelines for agentic coding assistants working on this TypeScript/OpenCode plugin project.

## Project Overview

**Package**: `@the-commits/opencode-agent-tracker`  
**Language**: TypeScript (strict mode)  
**Framework**: OpenCode Plugin System  
**Database**: LMDB (Lightning Memory-Mapped Database)  
**Goal**: High-performance agent tracking for OpenCode

## Build/Lint/Test Commands

### Core Development Commands
```bash
# Install dependencies
npm install

# Type checking (essential for TypeScript strict mode)
npm run typecheck

# Linting
npm run lint

# Testing with coverage
npm test

# Run specific test file
npm test -- tests/unit/tracking-service.test.ts

# Run tests in verbose mode for debugging
npm test -- --verbose

# Performance benchmarking (planned)
npm run benchmark

# Build distribution (planned)
npm run build

# Clean build artifacts
npm run clean
```

### Testing Strategy
- **Target**: 100% test coverage (minimum acceptable: 80%)
- **Structure**: Unit tests in `tests/unit/`, integration tests in `tests/integration/`
- **Pattern**: All new code must include corresponding tests
- **Debug**: Use `--verbose` flag for detailed test output

## Code Style Guidelines

### TypeScript Conventions
```typescript
// Strict mode enforced
{
  "strict": true,
  "noImplicitAny": true,
  "noImplicitReturns": true,
  "noUncheckedIndexedAccess": true
}

// Variable naming
const camelCaseVariable = 'value'      // Variables and functions
class PascalCaseClass {}               // Classes and interfaces
const UPPER_SNAKE_CASE = 'constant'    // Constants
interface IPascalCaseInterface {}       // Interface naming

// Type annotations required
function processData(data: InputData): OutputData {
  // Implementation
}
```

### Import Organization
```typescript
// External dependencies first
import { EventEmitter } from 'events'

// Internal modules grouped by functionality
import { Database } from '../lmdb-database'
import { TrackingService } from '../tracking-service'

// Type imports
import type { AgentData, CommitData } from '../types'
```

### Error Handling Pattern
```typescript
// Always handle LMDB errors gracefully
try {
  await db.put(key, value)
} catch (error) {
  console.error('Database operation failed:', error)
  // Graceful degradation: continue without tracking
  return degradedFunctionality()
}

// Use specific error types
if (error instanceof DatabaseError) {
  handleDatabaseError(error)
} else if (error instanceof ValidationError) {
  handleValidationError(error)
}
```

### Function Documentation
```typescript
/**
 * Updates agent experience points after successful tool execution
 * @param agentId - Unique identifier for the agent
 * @param experienceGained - XP amount to add
 * @returns Updated agent data with new XP total
 */
async function incrementExperience(
  agentId: string,
  experienceGained: number
): Promise<AgentData> {
  // Implementation
}
```

## Project-Specific Patterns

### LMDB Database Usage
```typescript
// Use memory-mapped database for performance
import { open } from 'lmdb'

// Database operations should be transactional
await db.transaction(() => {
  db.put(`agent:${agentId}`, agentData)
  db.put(`commit:${projectPath}:${hash}`, commitData)
})

// Handle graceful degradation
if (!db.available) {
  console.warn('Running in degraded mode - tracking disabled')
  return
}
```

### OpenCode Plugin Integration
```typescript
// Register plugin hooks
opencodeHook('tool.execute.after', async (event) => {
  await trackingService.trackToolUsage(event)
})

// Follow OpenCode event system conventions
opencodeHook('session.created', initializeAgentTracking)
opencodeHook('session.idle', saveFinalMetrics)
```

### Git Hook Integration
```typescript
// Validate agent registration in git hooks
opencodeHook('tool.execute.before', (event) => {
  if (event.command?.includes('git commit')) {
    validateAgentRegistration(event.agentId)
  }
})
```

## Naming Conventions

### File Organization
```
src/
├── index.ts              # Main plugin entry point
├── lmdb-database.ts     # LMDB wrapper
├── tracking-service.ts   # XP/SP tracking logic
├── event-hooks.ts       # OpenCode event handlers
├── validation/          # Data validation schemas
└── types.ts            # TypeScript type definitions
```

### Key Patterns
- **Prefix-based keys**: `agent:${id}`, `commit:${project}:${hash}`
- **Event names**: Use OpenCode standard event names
- **Configuration**: Centralize all config in `config.ts`

## Commit Guidelines

### Commit Message Format
```
feat: add agent registration functionality
fix: resolve LMDB initialization error
docs: update API documentation
test: add coverage for tracking service
chore: update dependencies
perf: optimize database queries
```

### Branch Strategy
- `main` - Production-ready code
- `develop` - Development branch  
- `feature/feature-name` - Feature branches
- `fix/bug-name` - Bug fix branches

## Quality Assurance

### Before Committing Code
- [ ] Run `npm run typecheck` - No TypeScript errors
- [ ] Run `npm run lint` - Linting passes
- [ ] Run `npm test` - All tests pass
- [ ] Test coverage meets minimum 80% requirement
- [ ] New functionality includes unit tests
- [ ] Documentation updated if API changed

### Performance Considerations
- Optimize LMDB operations for concurrency
- Use memory-mapped files efficiently
- Minimize blocking operations
- Benchmark critical paths

## Plugin-Specific Notes

### Graceful Degradation
This plugin must continue functioning even when LMDB is unavailable:
- Log warnings when degraded mode activated
- Provide basic functionality without tracking
- Never crash OpenCode session

### Data Privacy
- Store data locally only (user's home directory)
- No external API calls or data transmission
- Clear data boundaries between plugin and OpenCode

## Troubleshooting

### Common Issues
- **LMDB not available**: Plugin runs in degraded mode
- **TypeScript errors**: Check `npm run typecheck -- --noEmit`
- **Test failures**: Use `npm test -- --verbose` for details

### Debug Commands
```bash
# Check TypeScript issues
npm run typecheck -- --noEmit

# Run specific test with debugging
npm test -- tests/unit/tracking-service.test.ts --verbose

# Reset test environment
npm run clean && npm test
```

---

*Remember: This plugin is built for high performance and reliability. Always prioritize data integrity and user experience.*