import {
  Controller,
  Get,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { User, UserRole } from '../auth/entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me/deals')
  async getUserDeals(@Request() req: AuthRequest) {
    const { id, role } = req.user;
    
    if (role === 'investor') {
      throw new ForbiddenException('Investors cannot access deals endpoint');
    }

    return this.usersService.getUserDeals(id, role);
  }

  @Get('me/investments')
  async getUserInvestments(@Request() req: AuthRequest) {
    const { id, role } = req.user;
    
    if (role !== 'investor') {
      throw new ForbiddenException('Only investors can access investments endpoint');
    }

    return this.usersService.getUserInvestments(id, role);
  }
}
