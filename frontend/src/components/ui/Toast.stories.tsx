import type { Meta, StoryObj } from '@storybook/react';
import { ToastProvider, useToast } from './ToastProvider';
import { Button } from './Button';

function ToastDemo({ type, message }: { type: 'success' | 'error' | 'info' | 'warning' | 'loading'; message: string }) {
  const { toast } = useToast();
  return <Button onClick={() => toast(message, type, 8000)}>Show {type} toast</Button>;
}

function PromiseDemo({ fail }: { fail: boolean }) {
  const { promise } = useToast();
  const run = () =>
    promise(
      new Promise((resolve, reject) => setTimeout(() => (fail ? reject(new Error('x')) : resolve('ok')), 1500)),
      { loading: 'Submitting…', success: 'Investment confirmed', error: 'Transaction failed' },
    ).catch(() => undefined);
  return <Button onClick={run}>{fail ? 'Run failing promise' : 'Run promise'}</Button>;
}

const meta: Meta = {
  title: 'UI/Toast',
  decorators: [(Story) => <ToastProvider><Story /></ToastProvider>],
};
export default meta;
type Story = StoryObj;

export const Success: Story = { render: () => <ToastDemo type="success" message="Deal published" /> };
export const ErrorState: Story = { render: () => <ToastDemo type="error" message="Could not reach Stellar network" /> };
export const Warning: Story = { render: () => <ToastDemo type="warning" message="Cooling-off period ends soon" /> };
export const Info: Story = { render: () => <ToastDemo type="info" message="Milestone recorded" /> };
export const Loading: Story = { render: () => <ToastDemo type="loading" message="Waiting for wallet signature…" /> };
export const LongMessage: Story = {
  render: () => <ToastDemo type="info" message="This is a very long notification message intended to verify that toast text wraps correctly and does not overflow the container on narrow viewports." />,
};
export const PromiseSuccess: Story = { render: () => <PromiseDemo fail={false} /> };
export const PromiseError: Story = { render: () => <PromiseDemo fail /> };
