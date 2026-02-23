/**
 * Blocks tool operations on .env files to prevent accidental secret exposure.
 * Intercepts read, write, and edit tool calls via the tool.execute.before hook.
 */
export class EnvProtection {
  
  /**
   * Validates tool input and blocks operations targeting .env files.
   * @param input - Tool execution input containing tool name and args
   * @throws Error if the tool targets a .env file
   */
  async handleToolBefore(input: any): Promise<void> {
    const { tool, args } = input
    if (!args?.filePath) return

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

  /**
   * @param filePath - Path to check for .env pattern match
   * @returns True if the file matches any .env naming pattern
   */
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
      /\.env\.[^.]+$/i
    ]

    return envPatterns.some(pattern => pattern.test(filePath))
  }
}
