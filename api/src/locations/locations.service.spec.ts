import { Test, TestingModule } from '@nestjs/testing';
import { LocationsService } from './locations.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LocationsService', () => {
  let module: TestingModule;
  let service: LocationsService;

  const prismaMock = {
    location: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        LocationsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<LocationsService>(LocationsService);
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await module.close();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('getLocations reads from Prisma', async () => {
    prismaMock.location.findMany.mockResolvedValue([]);
    const res = await service.getLocations();
    expect(prismaMock.location.findMany).toHaveBeenCalled();
    expect(Array.isArray(res)).toBe(true);
  });
});
