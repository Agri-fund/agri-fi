import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  args: { children: 'Invest now' },
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Cancel investment' } };
export const Loading: Story = { args: { loading: true, children: 'Submitting' } };
export const Disabled: Story = { args: { disabled: true } };
export const LongLabel: Story = {
  args: { children: 'A very long label that should still wrap or truncate gracefully inside the button' },
  decorators: [(Story) => <div style={{ width: 240 }}><Story /></div>],
};
