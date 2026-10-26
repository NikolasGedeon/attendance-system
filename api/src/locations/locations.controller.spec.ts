import { Test, TestingModule } from '@nestjs/testing';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

describe('LocationsController', () => {
  let module: TestingModule;
  let controller: LocationsController;

  const serviceMock = {
    getLocations: jest.fn(),
    createLocation: jest.fn(),
    updateLocation: jest.fn(),
    deleteLocation: jest.fn(),
    assignUserLocation: jest.fn(),
    getUserLocation: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [LocationsController],
      providers: [{ provide: LocationsService, useValue: serviceMock }],
    }).compile();
    controller = module.get<LocationsController>(LocationsController);
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await module.close();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('getLocations delegates to the service', async () => {
    serviceMock.getLocations.mockResolvedValue([]);
    await controller.getLocations();
    expect(serviceMock.getLocations).toHaveBeenCalled();
  });
});
