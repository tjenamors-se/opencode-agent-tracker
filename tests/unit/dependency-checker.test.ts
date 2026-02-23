import { DependencyChecker } from '../../src/dependency-checker';

describe('DependencyChecker', () => {
  let dependencyChecker: DependencyChecker;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      tui: {
        toast: {
          show: jest.fn().mockResolvedValue(true)
        }
      },
      app: {
        log: jest.fn().mockResolvedValue(true)
      }
    };
    dependencyChecker = new DependencyChecker(mockClient);
  });

  describe('validate', () => {
    it('should validate LMDB availability', async () => {
      const result = await dependencyChecker.validate();
      expect(typeof result).toBe('boolean');
    });

    it('should show warning when LMDB is unavailable', async () => {
      // Mock the checkLMDBLazy method to return false
      const originalCheckLMDBLazy = dependencyChecker['checkLMDBLazy'];
      dependencyChecker['checkLMDBLazy'] = jest.fn().mockResolvedValue(false);
      
      const result = await dependencyChecker.validate();
      expect(result).toBe(false);
      expect(mockClient.app.log).toHaveBeenCalled();
      
      dependencyChecker['checkLMDBLazy'] = originalCheckLMDBLazy;
    });

    it('should handle validation errors gracefully', async () => {
      // Mock the checkLMDBLazy method to throw an error
      const originalCheckLMDBLazy = dependencyChecker['checkLMDBLazy'];
      dependencyChecker['checkLMDBLazy'] = jest.fn().mockRejectedValue(new Error('LMDB check failed'));
      
      const result = await dependencyChecker.validate();
      expect(result).toBe(false);
      expect(mockClient.app.log).toHaveBeenCalled();
      
      dependencyChecker['checkLMDBLazy'] = originalCheckLMDBLazy;
    });
  });

  describe('checkLMDBLazy', () => {
    it('should check LMDB availability', async () => {
      // This is a private method, but we can test the overall behavior
      const result = await dependencyChecker.validate();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('showDependencyWarning', () => {
    it('should show warning message', async () => {
      // This is a private method, but we can test it through validate
      const originalCheckLMDBLazy = dependencyChecker['checkLMDBLazy'];
      dependencyChecker['checkLMDBLazy'] = jest.fn().mockResolvedValue(false);
      
      await dependencyChecker.validate();
      expect(mockClient.tui.toast.show).toHaveBeenCalledWith({
        message: 'Agent tracking disabled - LMDB dependency unavailable',
        variant: 'warning'
      });
      
      dependencyChecker['checkLMDBLazy'] = originalCheckLMDBLazy;
    });
  });
});