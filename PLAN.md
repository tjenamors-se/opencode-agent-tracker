# OpenCode Agent Tracker Plugin - Development Plan

## 📋 Project Overview

**Package Name**: `@the-commits/opencode-agent-tracker`  
**License**: GPL-3.0-or-later  
**Language**: TypeScript (strict mode)  
**Target**: High-performance agent tracking for OpenCode using LMDB  
**Repository**: GitHub public repository  
**Versioning**: Semantic versioning starting with `0.0.0-alpha-<commit_hash>`

### Goals
- Replace JSON-based agent tracking with LMDB-powered centralized tracking
- Provide near-RAM performance for git hook integration  
- Create a publicly distributable OpenCode plugin
- Ensure graceful degradation when dependencies unavailable

### Key Decisions Made

#### ✅ Technical Specifications
- **Database**: LMDB (Lightning Memory-Mapped Database)
- **Performance**: Memory-mapped files, zero-copy reads, ACID transactions
- **Error Handling**: Graceful degradation (tool continues, tracking disabled)
- **Backward Compatibility**: None - clean break from JSON tracking

#### ✅ Development Requirements  
- **TypeScript**: Strict mode with comprehensive type definitions
- **Testing**: 100% coverage target (minimum 80% acceptable)
- **CI/CD**: GitHub Actions with automated testing & publishing
- **Documentation**: Very high quality standards for public distribution

#### ✅ Plugin Architecture
- **Scope**: Global OpenCode plugin (`~/.config/opencode/plugins/`)
- **Hooks**: Critical XP/SP tracking via event handlers
- **Tools**: Custom OpenCode tools for agent management
- **Dependencies**: Single dependency on `lmdb` npm package

---

## 🏗️ Technical Architecture

### Core Components

```typescript
// Plugin Structure
- src/index.ts              // Main plugin entry point
- src/lmdb-database.ts      // LMDB wrapper with error handling  
- src/tracking-service.ts   // XP/SP tracking logic
- src/tool-handlers.ts      // OpenCode tool implementations
- src/event-hooks.ts        // Plugin event handlers
- src/validation/           // Data validation schemas
```

### Database Schema

**Key Prefix Strategy**:
- `agent:{agent_id}` - Agent tracking data
- `commit:{project_path}:{hash}` - Commit-level tracking
- `communication:{project_path}:{hash}` - Retrospective scoring

**Data Models**:
```typescript
interface Agent {
  id: string
  name: string
  model: string
  scope: string
  skill_points: number
  experience_points: number
  communication_score: number
  total_commits: number
  total_bugs: number
  active: boolean
}
```

### Critical Tracking Priorities

**Essential XP/SP Hooks**:
1. `tool.execute.after` - Track successful tool usage
2. `command.executed` - Track command completion  
3. `session.created` - Initialize agent tracking
4. `session.idle` - Save final metrics
5. `tool.execute.before` - Validate agent registration

---

## 🔧 Development Strategy

### Repository Structure

```
@the-commits/opencode-agent-tracker/
├── .github/workflows/      # CI/CD pipelines
├── src/                   # TypeScript source
├── tests/                 # Comprehensive test suite
├── docs/                  # High-quality documentation
├── examples/              # Usage examples
└── package.json           # npm package definition
```

### Testing Strategy

**Coverage Targets**:
- **Goal**: 100% coverage on all new code
- **Minimum**: 80% coverage for critical paths only
- **Plan**: Identify coverage gaps early, adapt strategy as needed

**Test Structure**:
```typescript
// tests/unit/
lmdb-database.test.ts     // Database layer tests
tracking-service.test.ts  // XP/SP logic tests  
tool-handlers.test.ts     // OpenCode tool tests
event-hooks.test.ts      // Plugin event tests

// tests/integration/  
plugin-integration.test.ts // Full lifecycle tests
degraded-mode.test.ts    // Error handling scenarios
performance.test.ts       // LMDB performance benchmarks
```

