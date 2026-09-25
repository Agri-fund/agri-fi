import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import BrowserPushNotificationsCard from '../BrowserPushNotificationsCard';

const registerPushNotificationsMock = jest.fn();
const isPushSupportedMock = jest.fn(() => true);
const getPushPermissionStatusMock = jest.fn(() => 'default');

jest.mock('@/lib/pushNotifications', () => ({
  registerPushNotifications: (...args: unknown[]) => registerPushNotificationsMock(...args),
  isPushSupported: (...args: unknown[]) => isPushSupportedMock(...args),
  getPushPermissionStatus: (...args: unknown[]) => getPushPermissionStatusMock(...args),
}));

describe('BrowserPushNotificationsCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registerPushNotificationsMock.mockResolvedValue(true);
    isPushSupportedMock.mockReturnValue(true);
    getPushPermissionStatusMock.mockReturnValue('default');
  });

  it('requests browser push permissions when the user clicks enable', async () => {
    const user = userEvent.setup();

    render(<BrowserPushNotificationsCard />);

    await user.click(screen.getByRole('button', { name: /enable browser notifications/i }));

    expect(registerPushNotificationsMock).toHaveBeenCalledTimes(1);
  });
});
