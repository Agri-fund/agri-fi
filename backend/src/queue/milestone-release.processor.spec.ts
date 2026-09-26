import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { MilestoneReleaseProcessor } from './milestone-release.processor';
import { MilestonePartialReleaseService } from '../escrow/milestone-partial-release.service';
import { Job } from 'bull';

describe('MilestoneReleaseProcessor', () => {
  let processor: MilestoneReleaseProcessor;
  let partialReleaseService: MilestonePartialReleaseService;

  const mockJob: Partial<Job> = {
    id: '1',
    data: {
      dealId: 'deal-123',
      milestoneType: 'farm',
      milestoneId: 'milestone-456',
    },
    attemptsMade: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestoneReleaseProcessor,
        {
          provide: getQueueToken('milestone-release'),
          useValue: {},
        },
        {
          provide: MilestonePartialReleaseService,
          useValue: {
            onMilestoneRecorded: jest.fn(),
          },
        },
      ],
    }).compile();

    processor = module.get<MilestoneReleaseProcessor>(MilestoneReleaseProcessor);
    partialReleaseService = module.get<MilestonePartialReleaseService>(
      MilestonePartialReleaseService,
    );

    // Mock logger
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  describe('processMilestoneRelease', () => {
    it('should call partial release service on milestone recorded', async () => {
      await processor.processMilestoneRelease(mockJob as any);

      expect(
        partialReleaseService.onMilestoneRecorded,
      ).toHaveBeenCalledWith('deal-123', 'farm');
    });

    it('should handle multiple milestone types', async () => {
      const milestonesJob: Partial<Job> = {
        data: {
          dealId: 'deal-123',
          milestoneType: 'warehouse',
          milestoneId: 'milestone-789',
        },
      };

      await processor.processMilestoneRelease(milestonesJob as any);

      expect(
        partialReleaseService.onMilestoneRecorded,
      ).toHaveBeenCalledWith('deal-123', 'warehouse');
    });

    it('should re-throw errors to trigger retry', async () => {
      const error = new Error('Release failed');
      jest
        .spyOn(partialReleaseService, 'onMilestoneRecorded')
        .mockRejectedValue(error);

      await expect(
        processor.processMilestoneRelease(mockJob as any),
      ).rejects.toThrow('Release failed');
    });

    it('should log job completion', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await processor.processMilestoneRelease(mockJob as any);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Processing milestone release'),
      );
    });
  });

  describe('onJobFailed', () => {
    it('should log job failure', () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      const job = { id: '1', attemptsMade: 3 } as any;

      processor.onJobFailed(job);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed'),
      );
    });
  });

  describe('onJobCompleted', () => {
    it('should log job completion', () => {
      const debugSpy = jest.spyOn(Logger.prototype, 'debug');
      const job = { id: '1' } as any;

      processor.onJobCompleted(job);

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('completed'),
      );
    });
  });
});
