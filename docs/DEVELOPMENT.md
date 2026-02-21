# Development Workflow

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- npm or bun
- Git for version control
- LMDB system library (for development)

### Setup Instructions
```bash
# Clone repository
git clone https://github.com/tjenamors/opencode-agent-tracker.git
cd opencode-agent-tracker

# Install dependencies
npm install

# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint
```

## 📝 Development Process

### Code Standards

**TypeScript Settings**:
```json
{
  "strict": true,
  "noImplicitAny": true,
  "noImplicitReturns": true,
  "noUncheckedIndexedAccess": true
}
```

**Naming Conventions**:
- Variables/Functions: `camelCase`
- Classes: `PascalCase`  
- Constants: `UPPER_SNAKE_CASE`
- Interfaces: `IPascalCase` prefix

### Git Workflow

**Branch Strategy**:
- `main` - Production-ready code
- `develop` - Development branch
- `feature/feature-name` - Feature development
- `fix/bug-name` - Bug fixes

**Commit Conventions**:
```
feat: add agent registration functionality
fix: resolve LMDB initialization error
docs: update API documentation
test: add coverage for tracking service
chore: update dependencies
```

### Testing Strategy

**100% Coverage Target**:
```typescript
// All new code must include tests
describe('TrackingService', () => {
  it('should increment XP on successful tool execution', () => {
    // Test implementation
  })
})
```

**Test Organization**:
- Unit tests in `tests/unit/`
- Integration tests in `tests/integration/`
- Fixtures in `tests/fixtures/`
- Benchmark tests in `tests/benchmark/`

## 🔄 CI/CD Pipeline

### GitHub Actions

**Automated Checks**:
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test -- --coverage
```

**Alpha Releases**:
```yaml
publish-alpha:
  if: github.ref == 'refs/heads/main'
  needs: test
  steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - run: npm run build
    - run: npm version 0.0.0-alpha-${GITHUB_SHA:0:8}
    - run: npm publish --tag alpha
```

## 📦 Publishing Process

### Versioning Strategy

**Semantic Versioning**:
```
0.0.0-alpha-a1b2c3d4   # Initial development
0.1.0-alpha-e5f6g7h8   # First features
0.1.0                  # First stable release  
1.0.0                  # Major release with breaking changes
```

**Publishing Steps**:
1. Ensure all tests pass (`npm test`)
2. Update version (`npm version patch/minor/major`)
3. Build distribution (`npm run build`)
4. Publish to npm (`npm publish`)
5. Create GitHub release

## 🐛 Debugging & Troubleshooting

### Common Issues

**LMDB Installation Problems**:
```bash
# Ensure LMDB system library is installed
sudo pacman -S lmdb  # Arch Linux
```

**TypeScript Compilation Issues**:
```bash
# Clear build artifacts
npm run clean

# Check type issues
npm run typecheck -- --noEmit
```

**Test Failures**:
```bash
# Run specific test file
npm test -- tests/unit/tracking-service.test.ts

# Debug mode
npm test -- --verbose
```

### Performance Profiling

**Benchmark Tools**:
```typescript
// Performance testing
import { performance } from 'perf_hooks'

describe('Performance', () => {
  it('should handle high concurrency', async () => {
    const start = performance.now()
    // Performance test
    const duration = performance.now() - start
    expect(duration).toBeLessThan(100) // 100ms threshold
  })
})
```

## 🤝 Contributing

### Code Review Process

**Review Checklist**:
- [ ] Tests included and passing
- [ ] TypeScript types are correct
- [ ] Documentation updated
- [ ] Performance benchmarks included
- [ ] Error handling implemented

**Pull Request Template**:
```markdown
## Changes
Describe the changes made

## Testing
- [ ] Unit tests added
- [ ] Integration tests pass
- [ ] Performance benchmarks updated

## Documentation
- [ ] README updated if needed
- [ ] API documentation updated
```

### Issue Reporting

**Bug Report Template**:
```markdown
## Description
Brief description of the issue

## Steps to Reproduce
1. Step one
2. Step two

## Expected Behavior
What should happen

## Actual Behavior  
What actually happens

## Environment
- OpenCode version:
- Plugin version:
- Operating System:
```

## 📊 Metrics & Monitoring

### Development Metrics

**Code Quality**:
- Test coverage percentage
- TypeScript strictness compliance
- Linting error count
- Documentation coverage

**Performance Metrics**:
- LMDB operation speeds
- Memory usage patterns
- Git hook response times
- Plugin initialization time

### Release Checklist

**Before Each Release**:
- [ ] All tests pass
- [ ] Documentation updated
- [ ] Performance benchmarks verified
- [ ] Changelog updated
- [ ] Version number incremented