### CI/CD Pipeline

**.github/workflows/ci.yml**:
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
      - run: npm test -- --coverage --coverageThreshold='{"global":{"lines":100}}'
      
  publish-alpha:
    if: github.ref == 'refs/heads/main'
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build
      - run: npm version 0.0.0-alpha-${GITHUB_SHA:0:8}
      - run: npm publish --tag alpha
```

---

## 🚀 Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Set up TypeScript project with strict configuration
- [ ] Implement LMDB database wrapper with error handling
- [ ] Create basic plugin structure with graceful degradation
- [ ] Set up test suite with 100% coverage requirement
- [ ] Configure GitHub Actions CI/CD pipeline

### Phase 2: Core Tracking (Week 2)  
- [ ] Implement XP/SP tracking service
- [ ] Create event handlers for critical tracking hooks
- [ ] Develop custom OpenCode tools for agent management
- [ ] Add comprehensive integration tests
- [ ] Benchmark LMDB performance vs alternatives

### Phase 3: Polish & Documentation (Week 3)
- [ ] Create high-quality documentation (README, API, etc.)
- [ ] Finalize TypeScript type definitions
- [ ] Optimize performance and error handling
- [ ] Prepare for public release
- [ ] Publish as `@the-commits/opencode-agent-tracker`

### Phase 4: Public Release (Week 4)
- [ ] Create GitHub repository with GPL license
- [ ] Publish npm package
- [ ] Promote to OpenCode community
- [ ] Gather feedback and iterate

---

## 📚 Documentation Plan

### Documentation Structure

**Core Documents**:
- `README.md` - Overview with animated demo, quick start, feature comparison
- `INSTALLATION.md` - Detailed installation instructions  
- `CONFIGURATION.md` - All configuration options with examples
- `API.md` - Complete API reference with TypeScript definitions
- `TROUBLESHOOTING.md` - Common issues and solutions
- `CONTRIBUTING.md` - Development guidelines

**Target Audience**:
- OpenCode users looking for performance tracking
- Developers wanting to contribute
- OpenCode plugin developers seeking examples

---

## 🔒 Licensing & Compliance

### GPL-3.0-or-later Requirements
- LICENSE file with full GPL text
- File headers with GPL notices
- Clear attribution requirements in documentation
- License compatibility verification for dependencies

### OpenCode Plugin Compliance
- Follow OpenCode plugin architecture standards
- Use official `@opencode-ai/plugin` types
- Integrate with OpenCode event system correctly

---

## 🎯 Risk Mitigation

### Technical Risks
- **LMDB Dependency**: Graceful degradation strategy in place
- **Performance Issues**: Performance benchmarks & optimization plans
- **TypeScript Complexity**: Strict configuration with comprehensive types

### Project Risks
- **Scope Creep**: Clear phase-based approach with defined milestones
- **Testing Burden**: 100% coverage goal with 80% minimum acceptable
- **Documentation Quality**: "Very high" standard with multiple reviewers

### Community Risks
- **Adoption**: Clear value proposition vs existing tracking solutions
- **Support**: Comprehensive documentation and examples

---

## 🎉 Success Metrics

### Technical Success
- ✅ LMDB integration working without crashes
- ✅ 100% test coverage achieved (or 80% minimum)
- ✅ Zero regressions in OpenCode functionality
- ✅ Performance benchmarks meet expectations

### Project Success
- ✅ Public npm package published
- ✅ GitHub repository active with contributors
- ✅ Documentation rated "very high" quality
- ✅ Used by OpenCode community members

---

## 🔄 Next Steps

**Immediate Actions**:
1. Begin Phase 1 implementation
2. Set up GitHub repository with GPL license
3. Create initial TypeScript project structure
4. Implement LMDB wrapper with error handling

**Transition to Development**:
- This PLAN.md serves as comprehensive handover document
- All technical decisions captured for reference
- Ready for immediate development start

---

*Last Updated: $(date -I)  
Project Status: Ready for Development*