# AGENTS.md - Coding Agent Guidelines

This file contains development guidelines for agentic coding assistants working on this TypeScript/OpenCode plugin project.

## Project Overview

**Package**: `@tjenamors.se/opencode-agent-tracker`  
**Language**: TypeScript (strict mode) with ES Modules  
**Target**: Node.js >=18.0.0, ES2022  
**Framework**: OpenCode Plugin System  
**Database**: LMDB (Lightning Memory-Mapped Database)  
**Goal**: High-performance agent tracking for OpenCode

## Build/Lint/Test Commands

### Core Development Commands
```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Type checking (essential for TypeScript strict mode)
npm run typecheck

# Linting
npm run lint

# Testing with coverage
npm test

# Run specific test file
npm test -- tests/unit/env-protection.test.ts

# Watch mode for tests
npm run test:watch

# Coverage reporting
npm run test:coverage

# Clean build artifacts
npm run clean

# Local plugin testing
npm run test-local

# Setup local symlink
npm run setup-local
```

### Testing Strategy
- **Target**: 80% test coverage minimum (configured in jest.config.cjs)
- **Structure**: Unit tests in `tests/unit/`
- **Pattern**: All new code must include corresponding tests
- **Debug**: Use `npm run test:watch` for development
- **Coverage**: Excludes `index.ts` and `types.ts` from coverage requirements

## Code Style Guidelines

### TypeScript Configuration
The project uses strict TypeScript with comprehensive checks:
```json
{
  "strict": true,
  "noImplicitAny": true,
  "noImplicitReturns": true,
  "noUncheckedIndexedAccess": true,
  "strictNullChecks": true,
  "forceConsistentCasingInFileNames": true
}
```

### Variable Naming
```typescript
const camelCaseVariable = 'value'      // Variables and functions
class PascalCaseClass {}               // Classes
export interface IPascalCaseInterface {} // Interfaces
const UPPER_SNAKE_CASE = 'CONSTANT'    // Constants
```

### Import Organization
```typescript
// External dependencies first
import { open } from 'lmdb'

// Internal modules grouped by functionality
import { EnvProtection } from '../env-protection'
import { TrackingService } from '../tracking-service'

// Type imports (when not used in runtime)
import type { AgentData, PluginConfig } from '../types'
```

### Error Handling Pattern
```typescript
// Always handle errors gracefully with clear messages
try {
  await someOperation()
} catch (error) {
  console.error('Operation failed:', error)
  // Graceful degradation when possible
  return fallbackOption()
}

// Use specific error types when available
if (error instanceof DatabaseError) {
  handleDatabaseError(error)
} else {
  handleGenericError(error)
}
```

### Function Documentation (JSDoc)
```typescript
/**
 * Validates file paths against .env patterns
 * @param filePath - Path to check for .env protection
 * @returns True if file matches .env pattern
 */
private isEnvFile(filePath: string): boolean {
  // Implementation
}
```

### ESLint Rules
The project uses basic ESLint with TypeScript support:
- `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: '^_'`
- `prefer-const` enforced
- `no-var` enforced

## Project-Specific Patterns

### LMDB Database Usage
```typescript
// Use memory-mapped database for performance
import { open } from 'lmdb'

// Database operations should handle errors gracefully
async function storeAgentData(agentId: string, data: AgentData) {
  try {
    await db.put(`agent:${agentId}`, data)
  } catch (error) {
    console.error('Failed to store agent data:', error)
    // Continue without tracking when database fails
  }
}
```

### OpenCode Plugin Integration
```typescript
// Plugin structure expects export and opencode property
import { opencodeHook } from '@opencode-ai/plugin'

export const plugin = {
  name: 'agent-tracker',
  hooks: {
    'tool.execute.before': async (input) => {
      // Plugin logic
    }
  }
}
```

### Environment File Protection
```typescript
// Strict protection against .env file operations
if (tool === 'read' && this.isEnvFile(args.filePath)) {
  throw new Error('Do not read .env files')
}
```

## Naming Conventions

### File Organization
```
src/
├── index.ts              # Main plugin entry point
├── env-protection.ts    # .env file protection system
├── lmdb-database.ts     # LMDB wrapper and database operations
├── tracking-service.ts  # XP/SP and communication score tracking
├── dependency-checker.ts # Plugin dependency validation
└── types.ts            # TypeScript type definitions

tests/
└── unit/               # Unit tests separated by functionality
```

### Key Patterns
- **Prefix-based keys**: `agent:${id}` for database keys
- **Error messages**: Clear, specific error messages for each failure scenario
- **Configuration**: Central configuration via PluginConfig interface

## Development Workflow

### Before Committing Code
- [ ] Run `npm run typecheck` - No TypeScript errors
- [ ] Run `npm run lint` - Linting passes  
- [ ] Run `npm test` - All tests pass
- [ ] Test coverage meets minimum 80% requirement
- [ ] New functionality includes unit tests
- [ ] Documentation updated if API changed

### Code Quality
- Follow existing patterns and style
- Use TypeScript strictly typed approach
- Handle errors gracefully with proper error messages
- Write tests for new functionality
- Maintain 80%+ test coverage

## Plugin-Specific Notes

### Graceful Degradation
The plugin must continue functioning even when LMDB is unavailable:
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
- **TypeScript errors**: Check `npm run typecheck` output
- **Test failures**: Use `npm run test:coverage` for details
- **Jest ESM issues**: Configured via ts-jest with ESM support

### Debug Commands
```bash
# Check TypeScript issues
npm run typecheck

# Run specific test with debugging
npm run test:watch tests/unit/env-protection.test.ts

# Reset environment
npm run clean && npm test

# Local testing
npm run test-local
```

---

*Remember: This plugin is built for reliability and security. Always prioritize data integrity and graceful error handling.*