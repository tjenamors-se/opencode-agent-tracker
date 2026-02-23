export class DependencyChecker {
  constructor(private client: any) {}

  async validate(): Promise<boolean> {
    try {
      // Check if LMDB is available - don't block initialization
      // We'll check LMDB lazily when actually needed
      const available = await this.checkLMDBLazy()
      
      if (!available) {
        await this.showDependencyWarning()
        return false
      }
      
      return true
    } catch (error) {
      await this.showDependencyWarning()
      return false
    }
  }

  private async checkLMDBLazy(): Promise<boolean> {
    try {
      // Quick check - try to require LMDB without blocking
      // This is much faster and doesn't initialize the full database
      if (typeof require === 'function') {
        // CommonJS environment
        require('lmdb')
      } else {
        // ES Module environment - use static import
        await import('lmdb')
      }
      return true
    } catch (error) {
      return false
    }
  }

  private async showDependencyWarning(): Promise<void> {
    await this.client.tui.toast.show({
      message: 'Agent tracking disabled - LMDB dependency unavailable',
      variant: 'warning'
    })

    await this.client.app.log({
      body: {
        service: 'agent-tracker',
        level: 'warn',
        message: 'LMDB dependency unavailable - agent tracking disabled',
        extra: { 
          action: 'Please install LMDB system library manually for full functionality',
          documentation: 'See plugin documentation for installation instructions'
        }
      }
    })
  }
}