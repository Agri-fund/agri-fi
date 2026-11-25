import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './Input';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  args: { label: 'Investment amount', placeholder: '100' },
};
export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {};
export const WithHint: Story = { args: { hint: 'Minimum is $100 (one token).' } };
export const ErrorState: Story = {
  args: { error: 'Amount exceeds remaining tokens.', touched: true, defaultValue: '99999' },
};
export const Success: Story = { args: { success: true, touched: true, defaultValue: '500' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'Locked' } };
export const Required: Story = { args: { required: true } };
export const HiddenLabel: Story = { args: { hideLabel: true, label: 'Search deals' } };
