import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify required roles for accessing a route or controller.
 * Usage: @Roles('farmer', 'trader') on controller methods or classes.
 *
 * @param roles - Array of role names that are allowed to access the resource
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
