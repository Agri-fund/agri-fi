import { PlatformWalletMonitorService } from './platform-wallet-monitor.service';

describe('PlatformWalletMonitorService', () => {
  let service: PlatformWalletMonitorService;

  beforeEach(() => {
    service = new PlatformWalletMonitorService();
  });

  it('classifies balance below 10 XLM as critical', () => {
    expect(service.classifyBalance(9.9)).toBe('critical');
    expect(service.classifyBalance(0)).toBe('critical');
  });

  it('classifies balance between 10 and 50 XLM as warning', () => {
    expect(service.classifyBalance(10)).toBe('warning');
    expect(service.classifyBalance(49.9)).toBe('warning');
  });

  it('classifies balance at or above 50 XLM as none', () => {
    expect(service.classifyBalance(50)).toBe('none');
    expect(service.classifyBalance(100)).toBe('none');
  });
});
