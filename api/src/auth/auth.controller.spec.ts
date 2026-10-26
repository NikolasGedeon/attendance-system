import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let module: TestingModule;
  let controller: AuthController;

  const authServiceMock = {
    register: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    changeTemporaryPassword: jest.fn(),
    changePassword: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    activateAccount: jest.fn(),
    activationStatus: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    }).compile();
    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await module.close();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('login delegates to AuthService', async () => {
    authServiceMock.login.mockResolvedValue({ ok: true });
    await controller.login({ email: 'a@b.com', password: 'secret12' } as any);
    expect(authServiceMock.login).toHaveBeenCalled();
  });
});
