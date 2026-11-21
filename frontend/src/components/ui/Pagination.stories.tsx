import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import Pagination from './Pagination';

const meta: Meta<typeof Pagination> = {
  title: 'UI/Pagination',
  component: Pagination,
  args: { page: 1, totalPages: 10, onChange: () => {} },
};
export default meta;
type Story = StoryObj<typeof Pagination>;

export const Default: Story = {
  render: (args) => {
    const [page, setPage] = useState(args.page);
    return <Pagination {...args} page={page} onChange={setPage} />;
  },
};
export const MiddlePage: Story = { args: { page: 5 } };
export const LastPage: Story = { args: { page: 10 } };
export const FewPages: Story = { args: { totalPages: 3 } };
/** A single page renders nothing. */
export const SinglePage: Story = { args: { totalPages: 1 } };
export const ManyPages: Story = { args: { page: 250, totalPages: 500, windowSize: 7 } };
