import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton } from './Skeleton';

const meta: Meta<typeof Skeleton> = {
  title: 'UI/Skeleton',
  component: Skeleton,
  decorators: [(Story) => <div style={{ width: 280 }}><Story /></div>],
};
export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Default: Story = {};
export const Paragraph: Story = { args: { lines: 4 } };
export const Avatar: Story = { args: { circle: true } };
/** Invalid line counts fall back to one line. */
export const ZeroLines: Story = { args: { lines: 0 } };
