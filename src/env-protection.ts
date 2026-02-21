export class EnvProtection {
  
  async handleToolBefore(input: any): Promise<void> {
    const { tool, args } = input
    
    // Protect against .env file operations
    if (tool === 'read' && this.isEnvFile(args.filePath)) {
      throw new Error('Do not read .env files')
    }

    if (tool === 'write' && this.isEnvFile(args.filePath)) {
      throw new Error('Do not write .env files')
    }

    if (tool === 'edit' && this.isEnvFile(args.filePath)) {
      throw new Error('Do not edit .env files')
    }
  }

  private isEnvFile(filePath: string): boolean {
    if (!filePath) return false
    
    const envPatterns = [
      /\.env$/i,
      /\.env\.local$/i,
      /\.env\.development$/i,
      /\.env\.production$/i,
      /\.env\.test$/i,
      /\.env\.example$/i,
      /\.env\.sample$/i,
      /\.env\.[^.]\+$/i
    ]

    return envPatterns.some(pattern => pattern.test(filePath))
  }
}