import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let module: TestingModule;
  let service: PrismaService;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    // Defensive: release any client resources so the Jest worker exits cleanly.
    try {
      await service.$disconnect();
    } catch {
      // no-op: never connected in a unit test
    }
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
