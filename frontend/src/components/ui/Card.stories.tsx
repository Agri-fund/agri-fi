import type { Meta, StoryObj } from '@storybook/react';
import { Card } from './Card';
import { Button } from './Button';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  args: { title: '10 tons of cocoa', children: 'Ghana → Rotterdam. 65% funded.' },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
};
export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {};
export const WithFooter: Story = { args: { footer: <Button size="sm">View deal</Button> } };
export const Interactive: Story = { args: { interactive: true } };
export const NoTitle: Story = { args: { title: undefined } };
export const EmptyContent: Story = { args: { children: null } };
