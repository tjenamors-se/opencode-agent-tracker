# @tjenamors.se/opencode-agent-tracker

⚠️ **Development Repository** - Under active development

High-performance agent tracking for OpenCode using LMDB. This plugin replaces JSON-based tracking with memory-mapped database storage for near-RAM performance.

## ⚡ Quick Start

*Note: Plugin is under development - installation instructions coming soon*

```bash
# Coming soon
npm install @tjenamors.se/opencode-agent-tracker
```

## 🎯 Features

- **Lightning Performance**: LMDB memory-mapped database for near-RAM speed
- **XP/SP Tracking**: Comprehensive skill point and experience tracking
- **Git Hook Integration**: Real-time commit tracking with agent validation
- **Graceful Degradation**: Continues working even when LMDB unavailable
- **TypeScript Native**: Full type safety with comprehensive definitions
- **🔒 .env Protection**: Blocks reading/writing of environment files
- **📊 Communication Scoring**: Tracks collaboration quality (-1/+1/+2 grading)
- **🔔 Smart Notifications**: Toast notifications for critical events

## 🚀 Local Testing

### Quick Setup
```bash
# Build plugin and create symlink
npm run setup-local

# Test functionality without OpenCode
npm run test-local
```

### Manual Setup
```bash
# 1. Build the plugin
npm run build

# 2. Create symlink to OpenCode plugins directory
ln -sf "$(pwd)/dist" ~/.config/opencode/plugins/agent-tracker

# 3. Start OpenCode - plugin will auto-load
```

### Testing Commands
```bash
# Verify TypeScript compilation
npm run typecheck

# Run unit tests
npm test

# Test coverage
npm run test:coverage

# Manual plugin test
npm run test-local
```

## 🏗️ Development Status

🔧 **Phase 1**: Foundation setup  
📝 **License**: GPL-3.0-or-later  
🧪 **Testing**: 100% coverage target  
🚀 **CI/CD**: GitHub Actions workflows

## 📖 Documentation

- [Development Plan](./PLAN.md) - Comprehensive development roadmap
- [Architecture Overview](./docs/ARCHITECTURE.md) - Technical design
- [API Reference](./docs/API.md) - Plugin interface documentation

## 🤝 Contributing

Interested in contributing? Please review our [contributing guidelines](./docs/CONTRIBUTING.md) and [development workflow](./docs/DEVELOPMENT.md). This project follows semantic versioning starting with `0.0.0-alpha-<commit_hash>`.

## 📄 License

GNU General Public License v3.0 or later - See [LICENSE](./LICENSE) for details.