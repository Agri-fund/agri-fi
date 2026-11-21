import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  args: { children: 'Open' },
};
export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {};
export const Green: Story = { args: { tone: 'green', dot: true } };
export const Blue: Story = { args: { tone: 'blue', children: 'Funded' } };
export const Red: Story = { args: { tone: 'red', children: 'Failed' } };
export const AllTones: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      {(['green', 'blue', 'yellow', 'red', 'gray', 'purple', 'orange'] as const).map((tone) => (
        <Badge key={tone} tone={tone} dot>
          {tone}
        </Badge>
      ))}
    </div>
  ),
};
export const LongText: Story = {
  args: { children: 'Awaiting importer confirmation at destination port' },
};
