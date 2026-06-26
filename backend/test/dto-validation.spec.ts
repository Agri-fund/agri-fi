import { validate } from 'class-validator';
import { RegisterDto } from '../src/auth/dto/register.dto';
import { LoginDto } from '../src/auth/dto/login.dto';

describe('DTO Validation checks', () => {
  it('should invalidate RegisterDto with incorrect parameters', async () => {
    const dto = new RegisterDto();
    dto.name = '';
    dto.email = 'not-an-email';
    dto.password = 'short';
    dto.role = 'invalid_role' as any;
    dto.country = '';

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);

    const emailError = errors.find((e) => e.property === 'email');
    expect(emailError).toBeDefined();
    expect(emailError?.constraints).toHaveProperty('isEmail');

    const passwordError = errors.find((e) => e.property === 'password');
    expect(passwordError).toBeDefined();
    expect(passwordError?.constraints).toHaveProperty('minLength');

    const roleError = errors.find((e) => e.property === 'role');
    expect(roleError).toBeDefined();
    expect(roleError?.constraints).toHaveProperty('isIn');
  });

  it('should validate RegisterDto with correct parameters', async () => {
    const dto = new RegisterDto();
    dto.name = 'Valid Name';
    dto.email = 'valid@example.com';
    dto.password = 'securePassword123';
    dto.role = 'farmer';
    dto.country = 'USA';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should invalidate LoginDto with incorrect parameters', async () => {
    const dto = new LoginDto();
    dto.email = 'invalid-email';
    dto.password = '';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
