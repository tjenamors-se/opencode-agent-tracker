import { getTrustTier, renderAgentName, renderProgressBar, formatHealthStatus } from '../../src/health-display';
import type { AgentHealthStatus } from '../../src/types';

describe('getTrustTier', () => {
  it('should return PROBATION for SP 0-1.9', () => {
    expect(getTrustTier(0)).toBe('PROBATION');
    expect(getTrustTier(1)).toBe('PROBATION');
    expect(getTrustTier(1.9)).toBe('PROBATION');
  });

  it('should return JUNIOR for SP 2-3.9', () => {
    expect(getTrustTier(2)).toBe('JUNIOR');
    expect(getTrustTier(2.7)).toBe('JUNIOR');
    expect(getTrustTier(3.9)).toBe('JUNIOR');
  });

  it('should return ESTABLISHED for SP 4-6.9', () => {
    expect(getTrustTier(4)).toBe('ESTABLISHED');
    expect(getTrustTier(5.5)).toBe('ESTABLISHED');
    expect(getTrustTier(6.9)).toBe('ESTABLISHED');
  });

  it('should return SENIOR for SP 7-9.9', () => {
    expect(getTrustTier(7)).toBe('SENIOR');
    expect(getTrustTier(8.5)).toBe('SENIOR');
    expect(getTrustTier(9.9)).toBe('SENIOR');
  });

  it('should return EXPERT for SP 10+', () => {
    expect(getTrustTier(10)).toBe('EXPERT');
    expect(getTrustTier(15)).toBe('EXPERT');
    expect(getTrustTier(100)).toBe('EXPERT');
  });
});

describe('renderAgentName', () => {
  it('should render a short name with FIGlet Cybermedium', () => {
    const result = renderAgentName('Test');
    expect(result).toContain('___');
    expect(result.split('\n').length).toBeGreaterThan(1);
  });

  it('should fall back to uppercase for very long names', () => {
    const longName = 'ThisIsAnExtremelyLongAgentNameThatExceedsSixtyColumns';
    const result = renderAgentName(longName);
    expect(result).toBe(longName.toUpperCase());
  });

  it('should produce output within 60 columns for short names', () => {
    const result = renderAgentName('Agent');
    const maxWidth = result.split('\n').reduce((max: number, line: string) => Math.max(max, line.length), 0);
    expect(maxWidth).toBeLessThanOrEqual(60);
  });
});

describe('renderProgressBar', () => {
  it('should render empty bar at 0%', () => {
    const result = renderProgressBar(0, 100, 20);
    expect(result).toBe('[--------------------] 0%');
  });

  it('should render full bar at 100%', () => {
    const result = renderProgressBar(100, 100, 20);
    expect(result).toBe('[====================] 100%');
  });

  it('should render half bar at 50%', () => {
    const result = renderProgressBar(50, 100, 20);
    expect(result).toBe('[==========----------] 50%');
  });

  it('should cap at 100% when current exceeds max', () => {
    const result = renderProgressBar(150, 100, 20);
    expect(result).toBe('[====================] 100%');
  });

  it('should show MAX when max is 0', () => {
    const result = renderProgressBar(0, 0, 20);
    expect(result).toBe('[====================] MAX');
  });

  it('should handle fractional progress', () => {
    const result = renderProgressBar(17.7, 27.0, 20);
    expect(result).toMatch(/^\[=+-*\] \d+%$/);
  });
});

describe('formatHealthStatus', () => {
  function makeHealth(overrides: Partial<AgentHealthStatus> = {}): AgentHealthStatus {
    return {
      agent_id: 'TestBot',
      skill_points: 2.7,
      experience_points: 17.7,
      communication_score: 60.0,
      total_commits: 36.0,
      total_bugs: 3.0,
      halted: false,
      pending_changes: [],
      checked_at: new Date(),
      ...overrides,
    };
  }

  it('should contain the agent name rendered with FIGlet', () => {
    const result = formatHealthStatus(makeHealth());
    expect(result).toContain('___');
  });

  it('should display trust tier', () => {
    const result = formatHealthStatus(makeHealth({ skill_points: 2.7 }));
    expect(result).toContain('CLASS : JUNIOR');
  });

  it('should display SP, XP, CS with 1-decimal floats', () => {
    const result = formatHealthStatus(makeHealth());
    expect(result).toContain('SP    : 2.7');
    expect(result).toContain('XP    : 17.7 / 27.0');
    expect(result).toContain('CS    : 60.0');
  });

  it('should display commits and bugs', () => {
    const result = formatHealthStatus(makeHealth());
    expect(result).toContain('COMMITS : 36.0');
    expect(result).toContain('BUGS : 3.0');
  });

  it('should display halted status', () => {
    const result = formatHealthStatus(makeHealth({ halted: false }));
    expect(result).toContain('HALTED  : no');
    const haltedResult = formatHealthStatus(makeHealth({ halted: true }));
    expect(haltedResult).toContain('HALTED  : YES');
  });

  it('should display progress bar', () => {
    const result = formatHealthStatus(makeHealth());
    expect(result).toMatch(/\[=+-*\]/);
  });

  it('should display pending changes when present', () => {
    const result = formatHealthStatus(makeHealth({
      pending_changes: ['change1', 'change2'],
    }));
    expect(result).toContain('PENDING (2):');
    expect(result).toContain('change1');
    expect(result).toContain('change2');
  });

  it('should limit pending changes to 5 with overflow indicator', () => {
    const changes = Array.from({ length: 8 }, (_, i) => `change${i + 1}`);
    const result = formatHealthStatus(makeHealth({
      pending_changes: changes,
    }));
    expect(result).toContain('PENDING (8):');
    expect(result).toContain('change5');
    expect(result).not.toContain('change6');
    expect(result).toContain('+ 3 more');
  });

  it('should not show pending section when no changes', () => {
    const result = formatHealthStatus(makeHealth({ pending_changes: [] }));
    expect(result).not.toContain('PENDING');
  });

  it('should not contain any Unicode box-drawing characters', () => {
    const result = formatHealthStatus(makeHealth());
    for (let i = 0; i < result.length; i++) {
      const code = result.charCodeAt(i);
      expect(code).not.toBeGreaterThanOrEqual(0x2500);
      if (code >= 0x2500) {
        expect(code).not.toBeLessThanOrEqual(0x257F);
      }
    }
  });

  it('should display PROBATION tier for low SP', () => {
    const result = formatHealthStatus(makeHealth({ skill_points: 0.5 }));
    expect(result).toContain('CLASS : PROBATION');
  });

  it('should display EXPERT tier for high SP', () => {
    const result = formatHealthStatus(makeHealth({ skill_points: 10.0 }));
    expect(result).toContain('CLASS : EXPERT');
  });
});
